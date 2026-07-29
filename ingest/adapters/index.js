import { autobottAdapter } from "./autobottAdapter.js";
import { newsfilterAdapter } from "./newsfilterAdapter.js";
import { factdeckAdapter } from "./factdeckAdapter.js";
import { signalfactoryAdapter } from "./signalfactoryAdapter.js";
import { v1StreamAdapter } from "./v1StreamAdapter.js";
import { normalizePacketItems } from "./shared.js";

const ADAPTERS = Object.freeze({
  autobott: autobottAdapter,
  newsfilter: newsfilterAdapter,
  factdeck: factdeckAdapter,
  signalfactory: signalfactoryAdapter,
  v1_stream: v1StreamAdapter,
});

export function resolveAdapter(sourceSystem) {
  return ADAPTERS[sourceSystem] || normalizePacketItems;
}

export function listKnownAdapters() {
  return Object.keys(ADAPTERS);
}
