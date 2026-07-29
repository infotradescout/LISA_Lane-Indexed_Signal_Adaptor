import express from "express";
import { EventSource } from "eventsource";
import fs from "node:fs";
import path from "node:path";
import {
  INTERPRETER_VERSION,
  LANE_ONTOLOGY,
  SIGNAL_CONTRACT_FIELDS,
} from "./interpreter.js";
import { buildPacket } from "./ingest/envelope.js";
import { getRecentCanonicalSignals, getIngestionOpsSummary, ingestPacket } from "./ingest/service.js";
import { startInboxWatcher } from "./ingest/inboxWatcher.js";

function loadDotEnv() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = val;
  }
}

function numEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

function boolEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null) return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).toLowerCase());
}

loadDotEnv();

const V1_STREAM_URL = process.env.V1_STREAM_URL || "http://localhost:3000/stream";
const PORT = numEnv("PORT", 3100);
const MAX_EVENTS = numEnv("MAX_EVENTS", 200);
const RECONNECT_BASE_MS = numEnv("SSE_RECONNECT_BASE_MS", 2000);
const RECONNECT_MAX_MS = numEnv("SSE_RECONNECT_MAX_MS", 60000);
const DRAIN_ON_SHUTDOWN = boolEnv("BRIDGE_DRAIN_ON_SHUTDOWN", false);
const DRAIN_FILE_PATH = process.env.BRIDGE_DRAIN_FILE || "";
const INBOX_ENABLED = boolEnv("INGEST_INBOX_ENABLED", true);
const INBOX_DIR = process.env.INGEST_INBOX_DIR || path.join(process.cwd(), "inbox");
const INBOX_ARCHIVE_DIR =
  process.env.INGEST_INBOX_ARCHIVE_DIR || path.join(INBOX_DIR, "processed");
const INBOX_FAILED_DIR = process.env.INGEST_INBOX_FAILED_DIR || path.join(INBOX_DIR, "failed");
const INBOX_POLL_MS = numEnv("INGEST_INBOX_POLL_MS", 1500);

// ---- In-memory ring buffer ----
const events = [];
let seq = 0;
const signalSubscribers = new Set();

function mapEventToApiSignal(e) {
  const signal = e.signal || e.signals?.[0] || null;
  return {
    id: e.id,
    receivedAt: e.receivedAt,
    lane: signal?.lane ?? "unknown",
    confidence: signal?.confidence ?? 0,
    observed_fact: signal?.summary ?? null,
    source: signal?.source_system ?? "unknown",
    entity: signal?.entity ?? null,
    location: null,
    change: signal?.category ?? null,
    source_class: signal?.source_type ?? "knowledge_packet",
    ambiguous: Array.isArray(signal?.contradiction_refs) && signal.contradiction_refs.length > 0,
    needs_review: Array.isArray(signal?.contradiction_refs) && signal.contradiction_refs.length > 0,
    review_reason:
      Array.isArray(signal?.contradiction_refs) && signal.contradiction_refs.length > 0
        ? "contradiction_detected"
        : null,
    signal: signal?.lane ?? "unknown",
    raw: signal?.raw_payload ?? e.data ?? null,
    payload: signal ?? null,
  };
}

function broadcastSignal(entry) {
  if (!signalSubscribers.size) return;
  const signals = entry.signals || (entry.signal ? [entry.signal] : []);
  for (const signal of signals) {
    const payload = mapEventToApiSignal({ ...entry, signal });
    payload.id = entry.id;
    const body = JSON.stringify(payload);
    for (const send of signalSubscribers) {
      try {
        send(payload.id, body);
      } catch {
        // Ignore dead subscribers; close handler removes them.
      }
    }
  }
}

function recordEvent(evt) {
  const entry = {
    id: ++seq,
    ...evt,
    receivedAt: new Date().toISOString(),
  };
  events.push(entry);
  while (events.length > MAX_EVENTS) events.shift();
  if (Array.isArray(entry.signals) && entry.signals.length) {
    broadcastSignal(entry);
  }
  return entry;
}

// ---- SSE connection ----
let sseConnected = false;
let lastEventAt = null;
let reconnectDelayMs = RECONNECT_BASE_MS;
let reconnectTimer = null;

function scheduleReconnect() {
  if (reconnectTimer) return;
  const waitMs = reconnectDelayMs;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectToV1();
  }, waitMs);
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, RECONNECT_MAX_MS);
  recordEvent({ type: "bridge_reconnect_scheduled", waitMs });
}

function processIncomingSse(data) {
  lastEventAt = new Date().toISOString();
  const packet = buildPacket({
    sourceSystem: "v1_stream",
    sourceSystemVersion: "legacy_sse_bridge",
    packetType: "sse_message",
    generatedAt: lastEventAt,
    summary: "legacy stream event",
    items: [{ raw: data }],
    publishStatus: "published",
  });
  const ingestResult = ingestPacket(packet);
  recordEvent({
    type: "sse_message",
    data,
    packet,
    ingestResult: {
      ok: ingestResult.ok,
      errors: ingestResult.errors,
      unknownFields: ingestResult.unknownFields,
      contradictions: ingestResult.contradictions.length,
      promoted: ingestResult.promoted,
    },
    signals: ingestResult.normalizedSignals,
  });
}

function connectToV1() {
  const es = new EventSource(V1_STREAM_URL);

  es.onopen = () => {
    sseConnected = true;
    reconnectDelayMs = RECONNECT_BASE_MS;
    recordEvent({ type: "bridge_connected" });
  };

  es.onerror = () => {
    sseConnected = false;
    recordEvent({ type: "bridge_disconnected" });
    es.close();
    scheduleReconnect();
  };

  // Generic message handler (for events without explicit event: field)
  es.onmessage = (msg) => {
    processIncomingSse(msg.data);
  };

  // Specific event handlers for v1's named events
  es.addEventListener("hello", (msg) => {
    try {
      console.log("[hello event] received");
      processIncomingSse(msg.data);
      console.log("[hello event] processed");
    } catch (err) {
      console.error("[hello event] ERROR:", err);
    }
  });

  es.addEventListener("state_update", (msg) => {
    try {
      console.log("[state_update event] received");
      processIncomingSse(msg.data);
      console.log("[state_update event] processed");
    } catch (err) {
      console.error("[state_update event] ERROR:", err);
    }
  });

  es.addEventListener("state_expired", (msg) => {
    try {
      console.log("[state_expired event] received");
      processIncomingSse(msg.data);
      console.log("[state_expired event] processed");
    } catch (err) {
      console.error("[state_expired event] ERROR:", err);
    }
  });
}

// ---- Express server ----
const app = express();
app.use(express.json({ limit: "2mb" }));
let stopInboxWatcher = () => {};
let getInboxWatcherStats = () => ({ enabled: false });

app.get("/health", (_req, res) => {
  const ops = getIngestionOpsSummary();
  res.json({
    status: "ok",
    sseConnected,
    lastEventAt,
    bufferedEvents: events.length,
    maxBufferedEvents: MAX_EVENTS,
    uptimeSeconds: Math.floor(process.uptime()),
    v1StreamUrl: V1_STREAM_URL,
    bridgePort: PORT,
    maxEvents: MAX_EVENTS,
    reconnectBaseMs: RECONNECT_BASE_MS,
    reconnectMaxMs: RECONNECT_MAX_MS,
    reconnectNextMs: reconnectDelayMs,
    drainOnShutdown: DRAIN_ON_SHUTDOWN,
    drainFilePath: DRAIN_FILE_PATH || null,
    interpreterVersion: INTERPRETER_VERSION,
    laneOntology: LANE_ONTOLOGY,
    signalContractFields: SIGNAL_CONTRACT_FIELDS,
    ingestionSchemaVersion: ops.schema_version,
    knownAdapters: ops.known_adapters,
    ingestionSources: ops.sources,
    memory: ops.memory,
    inboxWatcher: getInboxWatcherStats(),
  });
});

// Optional query params:
// - limit (default 50, max 200)
// - afterId (return only events with id > afterId)
app.get("/events", (req, res) => {
  const limitRaw = Number(req.query.limit ?? 50);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

  const afterIdRaw = Number(req.query.afterId ?? 0);
  const afterId = Number.isFinite(afterIdRaw) ? afterIdRaw : 0;

  const filtered = afterId > 0 ? events.filter((e) => e.id > afterId) : events;
  const sliced = filtered.slice(-limit);

  res.json({
    count: sliced.length,
    latestId: events.length ? events[events.length - 1].id : 0,
    events: sliced,
  });
});

// TradeScout-style adapter endpoint: returns normalized lane signals derived from SSE.
// Query params:
// - limit (default 50, max 200)
// - afterId (only items after this event id)
app.get("/signals", (req, res) => {
  const limitRaw = Number(req.query.limit ?? 50);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

  const afterIdRaw = Number(req.query.afterId ?? 0);
  const afterId = Number.isFinite(afterIdRaw) ? afterIdRaw : 0;

  const filtered = events.filter((e) => (afterId > 0 ? e.id > afterId : true));
  const sliced = filtered.slice(-limit);
  const signals = sliced.flatMap((entry) =>
    (entry.signals || []).map((signal) =>
      mapEventToApiSignal({
        ...entry,
        signal,
        id: entry.id,
      })
    )
  );

  res.json({
    count: signals.length,
    latestId: events.length ? events[events.length - 1].id : 0,
    signals,
  });
});

// Canonical signal feed for LISA internals.
app.get("/ingest/signals", (req, res) => {
  const limitRaw = Number(req.query.limit ?? 100);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;
  res.json({
    count: limit,
    signals: getRecentCanonicalSignals(limit),
  });
});

// Producer publish endpoint for standardized packets.
app.post("/ingest/packet", (req, res) => {
  const packet = req.body;
  const result = ingestPacket(packet);
  recordEvent({
    type: "ingest_packet",
    packet,
    ingestResult: {
      ok: result.ok,
      sourceSystem: result.sourceSystem,
      errors: result.errors,
      unknownFields: result.unknownFields,
      contradictions: result.contradictions.length,
      promoted: result.promoted,
    },
    signals: result.normalizedSignals,
  });

  const status = result.ok ? 200 : 400;
  res.status(status).json({
    ok: result.ok,
    sourceSystem: result.sourceSystem,
    errors: result.errors,
    unknownFields: result.unknownFields,
    normalizedSignals: result.normalizedSignals.length,
    contradictions: result.contradictions,
    promoted: result.promoted,
  });
});

// Operator view: ingest pipeline health per source.
app.get("/ingest/ops", (_req, res) => {
  res.json(getIngestionOpsSummary());
});

// Push adapter: re-broadcast derived signals as SSE so consumers can subscribe.
app.get("/signals/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  res.write("retry: 1000\n\n");

  const send = (id, body) => {
    res.write("id: " + id + "\n");
    res.write("event: signal\n");
    res.write("data: " + body + "\n\n");
  };

  signalSubscribers.add(send);
  req.on("close", () => {
    signalSubscribers.delete(send);
  });
});

// Minimal live dashboard UI (no build tools, no deps)
app.get("/", (_req, res) => res.redirect("/dashboard"));

app.get("/dashboard", (_req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>LISA Dashboard</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 16px; }
    .row { display: flex; gap: 12px; flex-wrap: wrap; }
    .card { border: 1px solid #ddd; border-radius: 10px; padding: 12px; min-width: 280px; }
    .k { color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; }
    .v { font-size: 16px; margin-top: 4px; word-break: break-word; }
    button { padding: 8px 12px; border-radius: 8px; border: 1px solid #ccc; background: #fff; cursor: pointer; }
    button:hover { background: #f6f6f6; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border-bottom: 1px solid #eee; padding: 8px; text-align: left; vertical-align: top; }
    th { font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: .03em; }
    .pill { display: inline-block; padding: 2px 8px; border: 1px solid #ddd; border-radius: 999px; font-size: 12px; }
    .ok { border-color: #2c7; }
    .bad { border-color: #e55; }
  </style>
</head>
<body>
  <h2>LISA (Lane-Indexed Signal Adaptor)</h2>

  <div class="row">
    <div class="card">
      <div class="k">LISA Bridge</div>
      <div class="v mono" id="bridge"></div>
      <div style="margin-top:10px;">
        <button id="refresh">Refresh</button>
        <button id="autotoggle">Auto: ON</button>
      </div>
    </div>

    <div class="card">
      <div class="k">Connection</div>
      <div class="v" id="conn"></div>
      <div class="k" style="margin-top:10px;">Last Event</div>
      <div class="v mono" id="last"></div>
    </div>

    <div class="card">
      <div class="k">Buffer</div>
      <div class="v" id="buf"></div>
      <div class="k" style="margin-top:10px;">Latest ID</div>
      <div class="v mono" id="latest"></div>
    </div>
  </div>

  <h3 style="margin-top:18px;">Signals</h3>
  <table>
    <thead>
      <tr>
        <th>ID</th>
        <th>Received</th>
        <th>Lane</th>
        <th>Fact</th>
        <th>Conf</th>
        <th>Review</th>
        <th>Raw</th>
      </tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>

  <h3 style="margin-top:18px;">Ingestion Ops</h3>
  <table>
    <thead>
      <tr>
        <th>Source</th>
        <th>Last Packet</th>
        <th>Packets</th>
        <th>Status</th>
        <th>Validation Errors</th>
        <th>New Signals</th>
        <th>Contradictions</th>
        <th>Promoted</th>
      </tr>
    </thead>
    <tbody id="opsRows"></tbody>
  </table>

<script>
let auto = true;
let lastSeenId = 0;

function esc(s) {
  return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}

async function fetchJson(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

function setPill(el, ok, text) {
  el.innerHTML = '<span class="pill ' + (ok ? 'ok' : 'bad') + '">' + esc(text) + "</span>";
}

function summarizeRaw(raw) {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") {
    return raw.length > 140 ? raw.slice(0, 140) + "…" : raw;
  }
  try {
    const s = JSON.stringify(raw);
    return s.length > 140 ? s.slice(0, 140) + "…" : s;
  } catch {
    return String(raw);
  }
}

async function refresh() {
  const health = await fetchJson("/health");
  const ops = await fetchJson("/ingest/ops");
  document.getElementById("bridge").textContent =
    "port=" + health.bridgePort + "  v1=" + health.v1StreamUrl + "  inbox=" + (health.inboxWatcher?.enabled ? "on" : "off");

  setPill(document.getElementById("conn"), !!health.sseConnected, health.sseConnected ? "SSE CONNECTED" : "SSE DISCONNECTED");
  document.getElementById("last").textContent = health.lastEventAt || "(none yet)";
  document.getElementById("buf").textContent = health.bufferedEvents + " / " + health.maxBufferedEvents;

  const signalsResp = await fetchJson("/signals?limit=50&afterId=" + lastSeenId);
  document.getElementById("latest").textContent = signalsResp.latestId;

  const rows = document.getElementById("rows");
  const signals = signalsResp.signals || [];

  // Prepend newest to top for visibility
  for (let i = signals.length - 1; i >= 0; i--) {
    const s = signals[i];
    lastSeenId = Math.max(lastSeenId, s.id);

    const tr = document.createElement("tr");
    tr.innerHTML =
      "<td class='mono'>" + esc(s.id) + "</td>" +
      "<td class='mono'>" + esc(s.receivedAt) + "</td>" +
      "<td><span class='pill'>" + esc(s.lane || s.signal) + "</span></td>" +
      "<td class='mono'>" + esc(s.observed_fact || "") + "</td>" +
      "<td class='mono'>" + esc(Number(s.confidence || 0).toFixed(2)) + "</td>" +
      "<td class='mono'>" + esc(s.needs_review ? (s.review_reason || "yes") : "no") + "</td>" +
      "<td class='mono'>" + esc(summarizeRaw(s.raw)) + "</td>";
    rows.prepend(tr);
  }

  const opsRows = document.getElementById("opsRows");
  opsRows.innerHTML = "";
  (ops.sources || []).forEach((src) => {
    const tr = document.createElement("tr");
    tr.innerHTML =
      "<td class='mono'>" + esc(src.source_system) + "</td>" +
      "<td class='mono'>" + esc(src.last_packet_received || "(none)") + "</td>" +
      "<td class='mono'>" + esc(src.packet_count || 0) + "</td>" +
      "<td><span class='pill'>" + esc(src.last_ingest_status || "unknown") + "</span></td>" +
      "<td class='mono'>" + esc(src.validation_errors || 0) + "</td>" +
      "<td class='mono'>" + esc(src.new_signals_count || 0) + "</td>" +
      "<td class='mono'>" + esc(src.contradictions_found || 0) + "</td>" +
      "<td class='mono'>" + esc(src.promoted_to_memory_count || 0) + "</td>";
    opsRows.appendChild(tr);
  });
}

document.getElementById("refresh").addEventListener("click", () => refresh().catch(e => alert(e.message)));
document.getElementById("autotoggle").addEventListener("click", (e) => {
  auto = !auto;
  e.target.textContent = "Auto: " + (auto ? "ON" : "OFF");
});

setInterval(() => { if (auto) refresh().catch(() => {}); }, 1000);
refresh().catch(() => {});
</script>
</body>
</html>`);
});

// Global error handlers to prevent silent crashes
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled rejection at:', promise, 'reason:', reason);
});

function drainEventsToFile(reason) {
  if (!DRAIN_ON_SHUTDOWN || !DRAIN_FILE_PATH) return;
  try {
    fs.mkdirSync(path.dirname(DRAIN_FILE_PATH), { recursive: true });
    fs.writeFileSync(
      DRAIN_FILE_PATH,
      JSON.stringify(
        {
          reason,
          drainedAt: new Date().toISOString(),
          count: events.length,
          events,
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
    console.log("[drain] wrote " + events.length + " events to " + DRAIN_FILE_PATH);
  } catch (err) {
    console.error("[drain] failed:", err);
  }
}

const server = app.listen(PORT, () => {
  console.log("[lisa] listening on port " + PORT);
  const watcher = startInboxWatcher({
    enabled: INBOX_ENABLED,
    inboxDir: INBOX_DIR,
    archiveDir: INBOX_ARCHIVE_DIR,
    failedDir: INBOX_FAILED_DIR,
    pollMs: INBOX_POLL_MS,
    onPacket: async (packet, meta) => {
      const result = ingestPacket(packet);
      recordEvent({
        type: "ingest_file_packet",
        file: {
          name: meta.fileName,
          path: meta.filePath,
        },
        packet,
        ingestResult: {
          ok: result.ok,
          sourceSystem: result.sourceSystem,
          errors: result.errors,
          unknownFields: result.unknownFields,
          contradictions: result.contradictions.length,
          promoted: result.promoted,
        },
        signals: result.normalizedSignals,
      });
    },
    onError: (err, meta) => {
      recordEvent({
        type: "ingest_file_error",
        file: meta,
        error: String(err?.message || err || "unknown file ingest error"),
      });
    },
  });
  stopInboxWatcher = watcher.stop;
  getInboxWatcherStats = watcher.getStats;
  try {
    connectToV1();
  } catch (err) {
    console.error("[ERROR] Failed to connect to v1:", err);
  }
});

let shuttingDown = false;
function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  stopInboxWatcher();
  drainEventsToFile(reason);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
