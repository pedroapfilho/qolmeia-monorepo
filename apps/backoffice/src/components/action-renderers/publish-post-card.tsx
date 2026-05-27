import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card";

import type { Action } from "@/lib/api-types";

// Renderer for the `publish_post` action type proposed by the Marketing
// Strategist Worker. Expects the proposed payload to carry the structured
// fields the `draftSocialPost` skill produces (platform, body,
// callToAction, hashtags, tone) — the LLM may also emit a `summary`
// caption that the generic Proposta card already renders.

const PLATFORM_COPY: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  twitter: "Twitter / X",
};

type Draft = {
  body?: string;
  callToAction?: string;
  hashtags?: ReadonlyArray<string>;
  platform?: string;
  tone?: string;
};

const readDraft = (proposed: Action["proposed"]): Draft | null => {
  // The Marketing Strategist Workflow attaches the draftSocialPost result
  // under `proposed.draft`. Defensive guards because the workflow shape
  // could evolve and the backoffice should still render something useful.
  const draft = (proposed as Record<string, unknown>).draft;
  if (!draft || typeof draft !== "object") {
    return null;
  }
  const d = draft as Record<string, unknown>;
  return {
    body: typeof d.body === "string" ? d.body : undefined,
    callToAction: typeof d.callToAction === "string" ? d.callToAction : undefined,
    hashtags: Array.isArray(d.hashtags)
      ? (d.hashtags.filter((h): h is string => typeof h === "string") as ReadonlyArray<string>)
      : undefined,
    platform: typeof d.platform === "string" ? d.platform : undefined,
    tone: typeof d.tone === "string" ? d.tone : undefined,
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Post sugerido</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div>
            <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Plataforma
            </dt>
            <dd className="font-medium text-foreground">
              {draft.platform ? (PLATFORM_COPY[draft.platform] ?? draft.platform) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Tom
            </dt>
            <dd className="font-medium text-foreground">{draft.tone ?? "—"}</dd>
          </div>
        </dl>

        {draft.body && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Corpo
            </span>
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm leading-relaxed whitespace-pre-wrap text-foreground">
              {draft.body}
            </div>
          </div>
        )}

        {draft.callToAction && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              CTA
            </span>
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm font-medium text-foreground">
              {draft.callToAction}
            </div>
          </div>
        )}

        {draft.hashtags && draft.hashtags.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Hashtags
            </span>
            <ul className="flex flex-wrap gap-1.5">
              {draft.hashtags.map((tag) => (
                <li
                  className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                  key={tag}
                >
                  #{tag}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export { PublishPostCard };
