import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

type ToasterStyle = CSSProperties &
  Record<"--border-radius" | "--normal-bg" | "--normal-border" | "--normal-text", string>;

const TOASTER_STYLE: ToasterStyle = {
  "--border-radius": "var(--radius)",
  "--normal-bg": "var(--popover)",
  "--normal-border": "var(--border)",
  "--normal-text": "var(--popover-foreground)",
};

const Toaster = (props: ToasterProps) => (
  <Sonner className="toaster group" style={TOASTER_STYLE} {...props} />
);

export { Toaster };
