import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Chat",
};

// Placeholder — the real chat UI (message list + composer + SSE) lands in
// the next commit. Keeping a stub here so the scaffold builds + the
// dashboard layout has something to render.
const ChatPage = () => (
  <div className="mx-auto w-full max-w-3xl px-4 py-8">
    <h1 className="text-2xl font-semibold tracking-tight">Chat</h1>
    <p className="mt-2 text-sm text-muted-foreground">
      Em breve. Seu chat com os agentes da Qolmeia aparece aqui.
    </p>
  </div>
);

export default ChatPage;
