import { cn } from "@repo/ui/lib/utils";

type AvatarSize = "sm" | "md" | "lg";

const PALETTE: ReadonlyArray<string> = [
  "bg-rose-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-teal-500",
  "bg-sky-500",
  "bg-indigo-500",
  "bg-fuchsia-500",
];

const SIZES: Record<AvatarSize, string> = {
  lg: "size-12 text-base",
  md: "size-9 text-sm",
  sm: "size-7 text-xs",
};

const hashSeed = (seed: string): number => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.trunc(h * 31 + (seed.codePointAt(i) ?? 0));
  }
  return Math.abs(h);
};

const initialsOf = (name: string): string => {
  const parts = name.trim().split(/\s+/v).slice(0, 2);
  return (
    parts
      .map((p) => p[0] ?? "")
      .join("")
      .toLocaleUpperCase("pt-BR") || "?"
  );
};

type AvatarProps = {
  className?: string;
  name: string;
  seed: string;
  size?: AvatarSize;
};

const Avatar = ({ className, name, seed, size = "md" }: AvatarProps) => {
  const color = PALETTE[hashSeed(seed) % PALETTE.length] ?? PALETTE[0];
  return (
    <div
      aria-hidden
      className={cn(
        "inline-flex items-center justify-center rounded-full font-semibold text-white",
        SIZES[size],
        color,
        className,
      )}
    >
      {initialsOf(name)}
    </div>
  );
};

export { Avatar };
export type { AvatarProps, AvatarSize };
