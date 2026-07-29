import { normalizePacketItems } from "./shared.js";

export function factdeckAdapter(packet) {
  return normalizePacketItems(packet, "fact_evidence");
}
