import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

// Single source of truth for content-page width and padding. Every non-chat
// page wraps its content in this so column width, gutters, and vertical rhythm
// stay identical across the app instead of each page picking its own max-width.
const PageContainer = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    className={cn(
      "mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10",
      className,
    )}
    data-slot="page-container"
    {...props}
  />
);

export { PageContainer };
