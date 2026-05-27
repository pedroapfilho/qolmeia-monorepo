import { Button as ButtonPrimitive } from "@base-ui/react/button";

import { type ButtonVariantProps, buttonVariants } from "../lib/button-variants";
import { cn } from "../lib/utils";

const Button = ({
  className,
  size = "default",
  variant = "default",
  ...props
}: ButtonPrimitive.Props & ButtonVariantProps) => (
  <ButtonPrimitive
    className={cn(buttonVariants({ className, size, variant }))}
    data-slot="button"
    {...props}
  />
);

export { Button };
