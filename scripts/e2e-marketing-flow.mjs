// E2E flow against the locally-running stack — exercises the Marketing
// Strategist Worker (publish_post action type), proving the second action
// type wired by P8 actually round-trips through the Workflow + approval.
//
// Prereqs: same as e2e-chat-flow.mjs. Make sure scripts/seed-p8-marketing.sql
// has been applied so the marketing-strategist worker is on the dev team:
//   pnpm wrangler d1 execute worker-bees --local --file scripts/seed-p8-marketing.sql
//
// What it does:
//   1. Signs in customer + operator.
//   2. Sends a chat asking for an Instagram post (forces delegation to
//      marketing-strategist, NOT designer).
//   3. Polls /api/backoffice/actions until an action with action_type
//      "publish_post" appears.
//   4. Operator approves it.
//   5. Confirms the action transitions to executed.

import { WebSocket } from "undici";

const API_URL = process.env.API_URL ?? "http://localhost:4000";
const AGENTS_URL = process.env.AGENTS_URL ?? "http://localhost:8787";
const AGENTS_WS = AGENTS_URL.replace(/^http/v, "ws");

const signIn = async (email, password) => {
  const res = await fetch(`${API_URL}/api/auth/sign-in/email`, {
    body: JSON.stringify({ email, password }),
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3001" },
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body.token;
};

const wait = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const sendChat = (companyId, token, text) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`${AGENTS_WS}/agents/correspondent/${companyId}?cf_session=${token}`);
    let resolved = false;
    const finish = (reason) => {
      if (resolved) {
        return;
      }
      resolved = true;
      try {
        ws.close();
      } catch {
        // Best-effort close; the WS may already be torn down.
      }
      resolve({ reason });
    };
    ws.addEventListener("open", () => {
      const requestId = crypto.randomUUID();
      const messageId = crypto.randomUUID();
      const bodyPayload = JSON.stringify({
        messages: [{ id: messageId, parts: [{ text, type: "text" }], role: "user" }],
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
    ws.addEventListener("error", reject);
    ws.addEventListener("close", () => finish("closed"));
    setTimeout(() => finish("timeout"), 60_000);
  });

// Use `?status=pending&sort=age` (the same query the backoffice UI uses) so
// the response goes through the typed mapper — items carry camelCase
// `actionType`/`ticketId` rather than the raw snake_case the bare list
// returns. Once approved, the action drops out of "pending" so we fall
// back to the bare list for the "executed" assertion. Recursive tick form
// sidesteps no-await-in-loop.
const pollAction = ({ opToken, predicate, query, timeoutMs }) => {
  const deadline = Date.now() + timeoutMs;
  const tick = async () => {
    const res = await fetch(`${AGENTS_URL}/api/backoffice/actions?${query}&cf_session=${opToken}`);
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

const fetchActionDetail = async (id, opToken) => {
  const res = await fetch(`${AGENTS_URL}/api/backoffice/actions/${id}?cf_session=${opToken}`);
  if (!res.ok) {
    return null;
  }
  const body = await res.json();
  return body.action;
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
  console.log("[1/5] sign in customer + operator");
  const customerToken = await signIn("customer@qolmeia.dev", "Qolmeia-Dev-CustomerPass!");
  const operatorToken = await signIn("operator@qolmeia.dev", "Qolmeia-Dev-OperatorPass!");
  const meRes = await fetch(`${AGENTS_URL}/api/me?cf_session=${customerToken}`);
  const me = await meRes.json();
  const companyId = me.currentOrg.id;
  console.log(`      companyId=${companyId}`);

  console.log("[2/5] open WS and ask for an Instagram post (marketing-strategist path)");
  const chat = await sendChat(
    companyId,
    customerToken,
    "Por favor peça pra Marketing Strategist rascunhar um post de Instagram, tom acolhedor, anunciando que minha cafeteria tem combo café+doce hoje. CTA 'Visite-nos'.",
  );
  console.log(`      ws closed (reason=${chat.reason})`);

  console.log("[3/5] poll backoffice for a publish_post action (max 60s)");
  const pending = await pollAction({
    opToken: operatorToken,
    predicate: (a) => a.status === "pending" && a.actionType === "publish_post",
    query: "status=pending&sort=age",
    timeoutMs: 60_000,
  });
  if (!pending) {
    console.error("FAIL: no pending publish_post action surfaced.");
    console.error("Tip: ensure the marketing-strategist worker is seeded:");
    console.error(
      "  pnpm wrangler d1 execute worker-bees --local --file scripts/seed-p8-marketing.sql",
    );
    process.exit(1);
  }
  console.log(`      pending publish_post action: ${pending.id}`);
  const detail = await fetchActionDetail(pending.id, operatorToken);
  if (detail?.proposed?.draft) {
    const draft = detail.proposed.draft;
    console.log(
      `      structured draft → platform=${draft.platform} tone=${draft.tone} cta="${draft.callToAction}"`,
    );
  } else {
    console.warn(
      "      WARNING: proposed.draft is missing — the publish_post renderer in the backoffice will fall back to JSON dump",
    );
  }

  console.log("[4/5] operator approves");
  await decideAction(pending.id, operatorToken, "approved");

  console.log("[5/5] poll for executed status (max 30s)");
  const executed = await pollAction({
    opToken: operatorToken,
    predicate: (a) => a.id === pending.id && a.status === "executed",
    query: "limit=200",
    timeoutMs: 30_000,
  });
  if (!executed) {
    console.error("FAIL: publish_post action did not transition to executed.");
    process.exit(1);
  }

  console.log("\nDONE — marketing-strategist publish_post round-trip succeeded.");
  process.exit(0);
};

try {
  await main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
