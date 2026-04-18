import express from "express";
import { EventSource } from "eventsource";
import fs from "node:fs";
import path from "node:path";
import {
  deriveSignalFromSseMessage,
  INTERPRETER_VERSION,
  LANE_ONTOLOGY,
  SIGNAL_CONTRACT_FIELDS,
} from "./interpreter.js";

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

// ---- Upstream sources (all 8 feed into LISA independently) ----

// 1. SSE streams (real-time push) — gulf-live-stream, business-presence-engine
const UPSTREAM_SSE_SOURCES = (
  process.env.UPSTREAM_SSE_SOURCES ||
  "http://localhost:3011/stream,http://localhost:3012/stream"
)
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);

// 2. HTTP feed sources (polled) — FactDeck, NewsFilter, MealScout, AutoBott, AssetOS
//    Format per entry: "baseUrl|pollMs" — pollMs optional, defaults to FACTDECK_POLL_MS
const UPSTREAM_FEED_SOURCES = (
  process.env.UPSTREAM_FEED_SOURCES ||
  [
    "http://localhost:8087/feed|30000",
    "http://localhost:5173/api/signals|60000",
    "http://localhost:5174/api/signals|60000",
    "http://localhost:5000/signals|60000",
    "http://localhost:8000/signals|60000",
  ].join(",")
)
  .split(",")
  .map((entry) => {
    const [url, ms] = entry.trim().split("|");
    return { url: url.trim(), pollMs: ms ? Number(ms) : 30000 };
  })
  .filter((e) => e.url);

// Legacy FactDeck env kept for compat
const FACTDECK_FEED_URL = process.env.FACTDECK_FEED_URL || "http://localhost:8087/feed";
const FACTDECK_POLL_MS  = numEnv("FACTDECK_POLL_MS", 30000);

// Legacy single-stream env kept for backward compat
if (process.env.V1_STREAM_URL && !UPSTREAM_SSE_SOURCES.includes(process.env.V1_STREAM_URL)) {
  UPSTREAM_SSE_SOURCES.push(process.env.V1_STREAM_URL);
}

const PORT = numEnv("PORT", 3100);
const MAX_EVENTS = numEnv("MAX_EVENTS", 1000);
const RECONNECT_BASE_MS = numEnv("SSE_RECONNECT_BASE_MS", 2000);
const RECONNECT_MAX_MS = numEnv("SSE_RECONNECT_MAX_MS", 60000);
const DRAIN_ON_SHUTDOWN = boolEnv("BRIDGE_DRAIN_ON_SHUTDOWN", false);
const DRAIN_FILE_PATH = process.env.BRIDGE_DRAIN_FILE || "";
const AUTO_BOOTSTRAP_ON_STREAM_MISMATCH = boolEnv(
  "AUTO_BOOTSTRAP_ON_STREAM_MISMATCH",
  true
);
const BOOTSTRAP_FIXTURE_PATH =
  process.env.BOOTSTRAP_FIXTURE_PATH ||
  path.join(process.cwd(), "fixtures", "replay-events.sample.json");

// ---- In-memory ring buffer ----
const events = [];
let seq = 0;
const signalSubscribers = new Set();

function mapEventToApiSignal(e) {
  return {
    id:            e.id,
    receivedAt:    e.receivedAt,
    lane:          e.signal?.lane         ?? "unknown",
    signal_kind:   e.signal?.signal_kind  ?? "raw_event",
    confidence:    e.signal?.confidence   ?? 0,
    score:         e.signal?.score        ?? 0,
    impact_level:  e.signal?.impact_level ?? "medium",
    trend:         e.signal?.trend        ?? "neutral",
    velocity:      e.signal?.velocity     ?? null,
    observed_fact: e.signal?.observed_fact ?? null,
    source:        e.signal?.source       ?? "unknown",
    entity:        e.signal?.entity       ?? null,
    location:      e.signal?.location     ?? null,
    change:        e.signal?.change       ?? null,
    action_hint:   e.signal?.action_hint  ?? null,
    tags:          e.signal?.tags         ?? [e.signal?.lane ?? "unclassified"],
    source_class:  e.signal?.source_class ?? "external_stream",
    ambiguous:     !!e.signal?.ambiguous,
    needs_review:  !!e.signal?.needs_review,
    review_reason: e.signal?.review_reason ?? null,
    signal:        e.signal?.lane         ?? "unknown",
    raw:           e.signal?.raw          ?? e.data ?? null,
    payload:       e.signal?.payload      ?? null,
  };
}

function broadcastSignal(entry) {
  if (!signalSubscribers.size) return;
  const payload = mapEventToApiSignal(entry);
  const body = JSON.stringify(payload);
  for (const send of signalSubscribers) {
    try {
      send(payload.id, body);
    } catch {
      // Ignore dead subscribers; close handler removes them.
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
  if (entry.type === "sse_message" && entry.signal) {
    broadcastSignal(entry);
  }
  return entry;
}

// ---- SSE connection state (per source) ----
const sourceState = {};   // url -> { connected, lastEventAt, reconnectDelayMs, reconnectTimer }
let fallbackBootstrapped = false;

function getSourceState(url) {
  if (!sourceState[url]) {
    sourceState[url] = {
      connected: false,
      lastEventAt: null,
      reconnectDelayMs: RECONNECT_BASE_MS,
      reconnectTimer: null,
    };
  }
  return sourceState[url];
}

// Legacy compat helpers used in /health and elsewhere
function isSseConnected() {
  return Object.values(sourceState).some((s) => s.connected);
}
function getLastEventAt() {
  return Object.values(sourceState)
    .map((s) => s.lastEventAt)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
}

function fixtureInputToString(input) {
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input);
  } catch {
    return String(input ?? "");
  }
}

function bootstrapFallbackSignals(reason) {
  if (fallbackBootstrapped) return;
  if (!AUTO_BOOTSTRAP_ON_STREAM_MISMATCH) return;

  try {
    if (!fs.existsSync(BOOTSTRAP_FIXTURE_PATH)) {
      recordEvent({
        type: "bridge_bootstrap_skipped",
        reason,
        fixturePath: BOOTSTRAP_FIXTURE_PATH,
      });
      return;
    }

    const raw = fs.readFileSync(BOOTSTRAP_FIXTURE_PATH, "utf8");
    const fixtures = JSON.parse(raw);
    if (!Array.isArray(fixtures)) {
      recordEvent({
        type: "bridge_bootstrap_skipped",
        reason,
        fixturePath: BOOTSTRAP_FIXTURE_PATH,
        error: "fixture file must be an array",
      });
      return;
    }

    let seeded = 0;
    for (const item of fixtures) {
      if (!item || !("input" in item)) continue;
      const data = fixtureInputToString(item.input);
      recordEvent({
        type: "sse_message",
        data,
        signal: deriveSignalFromSseMessage(data),
      });
      seeded += 1;
    }

    fallbackBootstrapped = true;
    recordEvent({
      type: "bridge_bootstrap_complete",
      reason,
      fixturePath: BOOTSTRAP_FIXTURE_PATH,
      seeded,
    });
  } catch (err) {
    recordEvent({
      type: "bridge_bootstrap_error",
      reason,
      fixturePath: BOOTSTRAP_FIXTURE_PATH,
      error: String(err?.message || err),
    });
  }
}

async function preflightStreamEndpoint(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 5000);

  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "text/event-stream",
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const contentType = String(resp.headers.get("content-type") || "");
    if (!resp.ok) {
      return {
        ok: false,
        status: resp.status,
        contentType,
        reason: "non-2xx response",
      };
    }

    if (!contentType.toLowerCase().includes("text/event-stream")) {
      return {
        ok: false,
        status: resp.status,
        contentType,
        reason: "content-type is not text/event-stream",
      };
    }

    try {
      await resp.body?.cancel();
    } catch {
      // Ignore; preflight only needs headers.
    }

    return {
      ok: true,
      status: resp.status,
      contentType,
      reason: "ok",
    };
  } catch (err) {
    clearTimeout(timeout);
    return {
      ok: false,
      status: null,
      contentType: "",
      reason: String(err?.message || err),
    };
  }
}

function scheduleReconnect(url) {
  const s = getSourceState(url);
  if (s.reconnectTimer) return;
  const waitMs = s.reconnectDelayMs;
  s.reconnectTimer = setTimeout(() => {
    s.reconnectTimer = null;
    connectToSource(url);
  }, waitMs);
  s.reconnectDelayMs = Math.min(s.reconnectDelayMs * 2, RECONNECT_MAX_MS);
  recordEvent({ type: "bridge_reconnect_scheduled", source: url, waitMs });
}

function processIncomingSse(data, sourceUrl) {
  const s = getSourceState(sourceUrl);
  s.lastEventAt = new Date().toISOString();
  recordEvent({
    type: "sse_message",
    source: sourceUrl,
    data,
    signal: deriveSignalFromSseMessage(data),
  });
}

async function connectToSource(url) {
  const s = getSourceState(url);
  const preflight = await preflightStreamEndpoint(url);
  if (!preflight.ok) {
    s.connected = false;
    recordEvent({
      type: "bridge_config_error",
      source: url,
      status: preflight.status,
      contentType: preflight.contentType,
      reason: preflight.reason,
    });
    bootstrapFallbackSignals("stream_preflight_failed");
    scheduleReconnect(url);
    return;
  }

  const es = new EventSource(url);

  es.onopen = () => {
    s.connected = true;
    s.reconnectDelayMs = RECONNECT_BASE_MS;
    recordEvent({ type: "bridge_connected", source: url });
  };

  es.onerror = () => {
    s.connected = false;
    recordEvent({ type: "bridge_disconnected", source: url });
    es.close();
    scheduleReconnect(url);
  };

  es.onmessage = (msg) => processIncomingSse(msg.data, url);

  es.addEventListener("hello",        (msg) => processIncomingSse(msg.data, url));
  es.addEventListener("signal",       (msg) => processIncomingSse(msg.data, url));
  es.addEventListener("state_update", (msg) => processIncomingSse(msg.data, url));
  es.addEventListener("state_expired",(msg) => processIncomingSse(msg.data, url));
}

// ---- HTTP feed pollers — one per UPSTREAM_FEED_SOURCES entry ----
const feedPollState = {};  // url -> { lastSignalId, lastFetched }

function getFeedState(url) {
  if (!feedPollState[url]) feedPollState[url] = { lastSignalId: 0, lastFetched: null };
  return feedPollState[url];
}

async function pollFeedSource(url) {
  const state = getFeedState(url);
  try {
    const fetchUrl = state.lastSignalId > 0 ? `${url}?after_id=${state.lastSignalId}` : url;
    const resp = await fetch(fetchUrl, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return;
    const data = await resp.json();
    state.lastFetched = new Date().toISOString();

    const items = data?.items ?? data?.signals ?? data?.results ?? [];
    if (!Array.isArray(items)) return;

    let newMax = state.lastSignalId;
    for (const item of items) {
      const itemId = Number(item?.id || 0);
      if (itemId > 0 && itemId <= state.lastSignalId) continue;
      if (itemId > newMax) newMax = itemId;
      const synthetic = JSON.stringify({ ...item, source_class: "http_feed", _feed_source: url });
      recordEvent({
        type: "sse_message",
        source: url,
        data: synthetic,
        signal: deriveSignalFromSseMessage(synthetic),
      });
    }
    if (newMax > state.lastSignalId) state.lastSignalId = newMax;
  } catch {
    // Source may be down — non-fatal, will retry next interval
  }
}

function startFeedPollers() {
  for (const { url, pollMs } of UPSTREAM_FEED_SOURCES) {
    console.log(`[LISA] HTTP feed source: ${url} (poll every ${pollMs}ms)`);
    pollFeedSource(url);
    setInterval(() => pollFeedSource(url), pollMs);
  }
}

// ---- Express server ----
const app = express();

// Basic hard safety: this bridge is read-only; no POST routes exist.
// (If someone adds one later, it is an intentional act.)

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    sseConnected: isSseConnected(),
    lastEventAt: getLastEventAt(),
    sources: {
      sse: UPSTREAM_SSE_SOURCES.map((url) => ({
        url,
        connected: getSourceState(url).connected,
        lastEventAt: getSourceState(url).lastEventAt,
      })),
      feeds: UPSTREAM_FEED_SOURCES.map(({ url, pollMs }) => ({
        url,
        pollMs,
        lastFetched: getFeedState(url).lastFetched,
        lastSignalId: getFeedState(url).lastSignalId,
      })),
    },
    totalSources: UPSTREAM_SSE_SOURCES.length + UPSTREAM_FEED_SOURCES.length,
    bufferedEvents: events.length,
    maxBufferedEvents: MAX_EVENTS,
    uptimeSeconds: Math.floor(process.uptime()),
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

  const filtered = events
    .filter((e) => e.type === "sse_message")
    .filter((e) => (afterId > 0 ? e.id > afterId : true));

  const sliced = filtered.slice(-limit);

  const signals = sliced.map(mapEventToApiSignal);

  res.json({
    count: signals.length,
    latestId: events.length ? events[events.length - 1].id : 0,
    signals,
  });
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
  <title>4data Stream Bridge Dashboard</title>
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
  <h2>4data Stream Bridge</h2>

  <div class="row">
    <div class="card">
      <div class="k">Bridge</div>
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
  document.getElementById("bridge").textContent =
    "port=" + health.bridgePort + "  v1=" + health.v1StreamUrl;

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
  console.log("[LISA] listening on port " + PORT);
  console.log("[LISA] SSE sources (" + UPSTREAM_SSE_SOURCES.length + "): " + UPSTREAM_SSE_SOURCES.join(", "));
  console.log("[LISA] Feed sources (" + UPSTREAM_FEED_SOURCES.length + "): " + UPSTREAM_FEED_SOURCES.map((s) => s.url).join(", "));
  console.log("[LISA] Total sources: " + (UPSTREAM_SSE_SOURCES.length + UPSTREAM_FEED_SOURCES.length));

  // Connect to all SSE sources independently
  for (const url of UPSTREAM_SSE_SOURCES) {
    connectToSource(url).catch((err) => {
      console.error("[LISA] Failed to connect to source " + url + ":", err);
      recordEvent({ type: "bridge_connect_error", source: url, reason: String(err?.message || err) });
      scheduleReconnect(url);
    });
  }

  // Start all HTTP feed pollers
  startFeedPollers();
});

let shuttingDown = false;
function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  drainEventsToFile(reason);
  for (const s of Object.values(sourceState)) {
    if (s.reconnectTimer) clearTimeout(s.reconnectTimer);
  }
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
