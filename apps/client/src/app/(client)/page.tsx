import type { Metadata } from "next";

import { Chat } from "@/components/chat";
import { requireCustomer, requireSession } from "@/lib/auth-helpers";

export const metadata: Metadata = {
  title: "Chat",
};

// The agent Worker URL. Defaults to the local `wrangler dev` port.
const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL ?? "http://localhost:8787";

const ChatPage = async () => {
  // Layout already gates CUSTOMER role; these calls are cached per request
  // and resolve (a) the session token the Worker validates and (b) the
  // company id the Correspondent DO is keyed by.
  const session = await requireSession();
  const me = await requireCustomer();
  const companyId = me.currentOrg?.id;
  if (!companyId) {
    throw new Error("CUSTOMER has no currentOrg — auth invariant broken");
  }

  return (
    <Chat
      agentsUrl={AGENTS_URL}
      companyId={companyId}
      sessionToken={session.session.token}
    />
  );
};

export default ChatPage;
