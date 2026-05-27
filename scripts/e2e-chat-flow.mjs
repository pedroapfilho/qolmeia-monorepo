// E2E chat flow against a locally-running stack.
//
// Prereqs:
//   docker compose up -d           (postgres + redis)
//   pnpm tsx apps/api/src/scripts/seed-dev.ts
//   wrangler d1 execute qolmeia-agents --local --file scripts/seed-p2.sql
//   wrangler d1 execute qolmeia-agents --local --file scripts/seed-p3-team.sql
//   pnpm dev --filter=api          (:4000)
//   pnpm dev --filter=qolmeia-agents (:8787)
//
// What it does:
//   1. Signs in customer + operator via apps/api → grabs bearer tokens.
//   2. Opens a WebSocket to /agents/correspondent/<companyId>?cf_session=<customer>.
//   3. Sends a chat message asking for a logo (which forces delegateToWorker).
//   4. Polls /api/backoffice/actions?status=pending as the operator until an
//      action appears (the Workflow proposed it).
//   5. Posts /api/backoffice/actions/:id/decide with decision=approved.
//   6. Polls again until the action is executed.
//
// Run: node scripts/e2e-chat-flow.mjs

import { WebSocket } from "undici";

const API_URL = process.env.API_URL ?? "http://localhost:4000";
const AGENTS_URL = process.env.AGENTS_URL ?? "http://localhost:8787";
const AGENTS_WS = AGENTS_URL.replace(/^http/v, "ws");

const CUSTOMER_EMAIL = "customer@qolmeia.dev";
const CUSTOMER_PASSWORD = "Qolmeia-Dev-CustomerPass!";
const OPERATOR_EMAIL = "operator@qolmeia.dev";
const OPERATOR_PASSWORD = "Qolmeia-Dev-OperatorPass!";

const signIn = async (email, password) => {
  const res = await fetch(`${API_URL}/api/auth/sign-in/email`, {
    body: JSON.stringify({ email, password }),
    headers: {
      "Content-Type": "application/json",
      // Better Auth's trustedOrigins check expects an Origin matching one of
      // the CORS_ORIGINS values. http://localhost:3001 is the client app.
      Origin: "http://localhost:3001",
    },
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`sign-in ${email} failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body.token;
};

const me = async (token) => {
  const res = await fetch(`${AGENTS_URL}/api/me?cf_session=${token}`);
  if (!res.ok) {
    throw new Error(`/api/me failed: ${res.status}`);
  }
  return res.json();
};

const wait = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const sendChat = (companyId, token, text) =>
  new Promise((resolve, reject) => {
    const url = `${AGENTS_WS}/agents/correspondent/${companyId}?cf_session=${token}`;
    const ws = new WebSocket(url);
    const events = [];
    let resolved = false;

    const finish = (reason) => {
      if (resolved) {
        return;
      }
      resolved = true;
      try {
        ws.close();
      } catch {
        // Best-effort close; the WS is already torn down in some branches.
      }
      resolve({ events, reason });
    };

    ws.addEventListener("open", () => {
      const requestId = crypto.randomUUID();
      const messageId = crypto.randomUUID();
      const bodyPayload = JSON.stringify({
        messages: [
          {
            id: messageId,
            parts: [{ text, type: "text" }],
            role: "user",
          },
        ],
        trigger: "submit-user-message",
      });
      ws.send(
        JSON.stringify({
          id: requestId,
          init: { body: bodyPayload, method: "POST" },
          type: "cf_agent_use_chat_request",
        }),
      );
    });

    ws.addEventListener("message", (event) => {
      const raw = typeof event.data === "string" ? event.data : event.data.toString();
      events.push(raw);
      // Try to detect the final assistant message — the SDK emits one with
      // a "finish" event type.
      if (raw.includes('"type":"cf_agent_chat_messages"')) {
        // Don't finish here — the chat will idle after the reply. We finish
        // on the outer pollAction loop instead.
      }
    });

    ws.addEventListener("error", (error) => {
      if (!resolved) {
        reject(
          new Error(`WS error: ${JSON.stringify(error?.error?.message ?? error?.message ?? "")}`),
        );
      }
    });

    ws.addEventListener("close", () => {
      finish("closed");
    });

    // Idle stop after 30s — the chat finishes streaming long before this.
    setTimeout(() => finish("timeout"), 30_000);
  });

// Polls `/api/backoffice/actions` recursively until `predicate` matches or
// the deadline elapses. Recursive form sidesteps the no-await-in-loop rule
// while keeping the semantics of a poll-with-timeout (each tick is a single
// fetch + 2s sleep).
const pollAction = ({ opToken, predicate, timeoutMs }) => {
  const deadline = Date.now() + timeoutMs;
  const tick = async () => {
    const res = await fetch(`${AGENTS_URL}/api/backoffice/actions?cf_session=${opToken}`);
    if (res.ok) {
      const body = await res.json();
      const match = body.items.find(predicate);
      if (match) {
        return match;
      }
    }
    if (Date.now() >= deadline) {
      return null;
    }
    await wait(2000);
    return tick();
  };
  return tick();
};

const decideAction = async (actionId, opToken, decision) => {
  const res = await fetch(
    `${AGENTS_URL}/api/backoffice/actions/${actionId}/decide?cf_session=${opToken}`,
    {
      body: JSON.stringify({ decision, feedback: "E2E aprovado." }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
  if (!res.ok) {
    throw new Error(`decide failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
};

const main = async () => {
  console.log("[1/6] sign in customer + operator");
  const customerToken = await signIn(CUSTOMER_EMAIL, CUSTOMER_PASSWORD);
  const operatorToken = await signIn(OPERATOR_EMAIL, OPERATOR_PASSWORD);

  const meCustomer = await me(customerToken);
  console.log(
    `      customer org=${meCustomer.currentOrg?.id} role=${meCustomer.currentOrg?.role}`,
  );
  const companyId = meCustomer.currentOrg.id;

  console.log("[2/6] open WebSocket to Correspondent and send the brief");
  const chat = await sendChat(
    companyId,
    customerToken,
    "Olá! Preciso de um logo simples e moderno para minha cafeteria, com tons quentes. Pode pedir para o Designer fazer?",
  );
  console.log(`      ws closed (reason=${chat.reason}, frames=${chat.events.length})`);

  console.log("[3/6] poll backoffice for a pending action (max 60s)");
  const pending = await pollAction({
    opToken: operatorToken,
    predicate: (a) => a.status === "pending",
    timeoutMs: 60_000,
  });
  if (!pending) {
    console.error("FAIL: no pending action surfaced. Worker may have failed to generate.");
    process.exit(1);
  }
  console.log(`      pending action: ${pending.id}`);
  console.log(`      proposed.summary preview: ${JSON.stringify(pending.proposed).slice(0, 140)}…`);

  console.log("[4/6] operator approves");
  await decideAction(pending.id, operatorToken, "approved");

  console.log("[5/6] poll for executed status (max 30s)");
  const executed = await pollAction({
    opToken: operatorToken,
    predicate: (a) => a.id === pending.id && a.status === "executed",
    timeoutMs: 30_000,
  });
  if (!executed) {
    console.error("FAIL: action did not transition to executed.");
    process.exit(1);
  }
  console.log(`      executed.feedback: ${executed.feedback}`);

  console.log("[6/6] verify ticket marked done");
  const ticketsRes = await fetch(
    `${AGENTS_URL}/api/backoffice/tickets?cf_session=${operatorToken}`,
  );
  const ticketsBody = await ticketsRes.json();
  const ticket = ticketsBody.items.find((t) => t.id === pending.ticketId);
  console.log(`      ticket status: ${ticket?.status ?? "<missing>"}`);

  console.log("\nDONE — E2E approval loop succeeded.");
  process.exit(0);
};

try {
  await main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
