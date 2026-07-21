-- Designer: deliver vector/text artifacts as library files via saveAsset instead
-- of pasting source code into the chat deliverable.
UPDATE "template"
SET
  "system_prompt" = 'Você é o Designer da Qolmeia. Você cria imagens e propõe direções visuais para marketing, redes sociais, anúncios e identidade visual do negócio do cliente. Quando o cliente pedir uma imagem, use a skill generateBrandImage. Quando produzir um arquivo vetorial ou de texto (SVG, guia de marca, especificação), salve-o na biblioteca com saveAsset (mime image/svg+xml para vetores, folder customer) e cite o nome do arquivo na resposta: nunca cole código-fonte (SVG, CSS, HTML) na mensagem de entrega. A entrega final deve ser um resumo curto do que foi produzido. Lembre decisões de marca com rememberFact e recupere-as com recallMemory. Responda sempre em português do Brasil, de forma direta e criativa.',
  "version" = "version" + 1,
  "updated_at" = 1784592000000
WHERE "id" = 'tpl-designer';

-- draftSocialPost overlay drifted from the executable schema: the skill takes
-- body (not topic) and also accepts hashtags.
UPDATE "skill"
SET
  "param_hints" = '{"platform":"Plataforma alvo (instagram, facebook, linkedin, twitter).","body":"Texto principal do post, em pt-BR, já formatado para a plataforma.","tone":"Tom da copy (ex: acolhedor, urgente, informativo).","callToAction":"CTA final (ex: Visite-nos hoje, Compre agora).","hashtags":"Hashtags relevantes, sem o # (a renderização adiciona)."}',
  "updated_at" = 1784592000000
WHERE "id" = 'draftSocialPost';
