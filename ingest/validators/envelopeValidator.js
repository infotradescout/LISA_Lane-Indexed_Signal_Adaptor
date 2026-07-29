import { PACKET_OUTER_FIELDS, PACKET_SCHEMA_VERSION } from "../contract.js";

const REQUIRED_FIELDS = Object.freeze([
  "schema_version",
  "source_system",
  "source_system_version",
  "packet_type",
  "generated_at",
  "items",
  "publish_status",
]);

function isIsoDate(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf());
}

export function validateIngestionEnvelope(packet) {
  const errors = [];

  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    return {
      ok: false,
      errors: ["packet must be a JSON object"],
      unknownFields: [],
    };
  }

  const unknownFields = Object.keys(packet).filter((k) => !PACKET_OUTER_FIELDS.includes(k));

  for (const field of REQUIRED_FIELDS) {
    if (packet[field] == null) errors.push("missing required field: " + field);
  }

  if (packet.schema_version && packet.schema_version !== PACKET_SCHEMA_VERSION) {
    errors.push(
      "unsupported schema_version: " +
        packet.schema_version +
        " (expected " +
        PACKET_SCHEMA_VERSION +
        ")"
    );
  }

  if (packet.generated_at && !isIsoDate(packet.generated_at)) {
    errors.push("generated_at must be an ISO date string");
  }

  if (packet.fresh_until != null && !isIsoDate(packet.fresh_until)) {
    errors.push("fresh_until must be an ISO date string when present");
  }

  if (packet.items != null && !Array.isArray(packet.items)) {
    errors.push("items must be an array");
  }

  if (packet.evidence_refs != null && !Array.isArray(packet.evidence_refs)) {
    errors.push("evidence_refs must be an array when present");
  }

  return {
    ok: errors.length === 0,
    errors,
    unknownFields,
  };
}
