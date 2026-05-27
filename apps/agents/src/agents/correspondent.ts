import { AIChatAgent } from "@cloudflare/ai-chat";
import {
  generateText,
  stepCountIs,
  streamText,
  type StreamTextOnFinishCallback,
  type ToolSet,
} from "ai";

import {
  type AttachedImage,
  buildModelMessages,
  buildSystemPrompt,
  extractImages,
  extractText,
  MEMORY_MIN_SCORE,
  MEMORY_TOP_K,
  RECENT_TURNS_KEEP,
  RECENT_TURNS_WINDOW,
} from "@/agents/correspondent-context";
import { appendTurn, getRecentTurns, pruneOldTurns } from "@/agents/recent-turns";
import { getAdapter } from "@/connectors/registry";
import type { ConnectorType, NormalizedMessage } from "@/connectors/types";
import { getAction } from "@/db/action";
import { insertMemoryFact, insertMessage, upsertConversation } from "@/db/schema";
import { getModel } from "@/lib/ai-gateway";
import type { CompanyBriefPartial } from "@/lib/company-brief";
import { getConnectorSecrets } from "@/lib/connector-secrets";
import { logError, logInfo, logWarn } from "@/lib/logger";
import { getMemoryAdapter } from "@/lib/memory";
import { fetchAsset } from "@/lib/r2";
import { buildSkillTools } from "@/skills/registry";

// Pulls the asset id segment out of `…/assets/<id>?token=…`. Accepts both
// absolute http(s) URLs and bare paths. Returns null when the shape doesn't
// match — callers should drop the attachment in that case.
const extractAssetIdFromUrl = (url: string): string | null => {
  let path: string;
  try {
    path = url.startsWith("http") ? new URL(url).pathname : (url.split("?")[0] ?? "");
  } catch {
    return null;
  }
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf("assets");
  if (idx === -1 || idx !== segments.length - 2) {
    return null;
  }
  return segments.at(-1) ?? null;
};

const arrayBufferToDataUrl = (buf: ArrayBuffer, mime: string): string => {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) {
    s += String.fromCodePoint(b);
  }
  return `data:${mime};base64,${btoa(s)}`;
};

// The Correspondent. Keyed by company id (`this.name`). Memory plumbing:
// recent-turns buffer in DO SQLite (always-in-context) + vector recall from
// the memory adapter (top-K facts injected into the system prompt). Both
// channels write on each turn so the next turn sees them.
class CorrespondentAgent extends AIChatAgent<Env> {
  // Model resolution is a seam: the DO runs inside the bundled worker, out
  // of reach of module mocks, so tests inject a scripted model by reassigning
  // this method on the instance.
  resolveModel() {
    return getModel(this.env);
  }

  // Rewrites each attached image's signed http(s) URL to a data: URL by
  // reading bytes from R2 directly. The AI SDK's built-in downloader rejects
  // localhost/private-IP hosts (SSRF guard), which makes signed dev URLs
  // unfetchable; data: bypasses the validator and also avoids a redundant
  // HTTP roundtrip in prod (Worker → its own /assets endpoint → R2). Scoped
  // to the current company so a pasted asset id from elsewhere can't leak.
  private async resolveImagesToDataUrls(
    images: ReadonlyArray<AttachedImage>,
  ): Promise<ReadonlyArray<AttachedImage>> {
    if (images.length === 0) {
      return images;
    }
    const companyId = this.name;
    const resolved = await Promise.all(
      images.map(async (image) => {
        if (image.url.startsWith("data:")) {
          return image;
        }
        const assetId = extractAssetIdFromUrl(image.url);
        if (!assetId) {
          logWarn("agent.attachment.skip", { companyId, reason: "url-not-asset", url: image.url });
          return null;
        }
        const row = await this.env.DB.prepare(
          "SELECT r2_key, mime FROM asset WHERE id = ? AND company_id = ?",
        )
          .bind(assetId, companyId)
          .first<{ mime: string; r2_key: string }>();
        if (!row) {
          logWarn("agent.attachment.skip", { assetId, companyId, reason: "asset-not-found" });
          return null;
        }
        const object = await fetchAsset({ ASSETS: this.env.ASSETS }, row.r2_key);
        if (!object) {
          logWarn("agent.attachment.skip", { assetId, companyId, reason: "r2-miss" });
          return null;
        }
        const buf = await object.arrayBuffer();
        return { mediaType: row.mime, url: arrayBufferToDataUrl(buf, row.mime) };
      }),
    );
    return resolved.filter((value): value is AttachedImage => value !== null);
  }

  // Persists a turn everywhere a future turn looks: D1 (system of record),
  // recent-turns buffer (model context), memory adapter (recall). Used for
  // both inbound user messages and outbound agent replies.
  private async recordTurn(
    role: "agent" | "user",
    conversationId: string,
    messageId: string,
    content: string,
  ): Promise<void> {
    const companyId = this.name;
    const agentInstanceId = `corr-${companyId}`;
    await insertMessage(this.env.DB, {
      agentInstanceId: role === "agent" ? agentInstanceId : undefined,
      companyId,
      content,
      conversationId,
      id: messageId,
      role,
    });
    appendTurn(this, role, content);
    await getMemoryAdapter(this.env).upsert({
      agentInstanceId,
      companyId,
      content,
      createdAt: Date.now(),
      id: messageId,
      kind: "message",
    });
    if (role === "agent") {
      pruneOldTurns(this, RECENT_TURNS_KEEP);
    }
  }

  // Called by the WorkerJob Workflow when a Worker proposes a gated action.
  // Formats the proposal as an assistant message + persists it everywhere
  // the next chat turn looks: D1 (system of record), the SDK's message list
  // (which it auto-broadcasts to connected WS clients), and the recent-turns
  // buffer (so the model sees the proposal in context and knows to call
  // decideAction on the User's next reply).
  async presentAction(actionId: string): Promise<void> {
    const action = await getAction(this.env.DB, actionId);
    if (!action) {
      logInfo("agent.presentAction.skip", { actionId, reason: "action not found" });
      return;
    }
    const proposedSummary =
      typeof action.proposed.summary === "string" ? action.proposed.summary : "";
    const text = `🟡 **Ação pendente** (id: \`${actionId}\`)

O especialista propõe:

${proposedSummary}

Quer **aprovar**, **ajustar** (diga o que mudar) ou **rejeitar**?`;

    const companyId = this.name;
    const agentInstanceId = `corr-${companyId}`;
    const conversationId = `web-${companyId}`;
    const messageId = crypto.randomUUID();

    logInfo("agent.presentAction", {
      actionId,
      actionType: action.actionType,
      agentInstanceId,
      companyId,
      proposedSummary,
    });

    await upsertConversation(this.env.DB, {
      companyId,
      externalThreadId: "web",
      id: conversationId,
    });
    await insertMessage(this.env.DB, {
      agentInstanceId,
      companyId,
      content: text,
      conversationId,
      id: messageId,
      role: "agent",
    });
    appendTurn(this, "agent", text);
    await this.saveMessages([
      ...this.messages,
      { id: messageId, parts: [{ text, type: "text" }], role: "assistant" },
    ]);
  }

  // Called by the webhooks route when a NormalizedMessage arrives from an
  // external channel (Telegram, etc.). Mirrors the chat-loop logic in
  // onChatMessage but uses generateText (non-streaming) and sends the reply
  // out via the channel adapter — there's no WebSocket client on this path.
  async handleInboundFromConnector(input: {
    connectorId: string;
    connectorType: ConnectorType;
    conversationId: string;
    message: NormalizedMessage;
  }): Promise<void> {
    const connectorStart = Date.now();
    const companyId = this.name;
    const agentInstanceId = `corr-${companyId}`;
    const memory = getMemoryAdapter(this.env);
    const text = input.message.text;
    if (!text) {
      logInfo("agent.connector.skip", {
        companyId,
        connectorId: input.connectorId,
        connectorType: input.connectorType,
        reason: "empty inbound text",
      });
      return;
    }

    logInfo("agent.connector.start", {
      agentInstanceId,
      companyId,
      connectorId: input.connectorId,
      connectorType: input.connectorType,
      externalThreadId: input.message.externalThreadId,
      userText: text,
    });

    await this.recordTurn("user", input.conversationId, input.message.externalId, text);

    const retrieved = await memory.retrieve({
      agentInstanceId,
      minScore: MEMORY_MIN_SCORE,
      query: text,
      topK: MEMORY_TOP_K,
    });
    const turns = getRecentTurns(this, RECENT_TURNS_WINDOW);
    const messages = buildModelMessages(turns, { userImages: [], userText: text });
    const tools = await buildSkillTools({ agentInstanceId, companyId, env: this.env }, [
      "rememberFact",
      "recallMemory",
      "delegateToWorker",
      "decideAction",
    ]);

    let reply: string;
    let toolCallNames: Array<string> = [];
    let usage: unknown = null;
    try {
      const result = await generateText({
        messages,
        model: this.resolveModel(),
        stopWhen: stepCountIs(3),
        system: buildSystemPrompt(retrieved),
        tools,
      });
      reply = result.text.trim();
      toolCallNames = (result.steps ?? []).flatMap((s) =>
        (s.toolCalls ?? []).map((tc) => tc.toolName),
      );
      usage = result.usage;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError("agent.connector.err", {
        agentInstanceId,
        companyId,
        connectorId: input.connectorId,
        connectorType: input.connectorType,
        error: message,
      });
      return;
    }
    if (!reply) {
      logInfo("agent.connector.skip", {
        agentInstanceId,
        companyId,
        connectorId: input.connectorId,
        reason: "empty model reply",
      });
      return;
    }

    await this.recordTurn("agent", input.conversationId, crypto.randomUUID(), reply);

    // Send the reply back out through the channel. Failure here is logged
    // but doesn't blow up — the reply still lives in D1; operator can
    // surface it from the backoffice.
    const adapter = getAdapter(input.connectorType);
    const config = await getConnectorSecrets(this.env, input.connectorId);
    if (!adapter || !config) {
      logError("agent.connector.outbound.err", {
        agentInstanceId,
        companyId,
        connectorId: input.connectorId,
        connectorType: input.connectorType,
        reason: "missing adapter or config",
      });
      return;
    }
    try {
      await adapter.sendOutbound({
        config,
        externalThreadId: input.message.externalThreadId,
        text: reply,
      });
      logInfo("agent.connector.ok", {
        agentInstanceId,
        companyId,
        connectorId: input.connectorId,
        connectorType: input.connectorType,
        durationMs: Date.now() - connectorStart,
        replyText: reply,
        toolCallNames,
        usage,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError("agent.connector.outbound.err", {
        agentInstanceId,
        companyId,
        connectorId: input.connectorId,
        connectorType: input.connectorType,
        error: message,
      });
    }
  }

  // Called by the team-confirm route after materializeTeam. Writes structured
  // facts into memory so the Correspondent's first chat turn already knows
  // who the customer is, instead of starting blank.
  async seedMemory(input: {
    brief: Partial<CompanyBriefPartial>;
    debriefSummary: string;
  }): Promise<void> {
    const companyId = this.name;
    const agentInstanceId = `corr-${companyId}`;
    const memory = getMemoryAdapter(this.env);

    const facts: Array<{ content: string; kind: string }> = [
      input.brief.industry && { content: `Setor: ${input.brief.industry}`, kind: "industry" },
      input.brief.primaryGoal && {
        content: `Objetivo principal: ${input.brief.primaryGoal}`,
        kind: "goal",
      },
      input.brief.audience && { content: `Público: ${input.brief.audience}`, kind: "audience" },
      input.brief.channels?.length && {
        content: `Canais ativos: ${input.brief.channels.join(", ")}`,
        kind: "channels",
      },
      input.brief.brand?.voice && {
        content: `Tom da marca: ${input.brief.brand.voice}`,
        kind: "brand_voice",
      },
      input.brief.brand?.palette && {
        content: `Paleta: ${input.brief.brand.palette}`,
        kind: "brand_palette",
      },
      input.debriefSummary && { content: input.debriefSummary, kind: "onboarding_summary" },
    ].filter(Boolean) as Array<{ content: string; kind: string }>;

    await Promise.all(
      facts.map(async (fact) => {
        const id = crypto.randomUUID();
        await insertMemoryFact(this.env.DB, {
          agentInstanceId,
          companyId,
          content: fact.content,
          id,
          kind: fact.kind,
        });
        await memory.upsert({
          agentInstanceId,
          companyId,
          content: fact.content,
          createdAt: Date.now(),
          id,
          kind: fact.kind,
        });
      }),
    );
  }

  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
  ): Promise<Response | undefined> {
    const turnStart = Date.now();
    const companyId = this.name;
    const agentInstanceId = `corr-${companyId}`;
    const conversationId = `web-${companyId}`;
    const memory = getMemoryAdapter(this.env);

    await upsertConversation(this.env.DB, {
      companyId,
      externalThreadId: "web",
      id: conversationId,
    });

    // Persist user turn to D1 + recent-turns buffer + memory adapter. Images
    // are stored as a text marker (the buffer is text-only); the live multimodal
    // payload for the model is built separately below.
    const lastMessage = this.messages.at(-1);
    const userText = lastMessage?.role === "user" ? extractText(lastMessage) : "";
    const userImages = lastMessage?.role === "user" ? extractImages(lastMessage) : [];
    const persistedText =
      userImages.length > 0
        ? `${userText}\n[Imagem anexada: ${userImages.length}]`.trim()
        : userText;
    if (lastMessage?.role === "user" && persistedText.length > 0) {
      await this.recordTurn("user", conversationId, lastMessage.id, persistedText);
    }

    // Build the model context from our buffers — NOT this.messages. The SDK's
    // history is for the client; we own what the model sees.
    const retrieved =
      userText.length > 0
        ? await memory.retrieve({
            agentInstanceId,
            minScore: MEMORY_MIN_SCORE,
            query: userText,
            topK: MEMORY_TOP_K,
          })
        : [];
    const turns = getRecentTurns(this, RECENT_TURNS_WINDOW);
    const resolvedImages = await this.resolveImagesToDataUrls(userImages);
    const messages = buildModelMessages(turns, { userImages: resolvedImages, userText });

    logInfo("agent.turn.start", {
      agent: "correspondent",
      agentInstanceId,
      companyId,
      memoryFactCount: retrieved.length,
      memoryFactKinds: retrieved.map((r) => r.kind),
      turnCount: turns.length,
      userText,
    });

    // Correspondent's skill set is fixed for P4 — the role='correspondent'
    // agent_instance has no template binding (templates are for Workers).
    // decideAction lets it interpret User replies to pending Actions.
    const tools = await buildSkillTools({ agentInstanceId, companyId, env: this.env }, [
      "rememberFact",
      "recallMemory",
      "delegateToWorker",
      "decideAction",
    ]);

    const result = streamText({
      messages,
      model: this.resolveModel(),
      onFinish: async (event) => {
        const agentText = event.text;
        await this.recordTurn("agent", conversationId, crypto.randomUUID(), agentText);
        logInfo("agent.turn.ok", {
          agent: "correspondent",
          agentInstanceId,
          companyId,
          durationMs: Date.now() - turnStart,
          finishReason: event.finishReason,
          replyText: agentText,
          stepCount: event.steps?.length ?? 0,
          toolCallNames: (event.steps ?? []).flatMap((s) =>
            (s.toolCalls ?? []).map((tc) => tc.toolName),
          ),
          usage: event.usage,
        });
        await onFinish(event);
      },
      // 3 steps: model emits a tool call → tool result feeds back → final reply.
      stopWhen: stepCountIs(3),
      system: buildSystemPrompt(retrieved),
      tools,
    });

    return result.toUIMessageStreamResponse();
  }
}

export { CorrespondentAgent };
