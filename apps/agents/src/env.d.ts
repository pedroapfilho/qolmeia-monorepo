// oxlint-disable typescript/consistent-type-definitions
interface Env {
  AI?: Ai;
  API_INTERNAL_URL: string;
  ASSETS_SIGNING_KEY: string;
  DATABASE_URL: string;
  EXA_API_KEY?: string;
  FIRECRAWL_API_KEY?: string;
  FIRECRAWL_BASE_URL?: string;
  OPENROUTER_API_KEY: string;
  INTERNAL_SHARED_SECRET: string;
  VECTORIZE?: VectorizeIndex;
}

namespace Cloudflare {
  // oxlint-disable-next-line no-shadow
  interface Env {
    AI?: Ai;
    ASSETS_SIGNING_KEY: string;
    DATABASE_URL: string;
    EXA_API_KEY?: string;
    FIRECRAWL_API_KEY?: string;
    FIRECRAWL_BASE_URL?: string;
    OPENROUTER_API_KEY: string;
    INTERNAL_SHARED_SECRET: string;
    VECTORIZE?: VectorizeIndex;
  }
}
// oxlint-enable typescript/consistent-type-definitions
