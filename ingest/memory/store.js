import { getTrustProfile } from "../contract.js";

const SHORT_TERM_MAX = 800;
const DURABLE_MAX = 2000;

const shortTermSignals = [];
const durableKnowledge = [];

const sourceStats = new Map();

function nowIso() {
  return new Date().toISOString();
}

function getSourceState(sourceSystem) {
  if (!sourceStats.has(sourceSystem)) {
    sourceStats.set(sourceSystem, {
      source_system: sourceSystem,
      last_packet_received: null,
      packet_count: 0,
      validation_errors: 0,
      last_ingest_status: "never",
      new_signals_count: 0,
      contradictions_found: 0,
      promoted_to_memory_count: 0,
    });
  }
  return sourceStats.get(sourceSystem);
}

function summarizePolarity(signal) {
  const text = String(signal.summary || "").toLowerCase();
  if (
    text.includes("bear") ||
    text.includes("down") ||
    text.includes("decline") ||
    text.includes("negative")
  ) {
    return "negative";
  }
  if (
    text.includes("bull") ||
    text.includes("up") ||
    text.includes("rise") ||
    text.includes("positive")
  ) {
    return "positive";
  }
  return "neutral";
}

function isContradictory(a, b) {
  const sameEntity = !!a.entity && !!b.entity && a.entity === b.entity;
  const sameTopic = !!a.topic && !!b.topic && a.topic === b.topic;
  if (!sameEntity && !sameTopic) return false;

  const aPolarity = summarizePolarity(a);
  const bPolarity = summarizePolarity(b);
  return (
    (aPolarity === "positive" && bPolarity === "negative") ||
    (aPolarity === "negative" && bPolarity === "positive")
  );
}

function getRecentCandidates(signal) {
  const now = Date.now();
  return shortTermSignals.filter((candidate) => {
    const ts = Date.parse(candidate.generated_at || candidate._ingested_at || nowIso());
    if (!Number.isFinite(ts)) return false;
    if (now - ts > 1000 * 60 * 60 * 24) return false;
    return candidate.signal_id !== signal.signal_id;
  });
}

export function recordValidationError(sourceSystem) {
  const src = getSourceState(sourceSystem || "unknown");
  src.validation_errors += 1;
  src.last_packet_received = nowIso();
  src.last_ingest_status = "validation_error";
}

export function storeSignals(sourceSystem, signals) {
  const src = getSourceState(sourceSystem || "unknown");
  src.packet_count += 1;
  src.last_packet_received = nowIso();
  src.last_ingest_status = "ok";
  src.new_signals_count += signals.length;

  const contradictions = [];
  let promoted = 0;

  for (const signal of signals) {
    signal._ingested_at = nowIso();
    const matches = getRecentCandidates(signal).filter((candidate) => isContradictory(signal, candidate));
    if (matches.length) {
      const refs = matches.map((m) => m.signal_id).slice(0, 10);
      signal.contradiction_refs = Array.from(new Set([...(signal.contradiction_refs || []), ...refs]));
      contradictions.push({
        signal_id: signal.signal_id,
        contradictions_with: refs,
      });
      src.contradictions_found += refs.length;
    }

    shortTermSignals.push(signal);
    while (shortTermSignals.length > SHORT_TERM_MAX) shortTermSignals.shift();

    const profile = getTrustProfile(signal.source_system);
    const promotionScore =
      (Number(signal.confidence || 0) + Number(signal.relevance || 0) + Number(signal.novelty || 0)) / 3;
    if (promotionScore >= profile.memoryPromotionBias) {
      durableKnowledge.push({
        ...signal,
        _promoted_at: nowIso(),
      });
      promoted += 1;
      while (durableKnowledge.length > DURABLE_MAX) durableKnowledge.shift();
    }
  }

  src.promoted_to_memory_count += promoted;

  return {
    contradictions,
    promoted,
  };
}

export function getMemorySnapshot() {
  return {
    short_term_count: shortTermSignals.length,
    durable_count: durableKnowledge.length,
  };
}

export function getSourceStats() {
  return Array.from(sourceStats.values()).sort((a, b) =>
    String(a.source_system).localeCompare(String(b.source_system))
  );
}

export function getRecentShortTermSignals(limit = 200) {
  return shortTermSignals.slice(-limit);
}
