import { cn } from "@repo/ui/lib/utils";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type BackLinkProps = Omit<ComponentProps<typeof Link>, "children"> & {
  children: ReactNode;
};

const BackLink = ({ children, className, ...props }: BackLinkProps) => (
  <Link
    className={cn(
      "inline-flex w-fit items-center gap-1 text-sm font-medium text-muted-foreground transition-colors",
      "hover:text-foreground focus-visible:text-foreground focus-visible:outline-none",
      className,
    )}
    {...props}
  >
    <ChevronLeft aria-hidden className="size-4" />
    {children}
  </Link>
);

export { BackLink };
