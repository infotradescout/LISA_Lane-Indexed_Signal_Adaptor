const LANE_BY_TOPIC_HINT = Object.freeze({
  macro: "trend_momentum",
  execution: "action_taken",
  liquidity: "supply_signal",
  sentiment: "trend_momentum",
  volatility: "state_change",
});

export function routeLane(signal, packetLane) {
  if (signal.lane && signal.lane !== "unclassified") return signal.lane;

  const hinted = String(signal.topic || "").toLowerCase();
  for (const [hint, lane] of Object.entries(LANE_BY_TOPIC_HINT)) {
    if (hinted.includes(hint)) return lane;
  }

  if (packetLane && String(packetLane).trim()) return packetLane;
  return "unclassified";
}
