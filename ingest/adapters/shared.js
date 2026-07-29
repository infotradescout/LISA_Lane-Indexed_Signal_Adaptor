function coerceNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < 0) return 0;
  if (parsed > 1) return 1;
  return parsed;
}

function pickString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function coerceArray(value) {
  if (Array.isArray(value)) return value;
  return [];
}

export function normalizeItemToCanonical({ packet, item, sourceType = "knowledge_packet", signalId }) {
  return {
    signal_id: signalId,
    source_system: packet.source_system,
    source_type: sourceType,
    lane: pickString(item.lane, packet.lane, "unclassified"),
    entity: pickString(item.entity, item.ticker, item.symbol, item.subject),
    topic: pickString(item.topic, item.theme, item.event_type, packet.packet_type),
    category: pickString(item.category, item.kind, packet.packet_type, "general"),
    summary: pickString(item.summary, item.claim, item.title, packet.summary, "unspecified"),
    confidence: coerceNumber(item.confidence, 0.5),
    novelty: coerceNumber(item.novelty, 0.5),
    relevance: coerceNumber(item.relevance, 0.5),
    severity: coerceNumber(item.severity, 0.2),
    evidence_refs: coerceArray(item.evidence_refs).concat(coerceArray(packet.evidence_refs)),
    contradiction_refs: coerceArray(item.contradiction_refs),
    generated_at: pickString(item.generated_at, packet.generated_at, new Date().toISOString()),
    fresh_until: pickString(item.fresh_until, packet.fresh_until, null),
    raw_payload: item,
  };
}

export function normalizePacketItems(packet, sourceType = "knowledge_packet") {
  return (packet.items || []).map((item, idx) =>
    normalizeItemToCanonical({
      packet,
      item: item || {},
      sourceType,
      signalId: packet.source_system + ":" + packet.generated_at + ":" + idx,
    })
  );
}
