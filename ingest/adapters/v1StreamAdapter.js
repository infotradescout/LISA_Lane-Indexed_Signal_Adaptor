import { deriveSignalFromSseMessage } from "../../interpreter.js";

function toCanonicalFromLegacy(packet, legacySignal) {
  return {
    signal_id: packet.source_system + ":" + packet.generated_at + ":0",
    source_system: packet.source_system,
    source_type: "legacy_sse_bridge",
    lane: legacySignal.lane || packet.lane || "unclassified",
    entity: legacySignal.entity || null,
    topic: packet.packet_type || "stream_event",
    category: "stream_event",
    summary: legacySignal.observed_fact || packet.summary || "v1_stream_event",
    confidence: Number(legacySignal.confidence || 0.4),
    novelty: 0.45,
    relevance: 0.55,
    severity: 0.2,
    evidence_refs: packet.evidence_refs || [],
    contradiction_refs: [],
    generated_at: packet.generated_at,
    fresh_until: packet.fresh_until || null,
    raw_payload: {
      item: packet.items?.[0] || null,
      legacySignal,
    },
  };
}

export function v1StreamAdapter(packet) {
  const first = packet.items?.[0] || {};
  const rawData =
    typeof first.raw === "string" ? first.raw : JSON.stringify(first.raw ?? first.payload ?? first);
  const legacySignal = deriveSignalFromSseMessage(rawData);
  return [toCanonicalFromLegacy(packet, legacySignal)];
}
