// Role-keyed avatar hue + monogram, matching the design's fixed avatar palette
// (correspondent→1, designer→2, estrategista→3, redator→4, social→5,
// planner→6, fallback→8). Workers map by their kind keyword.

const WORKER_KIND_AVATAR: ReadonlyArray<{ cls: string; match: RegExp }> = [
  { cls: "bg-avatar-2", match: /design|art|imagem/iv },
  { cls: "bg-avatar-3", match: /estrateg|strateg|plano/iv },
  { cls: "bg-avatar-4", match: /redat|copy|escrit|texto/iv },
  { cls: "bg-avatar-5", match: /social|m[ií]dia|community/iv },
];

const agentAvatarClass = (role: string, workerKind: string | null): string => {
  if (role === "correspondent") {
    return "bg-avatar-1";
  }
  if (role === "planner") {
    return "bg-avatar-6";
  }
  const hit = WORKER_KIND_AVATAR.find((w) => w.match.test(workerKind ?? ""));
  return hit?.cls ?? "bg-avatar-8";
};

const agentInitials = (name: string): string =>
  name
    .trim()
    .split(/\s+/v)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.at(0)?.toUpperCase() ?? "")
    .join("") || "?";

export { agentAvatarClass, agentInitials };
