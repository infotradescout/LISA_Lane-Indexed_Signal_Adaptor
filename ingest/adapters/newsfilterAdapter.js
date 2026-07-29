import { normalizePacketItems } from "./shared.js";

export function newsfilterAdapter(packet) {
  return normalizePacketItems(packet, "topic_event_intel");
}
