import { shouldAlert } from "./interpreter.js";

const BRIDGE = "http://localhost:3100";

let afterId = 0;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function oneLine(o) {
  try {
    if (typeof o === "string") return o;
    return JSON.stringify(o);
  } catch {
    return String(o);
  }
}

async function pollOnce() {
  const url = BRIDGE + "/signals?limit=200&afterId=" + afterId;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const payload = await r.json();

  const signals = payload.signals || [];
  for (const s of signals) {
    afterId = Math.max(afterId, s.id);
    const lane = s.lane || s.signal || "unknown";
    const observedFact = String(s.observed_fact || "").toLowerCase();

    // Alert rules (tight, actionable)
    if (shouldAlert(s)) {
      process.stdout.write("\x07"); // terminal bell
      console.log(
        "[ALERT] capacity_tightening at " +
          s.receivedAt +
          " raw=" +
          oneLine(s.raw)
      );
    }

    if (lane === "state_change" && observedFact.includes("expired")) {
      console.log("[INFO] state_expired at " + s.receivedAt);
    }
  }
}

async function main() {
  console.log("[watch] polling /signals for alerts (Ctrl+C to stop)");
  while (true) {
    try {
      await pollOnce();
    } catch (e) {
      console.log("[watch] error: " + e.message);
    }
    await sleep(1000);
  }
}

main().catch((e) => {
  console.log("[watch] fatal: " + e.message);
  process.exit(1);
});
