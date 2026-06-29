import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const OPENROUTER_DIRECT_URL = "https://openrouter.ai/api/v1";

const resolveBaseUrl = (env: Env): string => {
  const accountId = env.AI_GATEWAY_ACCOUNT_ID;
  if (!accountId || accountId.startsWith("PLACEHOLDER")) {
    return OPENROUTER_DIRECT_URL;
  }
  return `https://gateway.ai.cloudflare.com/v1/${accountId}/${env.AI_GATEWAY_NAME}/openrouter/v1`;
};

const getModel = (env: Env, modelId?: string) => {
  const provider = createOpenAICompatible({
    apiKey: env.OPENROUTER_API_KEY,
    baseURL: resolveBaseUrl(env),
    name: "openrouter",
  });
  return provider(modelId ?? env.CORRESPONDENT_MODEL);
};

export { getModel };
