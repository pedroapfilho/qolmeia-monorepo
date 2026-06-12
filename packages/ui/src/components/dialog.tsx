import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "@repo/ui/lib/utils";
import { X } from "lucide-react";
import type { ComponentProps } from "react";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

const DialogBackdrop = ({
  className,
  ...rest
}: ComponentProps<typeof DialogPrimitive.Backdrop>) => (
  <DialogPrimitive.Backdrop
    className={cn(
      "fixed inset-0 z-50 bg-black/50 transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
      className,
    )}
    {...rest}
  />
);

const DialogContent = ({
  children,
  className,
  ...rest
}: ComponentProps<typeof DialogPrimitive.Popup>) => (
  <DialogPrimitive.Portal>
    <DialogBackdrop />
    <DialogPrimitive.Popup
      className={cn(
        "fixed top-1/2 left-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-background p-6 shadow-lg transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
        className,
      )}
      {...rest}
    >
      {children}
      <DialogPrimitive.Close
        aria-label="Fechar"
        className="absolute top-4 right-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-none"
      >
        <X className="size-4" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Popup>
  </DialogPrimitive.Portal>
);

const DialogHeader = ({ className, ...rest }: ComponentProps<"div">) => (
  <div className={cn("flex flex-col gap-1.5 text-left", className)} {...rest} />
);

const DialogFooter = ({ className, ...rest }: ComponentProps<"div">) => (
  <div
    className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
    {...rest}
  />
);

const DialogTitle = ({ className, ...rest }: ComponentProps<typeof DialogPrimitive.Title>) => (
  <DialogPrimitive.Title
    className={cn("text-lg leading-none font-semibold tracking-tight", className)}
    {...rest}
  />
);

const DialogDescription = ({
  className,
  ...rest
}: ComponentProps<typeof DialogPrimitive.Description>) => (
  <DialogPrimitive.Description
    className={cn("text-sm text-muted-foreground", className)}
    {...rest}
  />
);

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
};
