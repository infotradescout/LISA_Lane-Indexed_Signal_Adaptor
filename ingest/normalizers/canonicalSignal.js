import { CANONICAL_SIGNAL_FIELDS, getTrustProfile } from "../contract.js";

function coerceConfidence(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0.5;
  if (parsed < 0) return 0;
  if (parsed > 1) return 1;
  return parsed;
}

function clamp01(value) {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function applyTrustWeighting(signal) {
  const profile = getTrustProfile(signal.source_system);
  const weightedConfidence = clamp01(coerceConfidence(signal.confidence) * profile.confidenceMultiplier);

  return {
    ...signal,
    confidence: weightedConfidence,
    source_trust_profile: profile,
  };
}

export function toCanonicalSignal(signal) {
  const canonical = {};
  for (const field of CANONICAL_SIGNAL_FIELDS) {
    canonical[field] = signal[field] ?? null;
  }
  return canonical;
}
