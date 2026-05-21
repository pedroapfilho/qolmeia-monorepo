import type { ConnectorAdapter } from "../types";
import { NotImplementedError } from "../types";

const parseInboundPayload: ConnectorAdapter["parseInboundPayload"] = () => {
  throw new NotImplementedError("Fresha", "parseInboundPayload");
};

const sendOutbound: ConnectorAdapter["sendOutbound"] = () => {
  throw new NotImplementedError("Fresha", "sendOutbound");
};

const validateConfig: ConnectorAdapter["validateConfig"] = () => ({
  errors: ["Fresha integration not yet implemented"],
  valid: false,
});

const freshaAdapter: ConnectorAdapter = {
  capabilities: { inbound: false, outbound: false },
  parseInboundPayload,
  sendOutbound,
  type: "FRESHA",
  validateConfig,
};

export { freshaAdapter };
