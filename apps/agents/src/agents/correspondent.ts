import { AIChatAgent } from "@cloudflare/ai-chat";
import {
  generateText,
  type ModelMessage,
  stepCountIs,
  streamText,
  type StreamTextOnFinishCallback,
  type ToolSet,
} from "ai";

import { resolveImagesToDataUrls } from "@/agents/asset-url-resolver";
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
import { insertMemoryFact, insertMessage, upsertConversation } from "@/db/schema";
import { getModel } from "@/lib/ai-gateway";
import type { CompanyBriefPartial } from "@/lib/company-brief";
import { getConnectorSecrets } from "@/lib/connector-secrets";
import { logError, logInfo } from "@/lib/logger";
import { getMemoryAdapter } from "@/lib/memory";
import { buildSkillTools } from "@/skills/registry";

const CORRESPONDENT_SKILLS = ["rememberFact", "recallMemory", "delegateToWorker"] as const;

type TeamEvent =
  | {
      companyId: string;
      reason: "ticket_changed" | "instance_changed";
      type: "team:status";
    }
  | {
      companyId: string;
      reason: "hired" | "paused" | "resumed" | "renamed" | "prompt_changed";
      type: "team:roster";
    };

// 3 steps: model emits a tool call → tool result feeds back → final reply.
const CORRESPONDENT_STOP_STEPS = 3;

// What `prepareConversationTurn` hands back to the two model-calling paths
// (web stream, connector reply). The caller decides whether to streamText or
// generateText; everything else — memory, messages, system prompt, tools,
// and the recorder closure for the eventual reply — is wired here.
type PreparedTurn = {
  messages: Array<ModelMessage>;
  recordAgentReply: (reply: string) => Promise<void>;
  system: string;
  tools: ToolSet;
};

// The Correspondent. Keyed by company id (`this.name`). Memory plumbing:
// recent-turns buffer in DO SQLite (always-in-context) + vector recall from
// the memory adapter (top-K facts injected into the system prompt). Both
// channels write on each turn so the next turn sees them.
//
// Three model-using surfaces compose with `prepareConversationTurn`:
//   - onChatMessage: web-chat streaming reply
//   - handleInboundFromConnector: external-channel non-streaming reply
// Two model-less surfaces stay direct (the Workflow + team-confirm RPCs):
//   - presentResult: deliverable injection after a Worker job finishes
//     (approved on /approvals or auto-executed). The customer never sees
//     the pending proposal — operators are the sole approvers.
//   - seedMemory: team-confirm hook seeding the brief into memory
class CorrespondentAgent extends AIChatAgent<Env> {
  // Model resolution is a seam: the DO runs inside the bundled worker, out
  // of reach of module mocks, so tests inject a scripted model by reassigning
  // this method on the instance.
  resolveModel() {
    return getModel(this.env);
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

  // The shared turn prelude. Given the inbound text + optional images +
  // conversation/message ids, persist the user turn, retrieve memory,
  // build the model messages, resolve images, build the skill tools, and
  // hand the caller back everything streamText/generateText needs plus a
  // recorder closure to call with the eventual reply.
  //
  // This is the deep module — the only place where "what is a Correspondent
  // turn?" is answered. The two callers (web chat + connector inbound)
  // differ only in transport (stream vs await) and how the reply is sent
  // back to the user.
  private async prepareConversationTurn(input: {
    conversationId: string;
    userImages: ReadonlyArray<AttachedImage>;
    userMessageId: string;
    userText: string;
  }): Promise<PreparedTurn> {
    const companyId = this.name;
    const agentInstanceId = `corr-${companyId}`;
    const memory = getMemoryAdapter(this.env);

    // Persist the user turn (the buffer is text-only — images are noted in
    // the persisted text marker; the multimodal payload below is what the
    // model actually sees).
    const persistedText =
      input.userImages.length > 0
        ? `${input.userText}\n[Imagem anexada: ${input.userImages.length}]`.trim()
        : input.userText;
    if (persistedText.length > 0) {
      await this.recordTurn("user", input.conversationId, input.userMessageId, persistedText);
    }

    const retrieved =
      input.userText.length > 0
        ? await memory.retrieve({
            agentInstanceId,
            minScore: MEMORY_MIN_SCORE,
            query: input.userText,
            topK: MEMORY_TOP_K,
          })
        : [];
    const turns = getRecentTurns(this, RECENT_TURNS_WINDOW);
    const resolvedImages = await resolveImagesToDataUrls(
      { ASSETS: this.env.ASSETS, DB: this.env.DB },
      companyId,
      input.userImages,
    );
    const messages = buildModelMessages(turns, {
      userImages: resolvedImages,
      userText: input.userText,
    });
    const tools = await buildSkillTools({ agentInstanceId, companyId, env: this.env }, [
      ...CORRESPONDENT_SKILLS,
    ]);

    return {
      messages,
      recordAgentReply: async (reply: string) => {
        await this.recordTurn("agent", input.conversationId, crypto.randomUUID(), reply);
      },
      system: buildSystemPrompt(retrieved),
      tools,
    };
  }

  // Fans a team:* invalidation ping out to all connected WS peers. Pure
  // invalidation — the payload carries no row data, the client refetches
  // /api/me/team on receipt. Errors are swallowed by callers (emitTeamEvent):
  // the DB is source of truth, the event is a cache hint.
  broadcastTeamEvent(event: TeamEvent): void {
    const frame = JSON.stringify(event);
    let attempted = 0;
    let succeeded = 0;
    for (const peer of this.getConnections()) {
      attempted++;
      try {
        peer.send(frame);
        succeeded++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logInfo("agent.broadcastTeamEvent.send.err", {
          companyId: event.companyId,
          error: message,
          type: event.type,
        });
      }
    }
    if (attempted > 0 && succeeded === 0) {
      logError("agent.broadcastTeamEvent.totalFail", {
        attempted,
        companyId: event.companyId,
        type: event.type,
      });
    }
  }

  // Called by the WorkerJob Workflow once a deliverable is ready to ship
  // to the customer. "Ready" means one of:
  //   - policy = auto-execute → the work ran without a gate.
  //   - policy = require-approval AND an operator approved on /approvals
  //     (the customer never sees the pending proposal — operators decide).
  //
  // The deliverable text is the Worker's own LLM output (markdown, with
  // inline image URLs already rendered by the Designer's generateBrandImage
  // skill). We just persist it as a regular agent turn everywhere a future
  // turn looks: D1, the SDK's message list (auto-broadcast to connected WS
  // clients), and the recent-turns buffer.
  async presentResult(args: { result: string; ticketId: string }): Promise<void> {
    const text = args.result.trim();
    if (text.length === 0) {
      logInfo("agent.presentResult.skip", { reason: "empty result", ticketId: args.ticketId });
      return;
    }

    const companyId = this.name;
    const agentInstanceId = `corr-${companyId}`;
    const conversationId = `web-${companyId}`;
    const messageId = crypto.randomUUID();

    logInfo("agent.presentResult", {
      agentInstanceId,
      companyId,
      replyText: text,
      ticketId: args.ticketId,
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
  // external channel (Telegram, etc.). Same prepared-turn primitive as the
  // web-chat path but uses generateText (non-streaming) and sends the reply
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

    const turn = await this.prepareConversationTurn({
      conversationId: input.conversationId,
      userImages: [],
      userMessageId: input.message.externalId,
      userText: text,
    });

    let reply: string;
    let toolCallNames: Array<string> = [];
    let usage: unknown = null;
    try {
      const result = await generateText({
        messages: turn.messages,
        model: this.resolveModel(),
        stopWhen: stepCountIs(CORRESPONDENT_STOP_STEPS),
        system: turn.system,
        tools: turn.tools,
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

    await turn.recordAgentReply(reply);

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

    await upsertConversation(this.env.DB, {
      companyId,
      externalThreadId: "web",
      id: conversationId,
    });

    const lastMessage = this.messages.at(-1);
    const userText = lastMessage?.role === "user" ? extractText(lastMessage) : "";
    const userImages = lastMessage?.role === "user" ? extractImages(lastMessage) : [];

    const turn = await this.prepareConversationTurn({
      conversationId,
      userImages,
      userMessageId: lastMessage?.id ?? crypto.randomUUID(),
      userText,
    });

    logInfo("agent.turn.start", {
      agent: "correspondent",
      agentInstanceId,
      companyId,
      hasImages: userImages.length > 0,
      turnCount: turn.messages.length,
      userText,
    });

    const result = streamText({
      messages: turn.messages,
      model: this.resolveModel(),
      onFinish: async (event) => {
        await turn.recordAgentReply(event.text);
        logInfo("agent.turn.ok", {
          agent: "correspondent",
          agentInstanceId,
          companyId,
          durationMs: Date.now() - turnStart,
          finishReason: event.finishReason,
          replyText: event.text,
          stepCount: event.steps?.length ?? 0,
          toolCallNames: (event.steps ?? []).flatMap((s) =>
            (s.toolCalls ?? []).map((tc) => tc.toolName),
          ),
          usage: event.usage,
        });
        await onFinish(event);
      },
      stopWhen: stepCountIs(CORRESPONDENT_STOP_STEPS),
      system: turn.system,
      tools: turn.tools,
    });

    return result.toUIMessageStreamResponse();
  }
}

export { CorrespondentAgent };
export type { TeamEvent };
