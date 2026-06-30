import { Loader2 } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

const Spinner = ({ className, ...props }: ComponentProps<typeof Loader2>) => (
  <Loader2
    aria-label="Carregando"
    className={cn("size-4 animate-spin", className)}
    data-slot="spinner"
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- decorative SVG spinner, not an <output>
    role="status"
    {...props}
  />
);

export { Spinner };
