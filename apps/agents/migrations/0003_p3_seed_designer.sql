-- 0003_p3_seed_designer.sql
-- P3 starts populating the D1 catalog. Seeds the operator-tunable overlay
-- rows for every skill we have, plus the Designer Worker template. The
-- Correspondent gains delegateToWorker; existing P2 skills (rememberFact,
-- recallMemory) keep working — the overlay just lets operators tune their
-- LLM-facing descriptions without a deploy.

INSERT OR IGNORE INTO skill
  (id, display_name, description, param_hints, default_config, enabled, updated_at)
VALUES
  ('rememberFact',
   'Lembrar Fato',
   'Salva um fato importante que você deve lembrar em conversas futuras (preferências do cliente, decisões de marca, fatos do negócio).',
   NULL, NULL, 1, unixepoch() * 1000),
  ('recallMemory',
   'Recordar Memória',
   'Busca na memória deste agente fatos relevantes para uma consulta específica.',
   NULL, NULL, 1, unixepoch() * 1000),
  ('generateBrandImage',
   'Gerar Imagem de Marca',
   'Gera uma imagem alinhada à marca usando IA. Use quando o usuário pedir uma imagem, post visual, ou peça de design.',
   '{"prompt":"Descrição vívida e específica do que deve aparecer na imagem, em pt-BR.","aspectRatio":"Proporção: 1:1 (quadrado), 16:9 (horizontal), 9:16 (vertical), 4:3."}',
   '{"aspectRatio":"1:1"}',
   1, unixepoch() * 1000),
  ('delegateToWorker',
   'Delegar para Especialista',
   'Delega uma tarefa a um especialista do Time (designer, marketing, etc.). Use quando o pedido exige uma especialidade que você não executa diretamente.',
   '{"workerKind":"Tipo do especialista (ex: designer, marketing-strategist).","brief":"Resumo claro da tarefa, em pt-BR."}',
   NULL, 1, unixepoch() * 1000);

INSERT OR IGNORE INTO template
  (id, worker_kind, display_name, description, system_prompt, model,
   skill_ids, default_policies, status, version, created_at, updated_at)
VALUES
  ('tpl-designer',
   'designer',
   'Designer',
   'Cria imagens, posts e direções visuais alinhados à marca do cliente.',
   'Você é o Designer da Qolmeia. Você cria imagens e propõe direções visuais para marketing, redes sociais, anúncios e identidade visual do negócio do cliente. Quando o cliente pedir uma imagem, use a skill generateBrandImage. Lembre decisões de marca com rememberFact e recupere-as com recallMemory. Responda sempre em português do Brasil, de forma direta e criativa.',
   'openai/gpt-5.4-nano',
   '["generateBrandImage","rememberFact","recallMemory"]',
   '{"publish_asset":"require-approval"}',
   'active', 1, unixepoch() * 1000, unixepoch() * 1000);
