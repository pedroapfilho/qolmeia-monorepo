// Triggers the same chat flow as e2e-chat-flow.mjs but stops at the pending
// action — no approval. Used to seed a backoffice screenshot.

import { WebSocket } from "undici";

const API_URL = "http://localhost:4000";
const AGENTS_URL = "http://localhost:8787";
const AGENTS_WS = AGENTS_URL.replace(/^http/v, "ws");

const signIn = async (email, password) => {
  const res = await fetch(`${API_URL}/api/auth/sign-in/email`, {
    body: JSON.stringify({ email, password }),
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3001" },
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`sign-in failed: ${res.status}`);
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
    const finish = () => {
      if (resolved) {
        return;
      }
      resolved = true;
      try {
        ws.close();
      } catch {
        // Best-effort close; the WS may already be torn down.
      }
      resolve();
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
    ws.addEventListener("close", finish);
    setTimeout(finish, 30_000);
  });

// Polls /api/backoffice/actions for up to 60s. Recursive tick form sidesteps
// no-await-in-loop.
const waitForPending = (operatorToken) => {
  const deadline = Date.now() + 60_000;
  const tick = async () => {
    const res = await fetch(
      `${AGENTS_URL}/api/backoffice/actions?status=pending&sort=age&cf_session=${operatorToken}`,
    );
    const body = await res.json();
    if (body.items.length > 0) {
      return body.items[0];
    }
    if (Date.now() >= deadline) {
      return null;
    }
    await wait(2000);
    return tick();
  };
  return tick();
};

const main = async () => {
  const customerToken = await signIn("customer@qolmeia.dev", "Qolmeia-Dev-CustomerPass!");
  const operatorToken = await signIn("operator@qolmeia.dev", "Qolmeia-Dev-OperatorPass!");

  const meRes = await fetch(`${AGENTS_URL}/api/me?cf_session=${customerToken}`);
  const me = await meRes.json();
  const companyId = me.currentOrg.id;

  console.log("Triggering chat...");
  await sendChat(
    companyId,
    customerToken,
    "Por favor, peça pro Designer fazer 3 ideias de banner para Instagram, formato 1:1, da minha cafeteria. Cores quentes, vibe acolhedora.",
  );

  console.log("Waiting for pending action...");
  const pending = await waitForPending(operatorToken);
  if (pending) {
    console.log(`Pending action: ${pending.id}`);
    return;
  }
  console.error("No pending action created.");
  process.exit(1);
};

try {
  await main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
