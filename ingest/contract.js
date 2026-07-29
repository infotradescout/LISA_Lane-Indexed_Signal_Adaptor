export const PACKET_SCHEMA_VERSION = "1.0.0";

export const PACKET_OUTER_FIELDS = Object.freeze([
  "schema_version",
  "source_system",
  "source_system_version",
  "packet_type",
  "generated_at",
  "lane",
  "priority",
  "summary",
  "items",
  "evidence_refs",
  "fresh_until",
  "publish_status",
]);

export const CANONICAL_SIGNAL_FIELDS = Object.freeze([
  "signal_id",
  "source_system",
  "source_type",
  "lane",
  "entity",
  "topic",
  "category",
  "summary",
  "confidence",
  "novelty",
  "relevance",
  "severity",
  "evidence_refs",
  "contradiction_refs",
  "generated_at",
  "fresh_until",
  "raw_payload",
]);

export const TRUST_PROFILES = Object.freeze({
  autobott: Object.freeze({
    confidenceMultiplier: 1.1,
    defaultDecayMinutes: 180,
    contradictionWeight: 1.1,
    memoryPromotionBias: 0.8,
  }),
  newsfilter: Object.freeze({
    confidenceMultiplier: 1.0,
    defaultDecayMinutes: 45,
    contradictionWeight: 0.9,
    memoryPromotionBias: 0.55,
  }),
  factdeck: Object.freeze({
    confidenceMultiplier: 1.15,
    defaultDecayMinutes: 1440,
    contradictionWeight: 1.2,
    memoryPromotionBias: 1.0,
  }),
  signalfactory: Object.freeze({
    confidenceMultiplier: 0.95,
    defaultDecayMinutes: 120,
    contradictionWeight: 1.0,
    memoryPromotionBias: 0.6,
  }),
  v1_stream: Object.freeze({
    confidenceMultiplier: 0.9,
    defaultDecayMinutes: 30,
    contradictionWeight: 0.8,
    memoryPromotionBias: 0.45,
  }),
  unknown: Object.freeze({
    confidenceMultiplier: 0.85,
    defaultDecayMinutes: 30,
    contradictionWeight: 0.75,
    memoryPromotionBias: 0.4,
  }),
});

export function getTrustProfile(sourceSystem) {
  return TRUST_PROFILES[sourceSystem] || TRUST_PROFILES.unknown;
}
