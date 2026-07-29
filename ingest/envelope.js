import { PACKET_SCHEMA_VERSION } from "./contract.js";

export function buildPacket({
  sourceSystem,
  sourceSystemVersion = "unknown",
  packetType,
  generatedAt = new Date().toISOString(),
  lane = "unclassified",
  priority = "normal",
  summary = "",
  items = [],
  evidenceRefs = [],
  freshUntil = null,
  publishStatus = "published",
}) {
  return {
    schema_version: PACKET_SCHEMA_VERSION,
    source_system: sourceSystem,
    source_system_version: sourceSystemVersion,
    packet_type: packetType,
    generated_at: generatedAt,
    lane,
    priority,
    summary,
    items,
    evidence_refs: evidenceRefs,
    fresh_until: freshUntil,
    publish_status: publishStatus,
  };
}
