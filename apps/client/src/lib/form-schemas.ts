import { z } from "zod";

// Client app uses magic-link only — no password. Schemas live here even
// though there's just one form so future additions (profile, etc.) have
// a home and the file matches backoffice's layout.
export const magicLinkSchema = z.object({
  email: z.string().email("E-mail inválido"),
});
