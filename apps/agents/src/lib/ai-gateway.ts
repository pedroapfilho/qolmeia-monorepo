import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const OPENROUTER_DIRECT_URL = "https://openrouter.ai/api/v1";

// Cloudflare AI Gateway is configured per account. Local dev (and CI) run
// without one, so when the account id is unset/placeholder we call OpenRouter
// directly — same provider, same key, just no gateway proxy in front.
const resolveBaseUrl = (env: Env): string => {
  const accountId = env.AI_GATEWAY_ACCOUNT_ID;
  if (!accountId || accountId.startsWith("PLACEHOLDER")) {
    return OPENROUTER_DIRECT_URL;
  }
  return `https://gateway.ai.cloudflare.com/v1/${accountId}/${env.AI_GATEWAY_NAME}/openrouter/v1`;
};

// OpenRouter as the model provider (spec decision 1). OpenRouter is
// OpenAI-compatible, so an openai-compatible provider works for both the
// gateway route and the direct route. The key is a Worker secret.
const getModel = (env: Env) => {
  const provider = createOpenAICompatible({
    apiKey: env.OPENROUTER_API_KEY,
    baseURL: resolveBaseUrl(env),
    name: "openrouter",
  });
  return provider(env.CORRESPONDENT_MODEL);
};

export { getModel };
