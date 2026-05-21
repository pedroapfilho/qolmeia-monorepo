import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("E-mail inválido"),
  password: z.string().min(12, "A senha deve ter pelo menos 12 caracteres"),
});

export const registerSchema = z.object({
  confirmPassword: z.string().min(12, "A senha deve ter pelo menos 12 caracteres"),
  email: z.string().email("E-mail inválido"),
  name: z
    .string()
    .min(3, "O nome deve ter pelo menos 3 caracteres")
    .max(32, "O nome deve ter no máximo 32 caracteres"),
  password: z.string().min(12, "A senha deve ter pelo menos 12 caracteres"),
});

export const recoverSchema = z.object({
  email: z.string().email("E-mail inválido"),
});

export const resetPasswordSchema = z.object({
  confirmPassword: z.string().min(12, "A senha deve ter pelo menos 12 caracteres"),
  password: z.string().min(12, "A senha deve ter pelo menos 12 caracteres"),
});

export const inviteSchema = z.object({
  email: z.string().email("E-mail inválido"),
  name: z
    .string()
    .min(2, "O nome deve ter pelo menos 2 caracteres")
    .max(120, "O nome deve ter no máximo 120 caracteres"),
  role: z.enum(["STAFF", "CUSTOMER"]),
});
