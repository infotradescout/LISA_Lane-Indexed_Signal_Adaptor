import { normalizePacketItems } from "./shared.js";

export function signalfactoryAdapter(packet) {
  return normalizePacketItems(packet, "infill_signal_packaging");
}
