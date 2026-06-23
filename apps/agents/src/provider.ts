import { registerProvider } from "@flue/runtime";

// Register OpenRouter as a model provider. It's a first-class entry in pi-ai's
// catalog, so the wire protocol (`openai-completions`) and baseUrl
// (https://openrouter.ai/api/v1) come from the catalog — model strings are
// `openrouter/<model>`.
//
// The API key is deliberately NOT set here: on Cloudflare it can't be read at
// module-load time (bindings are per-request, not process.env). It's supplied
// to pi-ai via the harness's per-call `getApiKey(providerId)` callback, wired
// from `env.OPENROUTER_API_KEY` when the worker entry is cut over to Flue.
registerProvider("openrouter", {});
