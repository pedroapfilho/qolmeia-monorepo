import "dotenv/config";

import crypto from "node:crypto";
import { parseArgs } from "node:util";

import { prisma } from "@repo/db";

import { getAdapter } from "../connectors/registry";

// One-shot seed for a WhatsApp ConnectorInstance. Idempotent — looks up an
// existing row by (orgId, type=WHATSAPP, senderRole=CUSTOMER) and updates it
// in place; otherwise creates a fresh row.
//
// We do NOT auto-seed an AgentConnectorBinding here. WhatsApp is
// customer-facing (senderRole=CUSTOMER) so the operator must explicitly
// choose which agent listens — same approval-gated pattern the AGENTS.md
// onboarding flow uses for customer channels.
//
// Usage:
//   tsx apps/api/src/scripts/seed-whatsapp-connector.ts \
//     --org-slug <slug> \
//     --phone-number-id <pn_id> \
//     --access-token <token> \
//     [--display-name "WhatsApp · Loja Centro"] \
//     [--verify-token <token>] \
//     [--app-secret <secret>]

const { values } = parseArgs({
  options: {
    "access-token": { type: "string" },
    "app-secret": { type: "string" },
    "display-name": { type: "string" },
    "org-slug": { type: "string" },
    "phone-number-id": { type: "string" },
    "verify-token": { type: "string" },
  },
});

const orgSlug = values["org-slug"];
const phoneNumberId = values["phone-number-id"];
const accessToken = values["access-token"];

if (!orgSlug || !phoneNumberId || !accessToken) {
  console.error(
    "Usage: tsx apps/api/src/scripts/seed-whatsapp-connector.ts \\\n" +
      "  --org-slug <slug> --phone-number-id <pn_id> --access-token <token> \\\n" +
      "  [--display-name <name>] [--verify-token <token>] [--app-secret <secret>]",
  );
  process.exit(1);
}

const verifyToken = values["verify-token"] ?? crypto.randomBytes(24).toString("hex");
const displayName = values["display-name"] ?? "WhatsApp · Customer";
const appSecret = values["app-secret"];

const org = await prisma.organization.findUnique({
  select: { id: true, slug: true },
  where: { slug: orgSlug },
});
if (!org) {
  console.error(`Organization with slug "${orgSlug}" not found.`);
  process.exit(1);
}

// Validate config upfront so we never persist a row the adapter would reject.
const adapter = getAdapter("WHATSAPP");
const configForValidation = { accessToken, phoneNumberId, verifyToken };
const validation = adapter.validateConfig(configForValidation);
if (!validation.valid) {
  console.error("Adapter rejected WhatsApp config:");
  for (const err of validation.errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
}

const config: Record<string, string> = { ...configForValidation };
if (appSecret) {
  config.appSecret = appSecret;
}

const capabilities = { inbound: true, outbound: false };

const existing = await prisma.connectorInstance.findFirst({
  select: { id: true },
  where: { orgId: org.id, senderRole: "CUSTOMER", type: "WHATSAPP" },
});

const connector = existing
  ? await prisma.connectorInstance.update({
      data: { capabilities, config, displayName },
      select: { id: true },
      where: { id: existing.id },
    })
  : await prisma.connectorInstance.create({
      data: {
        capabilities,
        config,
        displayName,
        orgId: org.id,
        senderRole: "CUSTOMER",
        type: "WHATSAPP",
      },
      select: { id: true },
    });

const action = existing ? "Updated" : "Created";

console.log("");
console.log(`${action} ConnectorInstance(WHATSAPP) for org "${org.slug}":`);
console.log(`  id:           ${connector.id}`);
console.log(`  senderRole:   CUSTOMER`);
console.log(`  capabilities: ${JSON.stringify(capabilities)}`);
console.log("");
console.log("Register this URL in the Meta dashboard webhook setup:");
console.log(`  https://<your-domain>/connectors/whatsapp/${connector.id}/webhook`);
console.log("");
console.log("Verify token to paste into Meta's webhook setup:");
console.log(`  ${verifyToken}`);
console.log("");
if (!appSecret) {
  console.log(
    "Note: appSecret not provided — signature verification is disabled.\n" +
      "      Re-run with --app-secret <secret> once you have the Meta App Secret.",
  );
  console.log("");
}
console.log(
  "Next: in the admin UI, create an AgentConnectorBinding(direction=INBOUND)\n" +
    "      tying this ConnectorInstance to whichever AgentInstance should listen.\n" +
    "      The seed intentionally does NOT auto-bind — CUSTOMER channels are\n" +
    "      approval-gated.",
);

await prisma.$disconnect();
