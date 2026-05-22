import type { Metadata } from "next";

import { Chat } from "@/components/chat";
import { requireSession } from "@/lib/auth-helpers";

export const metadata: Metadata = {
  title: "Chat",
};

// The agent Worker URL. Defaults to the local `wrangler dev` port.
const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL ?? "http://localhost:8787";

const ChatPage = async () => {
  // The layout already guards CUSTOMER role; this resolves the session token
  // the chat client forwards to the Worker (cached per-request).
  const session = await requireSession();

  return <Chat agentsUrl={AGENTS_URL} sessionToken={session.session.token} />;
};

export default ChatPage;
