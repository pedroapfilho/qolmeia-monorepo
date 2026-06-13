"use client";

import { Button } from "@repo/ui/components/button";
import { toast } from "@repo/ui/lib/toast";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";

type SignOutButtonProps = {
  className?: string;
  label?: string;
};

const SignOutButton = ({ className, label = "Sair" }: SignOutButtonProps) => {
  const { push, refresh } = useRouter();
  const [pending, setPending] = useState(false);

  const signOut = async () => {
    if (pending) {
      return;
    }
    setPending(true);
    try {
      await authClient.signOut();
      push("/login");
      refresh();
    } catch {
      // Surface failures via toast so a stuck cookie doesn't silently keep the user in.
      toast.error("Não foi possível sair. Tente novamente.");
      setPending(false);
    }
  };

  return (
    <Button
      className={className}
      disabled={pending}
      onClick={signOut}
      type="button"
      variant="ghost"
    >
      <LogOut aria-hidden />
      {label}
    </Button>
  );
};

export { SignOutButton };
