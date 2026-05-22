import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

// OpenRouter routed through Cloudflare AI Gateway (spec decision 1). OpenRouter
// is OpenAI-compatible, so an openai-compatible provider works once baseURL
// points at the gateway's openrouter route. The provider key is a Worker
// secret held behind the gateway. P1 reuses the existing OpenRouter credit.
const getModel = (env: Env) => {
  const baseURL = `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ACCOUNT_ID}/${env.AI_GATEWAY_NAME}/openrouter/v1`;
  const provider = createOpenAICompatible({
    apiKey: env.OPENROUTER_API_KEY,
    baseURL,
    name: "openrouter-via-gateway",
  });
  return provider(env.CORRESPONDENT_MODEL);
};

export { getModel };
