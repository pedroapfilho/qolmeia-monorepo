import { createRedisState } from "@chat-adapter/state-redis";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { prisma } from "@repo/db";
import { Chat } from "chat";

import { dispatcher } from "../agents/main-dispatcher";
import { env } from "../lib/env";

import { handleIncomingMessage } from "./handler";

// Ensure env validation has run and these vars are present before the SDK
// reads them from process.env at adapter construction time.
void env.AI_GATEWAY_API_KEY;
void env.REDIS_URL;
void env.TELEGRAM_BOT_TOKEN;
void env.TELEGRAM_WEBHOOK_SECRET_TOKEN;

const bot = new Chat({
  adapters: { telegram: createTelegramAdapter({ mode: "webhook" }) },
  concurrency: "queue",
  logger: "info",
  state: createRedisState(),
  userName: env.TELEGRAM_BOT_USERNAME,
});

// First message in an unsubscribed thread (includes DMs when no onDirectMessage
// handler is registered, per SDK routing rules).
bot.onNewMention(async (thread, message) => {
  await thread.subscribe();
  await handleIncomingMessage({ dispatcher, prisma }, thread, message);
});

// All follow-up messages in subscribed threads.
bot.onSubscribedMessage(async (thread, message) => {
  await handleIncomingMessage({ dispatcher, prisma }, thread, message);
});

export { bot };
