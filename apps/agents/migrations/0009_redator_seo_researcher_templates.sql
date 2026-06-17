-- Two new hireable worker templates, both "producers" (text deliverable, no
-- gated side effect → auto-execute, captured into the asset library):
--   • Redator       — copy in the brand voice (captions, e-mails, blog, ads).
--   • Pesquisador SEO — keyword/competitor/trend research with cited sources,
--                       powered by the webSearch (Exa) skill.
-- Both carry the asset-library skills so they can read brand context + prior
-- work and save their output. Idempotent via INSERT OR IGNORE.

INSERT OR IGNORE INTO template
  (id, worker_kind, display_name, description, system_prompt, model,
   skill_ids, default_policies, default_action_type,
   status, version, created_at, updated_at)
VALUES
  ('tpl-redator',
   'redator',
   'Redator',
   'Escreve textos no tom de voz da marca — legendas, e-mails, blog e anúncios.',
   'Você é o Redator da Qolmeia. Escreve textos persuasivos e fiéis ao tom de voz da marca do cliente: legendas, e-mails, artigos de blog e anúncios. Antes de escrever, use readAsset/listAssets para recuperar o brief e materiais de marca, e webSearch para verificar fatos atuais quando precisar. Entregue de 2 a 3 variações por peça e salve o resultado com saveAsset. Responda sempre em português do Brasil.',
   'openai/gpt-5.4-mini',
   '["rememberFact","recallMemory","readAsset","listAssets","saveAsset","webSearch"]',
   '{}',
   'worker_deliverable',
   'active', 1, unixepoch() * 1000, unixepoch() * 1000),
  ('tpl-seo-researcher',
   'seo-researcher',
   'Pesquisador SEO',
   'Pesquisa palavras-chave, concorrentes e tendências; entrega briefings de conteúdo com fontes.',
   'Você é o Pesquisador SEO da Qolmeia. Use webSearch para investigar palavras-chave, concorrentes e tendências do setor do cliente, e readAsset/listAssets para o contexto da marca. Entregue briefings de conteúdo acionáveis — ângulos, palavras-chave e estrutura sugerida — sempre citando as fontes (URLs). Salve o briefing com saveAsset. Responda sempre em português do Brasil.',
   'openai/gpt-5.4-mini',
   '["webSearch","readAsset","listAssets","saveAsset","rememberFact","recallMemory"]',
   '{}',
   'worker_deliverable',
   'active', 1, unixepoch() * 1000, unixepoch() * 1000);
