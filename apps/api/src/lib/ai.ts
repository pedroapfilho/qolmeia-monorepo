import { createOpenRouter } from "@openrouter/ai-sdk-provider";

import { env } from "./env";

// Single OpenRouter provider instance shared by the agent runtime. The
// HTTP-Referer + X-Title headers are picked up by OpenRouter's leaderboard /
// usage dashboard so traffic gets attributed to Qolmeia; they're optional but
// cheap to set and ops-friendly.
const openrouter = createOpenRouter({
  apiKey: env.OPENROUTER_API_KEY,
  headers: {
    "HTTP-Referer": env.WEB_APP_URL ?? "https://qolmeia.ai",
    "X-Title": "Qolmeia",
  },
});

type AgentModelTarget = {
  instance: { modelOverride: string | null };
  template: { defaultModel: string };
};

// Per-agent model selection: an AgentInstance can override its template's
// defaultModel via AgentInstance.modelOverride. Null override ⇒ fall back to
// the template default. Returned value is an OpenRouter model id (e.g.
// "openai/gpt-5.4-mini") passed straight to openrouter.chat().
const resolveModelForAgent = ({ instance, template }: AgentModelTarget): string => {
  return instance.modelOverride ?? template.defaultModel;
};

export { openrouter, resolveModelForAgent };
export type { AgentModelTarget };
