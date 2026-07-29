import type { PrismaClient } from "./generated/prisma/client";

const DEFAULT_TEMPLATES = [
  {
    defaultActionType: "worker_deliverable",
    defaultPolicies: { publish_asset: "require-approval" },
    description: "Cria imagens, posts e direções visuais alinhados à marca do cliente.",
    displayName: "Designer",
    id: "tpl-designer",
    model: "openai/gpt-5.4-nano",
    skillIds: [
      "generateBrandImage",
      "rememberFact",
      "recallMemory",
      "listAssets",
      "readAsset",
      "saveAsset",
      "webSearch",
      "fetchUrl",
    ],
    systemPrompt:
      "Você é o Designer da Qolmeia. Você cria imagens e propõe direções visuais para marketing, redes sociais, anúncios e identidade visual do negócio do cliente. Quando o cliente pedir uma imagem, use a skill generateBrandImage. Quando produzir um arquivo vetorial ou de texto (SVG, guia de marca, especificação), salve-o na biblioteca com saveAsset (mime image/svg+xml para vetores, folder customer) e cite o nome do arquivo na resposta: nunca cole código-fonte (SVG, CSS, HTML) na mensagem de entrega. A entrega final deve ser um resumo curto do que foi produzido. Lembre decisões de marca com rememberFact e recupere-as com recallMemory. Responda sempre em português do Brasil, de forma direta e criativa.",
    workerKind: "designer",
  },
  {
    defaultActionType: "publish_post",
    defaultPolicies: { publish_post: "require-approval" },
    description:
      "Planeja e rascunha conteúdo de marketing para redes sociais. Especialista em copy, tom de marca, e CTAs claros.",
    displayName: "Marketing Strategist",
    id: "tpl-marketing-strategist",
    model: "openai/gpt-5.4-mini",
    skillIds: [
      "draftSocialPost",
      "rememberFact",
      "recallMemory",
      "listAssets",
      "readAsset",
      "saveAsset",
      "webSearch",
      "fetchUrl",
    ],
    systemPrompt:
      "Você é o Marketing Strategist da Qolmeia. Você rascunha posts para Instagram, Facebook, LinkedIn e outras redes, alinhados ao negócio e tom de marca do cliente. Use a skill draftSocialPost com a plataforma, tema, tom, e CTA apropriados. Responda sempre em português do Brasil, com copy claro, persuasivo e fiel ao negócio.",
    workerKind: "marketing-strategist",
  },
  {
    defaultActionType: "worker_deliverable",
    defaultPolicies: {},
    description: "Escreve textos no tom de voz da marca: legendas, e-mails, blog e anúncios.",
    displayName: "Redator",
    id: "tpl-redator",
    model: "openai/gpt-5.4-mini",
    skillIds: [
      "rememberFact",
      "recallMemory",
      "readAsset",
      "listAssets",
      "saveAsset",
      "webSearch",
      "fetchUrl",
    ],
    systemPrompt:
      "Você é o Redator da Qolmeia. Escreve textos persuasivos e fiéis ao tom de voz da marca do cliente: legendas, e-mails, artigos de blog e anúncios. Antes de escrever, use readAsset/listAssets para recuperar o brief e materiais de marca, e webSearch para verificar fatos atuais quando precisar. Entregue de 2 a 3 variações por peça e salve o resultado com saveAsset. Responda sempre em português do Brasil.",
    workerKind: "redator",
  },
  {
    defaultActionType: "worker_deliverable",
    defaultPolicies: {},
    description:
      "Pesquisa palavras-chave, concorrentes e tendências; entrega briefings de conteúdo com fontes.",
    displayName: "Pesquisador SEO",
    id: "tpl-seo-researcher",
    model: "openai/gpt-5.4-mini",
    skillIds: [
      "webSearch",
      "readAsset",
      "listAssets",
      "saveAsset",
      "rememberFact",
      "recallMemory",
      "fetchUrl",
    ],
    systemPrompt:
      "Você é o Pesquisador SEO da Qolmeia. Use webSearch para investigar palavras-chave, concorrentes e tendências do setor do cliente, e readAsset/listAssets para o contexto da marca. Entregue briefings de conteúdo acionáveis (ângulos, palavras-chave e estrutura sugerida), sempre citando as fontes (URLs). Salve o briefing com saveAsset. Responda sempre em português do Brasil.",
    workerKind: "seo-researcher",
  },
] as const;

const DEFAULT_SKILLS = [
  {
    description:
      "Salva um fato importante que você deve lembrar em conversas futuras (preferências do cliente, decisões de marca, fatos do negócio).",
    displayName: "Lembrar Fato",
    id: "rememberFact",
  },
  {
    description: "Busca na memória deste agente fatos relevantes para uma consulta específica.",
    displayName: "Recordar Memória",
    id: "recallMemory",
  },
  {
    defaultConfig: { aspectRatio: "1:1" },
    description:
      "Gera uma imagem alinhada à marca usando IA. Use quando o usuário pedir uma imagem, post visual, ou peça de design.",
    displayName: "Gerar Imagem de Marca",
    id: "generateBrandImage",
    paramHints: {
      aspectRatio: "Proporção: 1:1 (quadrado), 16:9 (horizontal), 9:16 (vertical), 4:3.",
      prompt: "Descrição vívida e específica do que deve aparecer na imagem, em pt-BR.",
    },
  },
  {
    description:
      "Delega uma tarefa a um especialista do Time (designer, marketing, etc.). Use quando o pedido exige uma especialidade que você não executa diretamente.",
    displayName: "Delegar para Especialista",
    id: "delegateToWorker",
    paramHints: {
      brief: "Resumo claro da tarefa, em pt-BR.",
      workerKind: "Tipo do especialista (ex: designer, marketing-strategist).",
    },
  },
  {
    defaultConfig: { platform: "instagram", tone: "acolhedor" },
    description:
      "Rascunha um post para redes sociais (Instagram, Facebook, LinkedIn). Use quando o cliente pedir um post, publicação, ou conteúdo de feed/stories.",
    displayName: "Rascunhar Post Social",
    id: "draftSocialPost",
    paramHints: {
      body: "Texto principal do post, em pt-BR, já formatado para a plataforma.",
      callToAction: "CTA final (ex: Visite-nos hoje, Compre agora).",
      hashtags: "Hashtags relevantes, sem o # (a renderização adiciona).",
      platform: "Plataforma alvo (instagram, facebook, linkedin, twitter).",
      tone: "Tom da copy (ex: acolhedor, urgente, informativo).",
    },
  },
] as const;

const seedProductDefaults = async (db: PrismaClient): Promise<void> => {
  await Promise.all(
    DEFAULT_TEMPLATES.map((template) =>
      db.agentTemplate.upsert({
        create: { ...template, skillIds: [...template.skillIds] },
        update: {},
        where: { id: template.id },
      }),
    ),
  );
  await Promise.all(
    DEFAULT_SKILLS.map((skill) =>
      db.skill.upsert({
        create: { ...skill, enabled: 1 },
        update: {},
        where: { id: skill.id },
      }),
    ),
  );
  const [companies, templates] = await Promise.all([
    db.company.findMany({ select: { id: true } }),
    db.agentTemplate.findMany({ select: { id: true }, where: { status: "active" } }),
  ]);
  await db.companyTemplateEntitlement.createMany({
    data: companies.flatMap(({ id: companyId }) =>
      templates.map(({ id: templateId }) => ({ companyId, templateId })),
    ),
    skipDuplicates: true,
  });
};

export { DEFAULT_SKILLS, DEFAULT_TEMPLATES, seedProductDefaults };
