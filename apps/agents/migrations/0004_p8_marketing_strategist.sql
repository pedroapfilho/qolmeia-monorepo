-- 0004_p8_marketing_strategist.sql
-- P8 ships the second action type — `publish_post` — and the Marketing
-- Strategist Worker template that produces it. The pattern is the same
-- shape as the Designer (P3): code defines the skill `execute()` and Zod
-- schema; D1 carries the operator-tunable overlay; a new Template row
-- declares which skills it uses + which action type it proposes.
--
-- New column: template.default_action_type — the action type the Worker
-- proposes via its Workflow. Defaults to 'worker_deliverable' for backward
-- compat with the Designer (P3) and any other template seeded before now.

ALTER TABLE template ADD COLUMN default_action_type TEXT NOT NULL DEFAULT 'worker_deliverable';

INSERT OR IGNORE INTO skill
  (id, display_name, description, param_hints, default_config, enabled, updated_at)
VALUES
  ('draftSocialPost',
   'Rascunhar Post Social',
   'Rascunha um post para redes sociais (Instagram, Facebook, LinkedIn). Use quando o cliente pedir um post, publicação, ou conteúdo de feed/stories.',
   '{"platform":"Plataforma alvo (instagram, facebook, linkedin).","topic":"Assunto ou ângulo do post, em pt-BR.","tone":"Tom desejado (informal, profissional, divertido, urgente).","callToAction":"CTA final (ex: Compre agora, Visite-nos, Salve esse post)."}',
   '{"platform":"instagram","tone":"acolhedor"}',
   1, unixepoch() * 1000);

INSERT OR IGNORE INTO template
  (id, worker_kind, display_name, description, system_prompt, model,
   skill_ids, default_policies, default_action_type,
   status, version, created_at, updated_at)
VALUES
  ('tpl-marketing-strategist',
   'marketing-strategist',
   'Marketing Strategist',
   'Planeja e rascunha conteúdo de marketing para redes sociais. Especialista em copy, tom de marca, e CTAs claros.',
   'Você é o Marketing Strategist da Qolmeia. Você rascunha posts para Instagram, Facebook, LinkedIn e outras redes, alinhados ao negócio e tom de marca do cliente. Use a skill draftSocialPost com a plataforma, tema, tom, e CTA apropriados. Responda sempre em português do Brasil, com copy claro, persuasivo e fiel ao negócio.',
   'openai/gpt-5.4-mini',
   '["draftSocialPost","rememberFact","recallMemory"]',
   '{"publish_post":"require-approval"}',
   'publish_post',
   'active', 1, unixepoch() * 1000, unixepoch() * 1000);
