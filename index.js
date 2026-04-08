import express from "express";
import { EventSource } from "eventsource";
import {
  deriveSignalFromSseMessage,
  INTERPRETER_VERSION,
  LANE_ONTOLOGY,
  SIGNAL_CONTRACT_FIELDS,
} from "./interpreter.js";

const V1_STREAM_URL = "http://localhost:3000/stream";
const PORT = 3100;

// ---- In-memory ring buffer ----
const MAX_EVENTS = 200;
const events = [];
let seq = 0;

function recordEvent(evt) {
  const entry = {
    id: ++seq,
    ...evt,
    receivedAt: new Date().toISOString(),
  };
  events.push(entry);
  while (events.length > MAX_EVENTS) events.shift();
  return entry;
}

// ---- SSE connection ----
let sseConnected = false;
let lastEventAt = null;

function connectToV1() {
  const es = new EventSource(V1_STREAM_URL);

  es.onopen = () => {
    sseConnected = true;
    recordEvent({ type: "bridge_connected" });
  };

  es.onerror = () => {
    sseConnected = false;
    recordEvent({ type: "bridge_disconnected" });
    es.close();
    setTimeout(connectToV1, 2000);
  };

  // Generic message handler (for events without explicit event: field)
  es.onmessage = (msg) => {
    lastEventAt = new Date().toISOString();
    const data = msg.data;

    const signal = deriveSignalFromSseMessage(data);

    recordEvent({
      type: "sse_message",
      data,
      signal,
    });
  };

  // Specific event handlers for v1's named events
  es.addEventListener("hello", (msg) => {
    try {
      console.log("[hello event] received");
      lastEventAt = new Date().toISOString();
      const data = msg.data;
      recordEvent({
        type: "sse_message",
        data,
        signal: deriveSignalFromSseMessage(data),
      });
      console.log("[hello event] processed");
    } catch (err) {
      console.error("[hello event] ERROR:", err);
    }
  });

  es.addEventListener("state_update", (msg) => {
    try {
      console.log("[state_update event] received");
      lastEventAt = new Date().toISOString();
      const data = msg.data;
      recordEvent({
        type: "sse_message",
        data,
        signal: deriveSignalFromSseMessage(data),
      });
      console.log("[state_update event] processed");
    } catch (err) {
      console.error("[state_update event] ERROR:", err);
    }
  });

  es.addEventListener("state_expired", (msg) => {
    try {
      console.log("[state_expired event] received");
      lastEventAt = new Date().toISOString();
      const data = msg.data;
      recordEvent({
        type: "sse_message",
        data,
        signal: deriveSignalFromSseMessage(data),
      });
      console.log("[state_expired event] processed");
    } catch (err) {
      console.error("[state_expired event] ERROR:", err);
    }
  });
}

// ---- Express server ----
const app = express();

// Basic hard safety: this bridge is read-only; no POST routes exist.
// (If someone adds one later, it is an intentional act.)

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    sseConnected,
    lastEventAt,
    bufferedEvents: events.length,
    maxBufferedEvents: MAX_EVENTS,
    uptimeSeconds: Math.floor(process.uptime()),
    v1StreamUrl: V1_STREAM_URL,
    bridgePort: PORT,
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

  const signals = sliced.map((e) => ({
    id: e.id,
    receivedAt: e.receivedAt,
    lane: e.signal?.lane ?? "unknown",
    confidence: e.signal?.confidence ?? 0,
    observed_fact: e.signal?.observed_fact ?? null,
    source: e.signal?.source ?? "unknown",
    entity: e.signal?.entity ?? null,
    location: e.signal?.location ?? null,
    change: e.signal?.change ?? null,
    source_class: e.signal?.source_class ?? "external_stream",
    ambiguous: !!e.signal?.ambiguous,
    needs_review: !!e.signal?.needs_review,
    review_reason: e.signal?.review_reason ?? null,
    signal: e.signal?.lane ?? "unknown",
    raw: e.signal?.raw ?? e.data ?? null,
    payload: e.signal?.payload ?? null,
  }));

  res.json({
    count: signals.length,
    latestId: events.length ? events[events.length - 1].id : 0,
    signals,
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

app.listen(PORT, () => {
  console.log("[bridge] listening on port " + PORT);
  try {
    connectToV1();
  } catch (err) {
    console.error("[ERROR] Failed to connect to v1:", err);
  }
});
