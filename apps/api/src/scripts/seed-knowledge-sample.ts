import "dotenv/config";

import { prisma } from "@repo/db";

import { createKnowledgeDoc } from "../knowledge/knowledge-doc";

// One-shot seed for live testing the Knowledge Registry. Idempotent —
// re-running upserts by (orgId, title).
//
// Usage: tsx apps/api/src/scripts/seed-knowledge-sample.ts <orgSlug>

const slug = process.argv[2];
if (!slug) {
  console.error("Usage: tsx apps/api/src/scripts/seed-knowledge-sample.ts <orgSlug>");
  process.exit(1);
}

const org = await prisma.organization.findUnique({ select: { id: true }, where: { slug } });
if (!org) {
  console.error(`Organization with slug "${slug}" not found.`);
  process.exit(1);
}

const samples = [
  {
    content: `# Política de cancelamento\n\nClientes podem cancelar agendamentos com até 24h de antecedência sem cobrança. Cancelamentos com menos de 24h: cobrança de 50% do valor do serviço. Não comparecimentos: cobrança integral.\n\nReagendamentos contam como uma nova reserva — a janela de 24h se aplica.`,
    summary: "Regras de cancelamento e reagendamento de serviços, incluindo prazos e cobranças.",
    tags: ["cancelamento", "agendamento", "política", "cliente"],
    title: "Política de cancelamento",
  },
  {
    content: `# Tom de voz da marca\n\nVoz: acolhedora, próxima, sem formalidade excessiva. Usar "você" em vez de "o senhor/a senhora". Evitar emojis em comunicação profissional (preços, agendamentos), permitir uso pontual em mensagens de boas-vindas ou agradecimento.\n\nLinguagem: brasileira coloquial-profissional. Evitar gírias regionais. Frases curtas. Sempre confirmar entendimento ao final.`,
    summary:
      "Diretrizes detalhadas de tom, linguagem e uso de emojis na comunicação com clientes.",
    tags: ["brand", "voice", "comunicação", "tom"],
    title: "Tom de voz da marca",
  },
  {
    content: `# Cardápio de serviços\n\n## Cortes\n- Corte masculino tradicional: R$ 45\n- Corte com tesoura: R$ 60\n- Degradê: R$ 55\n\n## Barba\n- Barba completa (toalha quente + óleo): R$ 40\n- Barba simples (acabamento): R$ 25\n\n## Combos\n- Corte + barba: R$ 75\n- Premium (corte + barba + sobrancelha): R$ 95\n\nTodos os serviços incluem lavagem e finalização.`,
    summary: "Lista completa de serviços com preços atuais — cortes, barba e combos.",
    tags: ["serviços", "preços", "menu", "cardápio"],
    title: "Cardápio de serviços e preços",
  },
];

const results = await Promise.allSettled(
  samples.map((sample) =>
    createKnowledgeDoc({
      content: sample.content,
      orgId: org.id,
      prisma,
      summary: sample.summary,
      tags: sample.tags,
      title: sample.title,
    }),
  ),
);

for (const [i, outcome] of results.entries()) {
  const title = samples[i]?.title ?? `sample[${i}]`;
  if (outcome.status === "fulfilled") {
    console.log(`Upserted "${title}" → ${outcome.value.id} (${outcome.value.r2Key})`);
  } else {
    console.error(`Failed "${title}":`, outcome.reason);
  }
}

await prisma.$disconnect();
