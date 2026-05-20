import { createSerialDispatcher } from "./dispatcher";
import { runAgentInstance } from "./runtime";

const dispatcher = createSerialDispatcher(runAgentInstance);

export { dispatcher };
