import { Card } from "@repo/ui/components/card";
import type { Action } from "@repo/worker-api/contracts";
import { z } from "zod";

const PLATFORM_COPY: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  twitter: "Twitter / X",
};

const PLATFORM_ABBR: Record<string, string> = {
  facebook: "FB",
  instagram: "IG",
  linkedin: "in",
  twitter: "X",
};

type Draft = {
  body?: string;
  callToAction?: string;
  hashtags?: ReadonlyArray<string>;
  platform?: string;
  tone?: string;
};

const hasText = (value: string | undefined): value is string => value !== undefined && value !== "";

const draftSchema = z.record(z.string(), z.unknown());

const readDraft = (proposed: Action["proposed"]): Draft | null => {
  const parsed = draftSchema.safeParse(proposed.draft);
  if (!parsed.success) {
    return null;
  }
  const draft = parsed.data;
  return {
    body: typeof draft.body === "string" ? draft.body : undefined,
    callToAction: typeof draft.callToAction === "string" ? draft.callToAction : undefined,
    hashtags: Array.isArray(draft.hashtags)
      ? draft.hashtags.filter((h): h is string => typeof h === "string")
      : undefined,
    platform: typeof draft.platform === "string" ? draft.platform : undefined,
    tone: typeof draft.tone === "string" ? draft.tone : undefined,
  };
};

type PublishPostCardProps = {
  proposed: Action["proposed"];
};

const PublishPostCard = ({ proposed }: PublishPostCardProps) => {
  const draft = readDraft(proposed);
  if (!draft) {
    return null;
  }

  const platformLabel = hasText(draft.platform)
    ? (PLATFORM_COPY[draft.platform] ?? draft.platform)
    : "Rede social";
  const platformAbbr = hasText(draft.platform) ? (PLATFORM_ABBR[draft.platform] ?? "•") : "•";

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex items-center gap-2.5 border-b border-border/60 px-4 py-3.5">
        <div
          aria-hidden
          className="flex size-7 items-center justify-center rounded-[10px] bg-destructive-surface text-[11px] font-bold text-destructive-surface-foreground"
        >
          {platformAbbr}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold text-foreground">Publicar em {platformLabel}</div>
          {hasText(draft.tone) && (
            <div className="text-xs text-muted-foreground">Tom · {draft.tone}</div>
          )}
        </div>
        <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">
          feed · 1080×1080
        </span>
      </div>

      <div
        aria-label="Pré-visualização da arte gerada pelo Designer"
        className="flex h-[320px] items-center justify-center bg-[repeating-linear-gradient(45deg,var(--color-muted),var(--color-muted)_13px,var(--color-secondary)_13px,var(--color-secondary)_26px)]"
      >
        <span className="rounded-md border border-border bg-card px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
          arte gerada pelo Designer
        </span>
      </div>

      <div className="flex flex-col gap-3 px-4 py-4">
        {hasText(draft.body) && (
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">
            {draft.body}
          </p>
        )}

        {hasText(draft.callToAction) && (
          <p className="text-sm font-medium text-foreground">{draft.callToAction}</p>
        )}

        {draft.hashtags && draft.hashtags.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {draft.hashtags.map((tag) => (
              <li
                className="rounded-full bg-highlight-surface px-2 py-0.5 text-xs font-medium text-highlight-surface-foreground"
                key={tag}
              >
                #{tag}
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-2 border-t border-border/60 pt-3">
          <div
            aria-hidden
            className="flex size-[22px] items-center justify-center rounded-[6px] text-[9px] font-bold text-white"
            style={{ background: "var(--color-avatar-2)" }}
          >
            DE
          </div>
          <span className="text-xs text-muted-foreground">Gerado pelo Designer</span>
        </div>
      </div>
    </Card>
  );
};

export { PublishPostCard };
