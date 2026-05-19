import { Hono } from "hono";

import { bot } from "../../telegram/bot";

const telegramWebhookRoutes = new Hono();

// The adapter validates the X-Telegram-Bot-Api-Secret-Token header internally.
telegramWebhookRoutes.post("/webhook", (c) => bot.webhooks.telegram(c.req.raw));

export { telegramWebhookRoutes };
