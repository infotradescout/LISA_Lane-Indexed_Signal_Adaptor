export const INTERPRETER_VERSION = "lisa_bridge_v1_1_rule_based";

export const LANE_ONTOLOGY = Object.freeze([
  "search_intent",
  "entity_interest",
  "decision_progression",
  "action_taken",
  "friction_dropoff",
  "supply_signal",
  "state_change",
  "trend_momentum",
  "unclassified",
]);

export const SIGNAL_CONTRACT_FIELDS = Object.freeze([
  "lane",
  "confidence",
  "observed_fact",
  "entity",
  "location",
  "change",
  "source_class",
  "source",
  "raw",
  "payload",
]);

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

export function parseEvent(dataStr) {
  const parsed = safeJsonParse(dataStr);

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return {
      raw: parsed,
      type: parsed.type || parsed.event || null,
      payload: parsed.payload || parsed,
    };
  }

  return {
    raw: dataStr,
    type: "text",
    payload: dataStr,
  };
}

export function normalizeEvent(evt) {
  return {
    observed_fact: evt.type,
    raw: evt.raw,
    payload: evt.payload,
    source: "v1_stream",
  };
}

export function classifyLane(normalized) {
  const observed = String(normalized.observed_fact || "").toLowerCase();
  const payloadText = String(
    typeof normalized.payload === "string"
      ? normalized.payload
      : JSON.stringify(normalized.payload || {})
  ).toLowerCase();
  const combined = observed + " " + payloadText;

  if (!combined.trim()) return { lane: "unclassified", confidence: 0.3 };

  if (combined.includes("search")) return { lane: "search_intent", confidence: 0.9 };
  if (combined.includes("capacity_tightening")) {
    return { lane: "supply_signal", confidence: 0.9 };
  }
  if (combined.includes("update")) return { lane: "supply_signal", confidence: 0.7 };
  if (combined.includes("expired")) return { lane: "state_change", confidence: 0.8 };
  if (combined.includes("trend") || combined.includes("momentum")) {
    return { lane: "trend_momentum", confidence: 0.75 };
  }
  if (combined.includes("action") || combined.includes("executed")) {
    return { lane: "action_taken", confidence: 0.8 };
  }

  return { lane: "unclassified", confidence: 0.4 };
}

function inferSignalDetails(normalized, classification) {
  const payload = normalized.payload;
  const pick = (...candidates) => {
    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) return c;
    }
    return null;
  };

  const entity =
    payload && typeof payload === "object"
      ? pick(
          payload.entity,
          payload.subject,
          payload.resource,
          payload.kind,
          payload.type
        )
      : null;

  const location =
    payload && typeof payload === "object"
      ? pick(payload.location, payload.region, payload.market, payload.city)
      : null;

  const change =
    payload && typeof payload === "object"
      ? pick(payload.change, payload.status, payload.action, normalized.observed_fact)
      : normalized.observed_fact;

  const sourceClass =
    classification.lane === "search_intent" ? "internal_inference" : "external_stream";

  return {
    entity,
    location,
    change,
    source_class: sourceClass,
  };
}

function applyAmbiguityPolicy(signal) {
  const reasons = [];

  if (signal.confidence < 0.75) reasons.push("low_confidence");
  if (signal.lane === "unclassified") reasons.push("unclassified_lane");

  return {
    ...signal,
    ambiguous: reasons.length > 0,
    needs_review: reasons.length > 0,
    review_reason: reasons.length ? reasons.join(",") : null,
  };
}

function toSignalContract(signal) {
  const contract = {};
  for (const key of SIGNAL_CONTRACT_FIELDS) {
    contract[key] = signal[key] ?? null;
  }
  return contract;
}

export function deriveSignalFromSseMessage(dataStr) {
  const parsed = parseEvent(dataStr);
  const normalized = normalizeEvent(parsed);
  const classification = classifyLane(normalized);
  const details = inferSignalDetails(normalized, classification);

  const baseSignal = {
    lane: classification.lane,
    confidence: classification.confidence,
    observed_fact: normalized.observed_fact,
    entity: details.entity,
    location: details.location,
    change: details.change,
    source_class: details.source_class,
    source: normalized.source,
    raw: normalized.raw,
    payload: normalized.payload,
  };

  return applyAmbiguityPolicy(toSignalContract(baseSignal));
}

export function shouldAlert(signal) {
  const lane = String(signal?.lane || "").toLowerCase();
  const observedFact = String(signal?.observed_fact || "").toLowerCase();
  const rawText = String(
    typeof signal?.raw === "string" ? signal.raw : JSON.stringify(signal?.raw || {})
  ).toLowerCase();

  if (
    lane === "supply_signal" &&
    (observedFact.includes("capacity_tightening") || rawText.includes("capacity_tightening"))
  ) {
    return true;
  }

  return false;
}
