import { normalizePacketItems } from "./shared.js";

export function autobottAdapter(packet) {
  return normalizePacketItems(packet, "market_microstructure");
}
