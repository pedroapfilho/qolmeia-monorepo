import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = (props: ToasterProps) => (
  <Sonner
    className="toaster group"
    style={
      // oxlint-disable-next-line no-unsafe-type-assertion -- CSS custom properties are not representable in React.CSSProperties
      {
        "--border-radius": "var(--radius)",
        "--normal-bg": "var(--popover)",
        "--normal-border": "var(--border)",
        "--normal-text": "var(--popover-foreground)",
      } as React.CSSProperties
    }
    {...props}
  />
);

export { Toaster };
