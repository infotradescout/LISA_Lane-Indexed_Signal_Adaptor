import fs from "node:fs";
import path from "node:path";

const BRIDGE = process.env.BRIDGE_URL || "http://localhost:3100";
const TARGET_COUNT = Number(process.env.CAPTURE_COUNT || 50);
const OUT_PATH =
  process.env.OUT_PATH || path.join(process.cwd(), "fixtures", "replay-events.json");

function toOneLineString(v) {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

async function main() {
  const url = `${BRIDGE}/events?limit=${Math.max(TARGET_COUNT * 3, 200)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status + " from " + url);

  const data = await res.json();
  const sseEvents = (data.events || []).filter((e) => e.type === "sse_message");

  const unique = [];
  const seen = new Set();
  for (const e of sseEvents) {
    const key = toOneLineString(e.data);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(e);
    }
  }

  const selected = unique.slice(-TARGET_COUNT).map((e) => ({
    id: `event_${e.id}`,
    input: e.data,
    expected: {
      lane: null,
      min_confidence: 0.0,
      entity: null,
      change: null,
      should_alert: false,
    },
  }));

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(selected, null, 2) + "\n", "utf8");

  console.log("[capture] wrote", selected.length, "fixtures to", OUT_PATH);
  console.log("[capture] label expected.lane/min_confidence/entity/change/should_alert before replay");
}

main().catch((err) => {
  console.error("[capture] error:", err.message);
  process.exit(1);
});
