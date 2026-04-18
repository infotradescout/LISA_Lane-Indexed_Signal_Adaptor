export const INTERPRETER_VERSION = "lisa_bridge_v2_0_domain";

// Canonical LISA lane taxonomy — matches SignalFactory signal_specs.yaml, gulf-live-stream
// and business-presence-engine lane classifications.
export const LANE_ONTOLOGY = Object.freeze([
  "macro",          // macroeconomic conditions, GDP, inflation, rates, employment
  "business",       // local/regional business activity, demand signals, sector health
  "risk",           // threat signals: weather, regulatory, financial, social unrest
  "infrastructure", // construction, permits, logistics, utilities, ports, roads
  "community",      // local social fabric, elections, schools, demographics
  "presence",       // AI-era digital presence: listings, reviews, ad placement, intent
  "market",         // capital markets, equities, commodities, exchange rates
  "supply",         // supply chain, capacity, inventory, sourcing
  "unclassified",
]);

export const SIGNAL_CONTRACT_FIELDS = Object.freeze([
  "lane",
  "signal_kind",
  "confidence",
  "score",
  "impact_level",
  "trend",
  "velocity",
  "observed_fact",
  "entity",
  "location",
  "change",
  "source_class",
  "source",
  "action_hint",
  "tags",
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

// ── Domain-aware lane classifier ─────────────────────────────────────────────
// Patterns are ordered: most-specific first to avoid cross-lane false positives.
const LANE_RULES = [
  {
    lane: "risk",
    confidence: 0.88,
    terms: ["hurricane","storm","flood","tornado","wildfire","earthquake","disaster",
            "evacuation","emergency","alert","warning","threat","outage","attack",
            "fraud","cyberattack","data breach","default","bankruptcy","recall"],
  },
  {
    lane: "presence",
    confidence: 0.86,
    terms: ["listing","review","rating","google business","yelp","tripadvisor",
            "near me","local search","ai recommend","ai suggest","chatgpt",
            "digital presence","advertis","ad placement","seo","local seo",
            "business profile","verified","unclaimed","presence gap",
            "intent spike","review velocity","competitor surge","listing health"],
  },
  {
    lane: "infrastructure",
    confidence: 0.85,
    terms: ["permit","construction","road","bridge","port","pipeline","utility",
            "power grid","broadband","fiber","logistics","freight","highway",
            "zoning","building code","water system","sewer","transit"],
  },
  {
    lane: "macro",
    confidence: 0.84,
    terms: ["gdp","inflation","cpi","interest rate","federal reserve","fed funds",
            "unemployment","jobs report","payroll","recession","economic growth",
            "trade","tariff","export","import","currency","m2","money supply",
            "consumer confidence","ppi","labor market"],
  },
  {
    lane: "market",
    confidence: 0.83,
    terms: ["stock","equity","nasdaq","s&p","dow jones","earnings","ipo",
            "commodity","oil price","gold","bitcoin","crypto","bond","yield",
            "volatility","vix","hedge fund","etf","dividend","pe ratio"],
  },
  {
    lane: "supply",
    confidence: 0.83,
    terms: ["supply chain","inventory","shortage","backlog","capacity","lead time",
            "supplier","procurement","warehouse","distribution","shipping delay",
            "out of stock","raw material","sourcing"],
  },
  {
    lane: "business",
    confidence: 0.81,
    terms: ["restaurant","retail","hotel","tourism","store","small business",
            "franchise","startup","revenue","sales","demand","customer",
            "service industry","food service","hospitality","real estate",
            "commercial","lease","tenant","foot traffic","e-commerce"],
  },
  {
    lane: "community",
    confidence: 0.78,
    terms: ["election","mayor","council","school","parish","county","municipal",
            "community","neighborhood","resident","demographic","population",
            "poverty","crime","public safety","social","protest","local government"],
  },
];

export function classifyLane(normalized) {
  const observed = String(normalized.observed_fact || "").toLowerCase();
  const payloadText = String(
    typeof normalized.payload === "string"
      ? normalized.payload
      : JSON.stringify(normalized.payload || {})
  ).toLowerCase();
  // Also read lane/signal_kind if the inbound event already carries one.
  const inboundLane = String(
    (normalized.raw && typeof normalized.raw === "object" && normalized.raw.lane) ||
    (normalized.payload && typeof normalized.payload === "object" && normalized.payload.lane) ||
    ""
  ).toLowerCase();

  // Trust the inbound lane if it's already a canonical one.
  const canonicalLanes = LANE_ONTOLOGY.filter((l) => l !== "unclassified");
  if (inboundLane && canonicalLanes.includes(inboundLane)) {
    const rule = LANE_RULES.find((r) => r.lane === inboundLane);
    return { lane: inboundLane, confidence: rule ? rule.confidence : 0.80 };
  }

  const combined = observed + " " + payloadText;
  if (!combined.trim()) return { lane: "unclassified", confidence: 0.3 };

  for (const rule of LANE_RULES) {
    if (rule.terms.some((term) => combined.includes(term))) {
      return { lane: rule.lane, confidence: rule.confidence };
    }
  }

  return { lane: "unclassified", confidence: 0.4 };
}

// ── Impact level derivation ───────────────────────────────────────────────────
const CRITICAL_TERMS = ["hurricane","disaster","bankruptcy","evacuation","emergency","recall","default","cyberattack","data breach"];
const HIGH_TERMS     = ["storm","flood","outage","shortage","fraud","strike","collapse","surge","spike","gap"];
const LOW_TERMS      = ["review","listing","permit","update","plan","proposal","study"];

function deriveImpactLevel(text, lane) {
  const t = text.toLowerCase();
  if (CRITICAL_TERMS.some((k) => t.includes(k))) return "critical";
  if (HIGH_TERMS.some((k) => t.includes(k)))     return "high";
  if (lane === "macro" || lane === "market")      return "medium";
  if (LOW_TERMS.some((k) => t.includes(k)))      return "low";
  return "medium";
}

// ── Trend direction ───────────────────────────────────────────────────────────
const RISING_TERMS  = ["rise","rising","surge","spike","increase","accelerat","growth","up","gain","boom","open","expand"];
const FALLING_TERMS = ["fall","falling","drop","decline","decreas","contraction","down","loss","close","shutting","layoff"];
const SPIKE_TERMS   = ["sudden","unexpected","record","unprecedented","shock","burst"];

function deriveTrend(text) {
  const t = text.toLowerCase();
  if (SPIKE_TERMS.some((k) => t.includes(k)))   return "spike";
  if (RISING_TERMS.some((k) => t.includes(k)))  return "rising";
  if (FALLING_TERMS.some((k) => t.includes(k))) return "falling";
  return "neutral";
}

// ── Signal kind from lane ─────────────────────────────────────────────────────
const LANE_DEFAULT_KIND = {
  macro:          "macro_indicator",
  business:       "operational_health",
  risk:           "risk_event",
  infrastructure: "infrastructure_update",
  community:      "community_signal",
  presence:       "listing_health",
  market:         "market_movement",
  supply:         "supply_constraint",
  unclassified:   "raw_event",
};

// ── Action hints ──────────────────────────────────────────────────────────────
const LANE_ACTION_HINTS = {
  risk:           "Monitor for escalation; flag affected business clients in region.",
  presence:       "Audit business listing completeness and review velocity. Claim unclaimed profiles.",
  infrastructure: "Track for downstream impact on local construction and logistics clients.",
  macro:          "Update macro model inputs; recalibrate local demand forecasts.",
  market:         "Check sector exposure for regional business portfolio.",
  supply:         "Alert procurement-dependent clients; evaluate alternative sourcing paths.",
  business:       "Identify which local business category is affected; surface to operators.",
  community:      "Note demographic or policy shift; adjust long-range presence strategy.",
  unclassified:   "Review raw event for manual lane assignment.",
};

function inferSignalDetails(normalized, classification) {
  const payload = normalized.payload;
  const pick = (...candidates) => {
    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) return c;
    }
    return null;
  };

  const rawText = String(
    typeof normalized.raw === "string"
      ? normalized.raw
      : JSON.stringify(normalized.raw || {})
  );
  const payloadText = String(
    typeof payload === "string" ? payload : JSON.stringify(payload || {})
  );
  const combinedText = rawText + " " + payloadText;

  const entity =
    payload && typeof payload === "object"
      ? pick(payload.entity, payload.subject, payload.resource, payload.kind, payload.type)
      : null;

  const location =
    payload && typeof payload === "object"
      ? pick(payload.location, payload.region, payload.market, payload.city)
      : null;

  const change =
    payload && typeof payload === "object"
      ? pick(payload.change, payload.status, payload.action, normalized.observed_fact)
      : normalized.observed_fact;

  const sourceClass = ["community","unclassified"].includes(classification.lane)
    ? "inferred"
    : "external_stream";

  // Enrich inbound payload fields if caller already supplied them.
  const inboundKind = payload && typeof payload === "object" ? payload.signal_kind || payload.kind : null;
  const inboundTags = payload && typeof payload === "object" && Array.isArray(payload.tags) ? payload.tags : null;
  const inboundScore = payload && typeof payload === "object" ? payload.score ?? null : null;
  const inboundHint = payload && typeof payload === "object" ? payload.action_hint ?? null : null;

  return {
    entity,
    location,
    change,
    source_class: sourceClass,
    signal_kind:  inboundKind  || LANE_DEFAULT_KIND[classification.lane] || "raw_event",
    impact_level: (payload && payload.impact_level) || deriveImpactLevel(combinedText, classification.lane),
    trend:        (payload && payload.trend)        || deriveTrend(combinedText),
    velocity:     (payload && typeof payload === "object" ? payload.velocity ?? null : null),
    action_hint:  inboundHint  || LANE_ACTION_HINTS[classification.lane] || null,
    tags:         inboundTags  || [classification.lane],
    score:        inboundScore !== null ? Number(inboundScore) : Math.round(classification.confidence * 100),
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
    lane:          classification.lane,
    signal_kind:   details.signal_kind,
    confidence:    classification.confidence,
    score:         details.score,
    impact_level:  details.impact_level,
    trend:         details.trend,
    velocity:      details.velocity,
    observed_fact: normalized.observed_fact,
    entity:        details.entity,
    location:      details.location,
    change:        details.change,
    source_class:  details.source_class,
    source:        normalized.source,
    action_hint:   details.action_hint,
    tags:          details.tags,
    raw:           normalized.raw,
    payload:       normalized.payload,
  };

  return applyAmbiguityPolicy(toSignalContract(baseSignal));
}

export function shouldAlert(signal) {
  const lane        = String(signal?.lane || "").toLowerCase();
  const impact      = String(signal?.impact_level || "").toLowerCase();
  const observed    = String(signal?.observed_fact || "").toLowerCase();
  const rawText     = String(
    typeof signal?.raw === "string" ? signal.raw : JSON.stringify(signal?.raw || {})
  ).toLowerCase();

  if (impact === "critical") return true;
  if (lane === "risk" && (observed || rawText)) return true;
  if (lane === "supply" && (observed.includes("shortage") || rawText.includes("shortage"))) return true;
  return false;
}
