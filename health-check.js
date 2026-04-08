const BRIDGE = "http://localhost:3100";

function fmt(ts) {
  if (!ts) return "none";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toISOString();
}

async function main() {
  const r = await fetch(BRIDGE + "/health", { cache: "no-store" });
  if (!r.ok) {
    console.log(`[BRIDGE DOWN] http=${r.status}`);
    process.exit(2);
  }
  const h = await r.json();

  const conn = h.sseConnected ? "CONNECTED" : "DISCONNECTED";
  const last = fmt(h.lastEventAt);
  const up = Number(h.uptimeSeconds || 0);

  console.log(
    `[BRIDGE ${conn}] buffered=${h.bufferedEvents}/${h.maxBufferedEvents} last=${last} uptime=${up}s v1=${h.v1StreamUrl}`
  );

  process.exit(h.sseConnected ? 0 : 1);
}

main().catch((e) => {
  console.log(`[BRIDGE ERROR] ${e.message}`);
  process.exit(2);
});
);
