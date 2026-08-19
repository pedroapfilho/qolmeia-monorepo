import { z } from "zod";

export const magicLinkSchema = z.object({
  email: z.email("E-mail inválido"),
});

export const loginSchema = magicLinkSchema.extend({
  password: z.string().min(1, "Informe sua senha"),
});
