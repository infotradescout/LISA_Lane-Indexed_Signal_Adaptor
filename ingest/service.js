import { validateIngestionEnvelope } from "./validators/envelopeValidator.js";
import { resolveAdapter, listKnownAdapters } from "./adapters/index.js";
import { applyTrustWeighting, toCanonicalSignal } from "./normalizers/canonicalSignal.js";
import { routeLane } from "./routers/laneRouter.js";
import {
  getMemorySnapshot,
  getRecentShortTermSignals,
  getSourceStats,
  recordValidationError,
  storeSignals,
} from "./memory/store.js";
import { PACKET_SCHEMA_VERSION } from "./contract.js";

function normalizeSignals(packet, rawSignals) {
  return rawSignals.map((signal) => {
    const routed = {
      ...signal,
      lane: routeLane(signal, packet.lane),
      source_system: signal.source_system || packet.source_system,
      generated_at: signal.generated_at || packet.generated_at || new Date().toISOString(),
      fresh_until: signal.fresh_until || packet.fresh_until || null,
    };
    return toCanonicalSignal(applyTrustWeighting(routed));
  });
}

export function ingestPacket(packet) {
  const sourceSystem = packet?.source_system || "unknown";
  const validation = validateIngestionEnvelope(packet);
  if (!validation.ok) {
    recordValidationError(sourceSystem);
    return {
      ok: false,
      sourceSystem,
      errors: validation.errors,
      unknownFields: validation.unknownFields,
      normalizedSignals: [],
      contradictions: [],
      promoted: 0,
    };
  }

  const adapter = resolveAdapter(sourceSystem);
  const rawSignals = adapter(packet);
  const normalizedSignals = normalizeSignals(packet, rawSignals);

  const storageResult = storeSignals(sourceSystem, normalizedSignals);
  return {
    ok: true,
    sourceSystem,
    errors: [],
    unknownFields: validation.unknownFields,
    normalizedSignals,
    contradictions: storageResult.contradictions,
    promoted: storageResult.promoted,
  };
}

export function getIngestionOpsSummary() {
  return {
    schema_version: PACKET_SCHEMA_VERSION,
    known_adapters: listKnownAdapters(),
    sources: getSourceStats(),
    memory: getMemorySnapshot(),
  };
}

export function getRecentCanonicalSignals(limit = 200) {
  return getRecentShortTermSignals(limit);
}
