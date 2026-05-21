"use client";

import { Button } from "@repo/ui/components/button";
import { toast } from "@repo/ui/components/sonner";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";

type SignOutButtonProps = {
  className?: string;
  label?: string;
};

const SignOutButton = ({ className, label = "Sair" }: SignOutButtonProps) => {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const handleClick = async () => {
    if (pending) {
      return;
    }
    setPending(true);
    try {
      await authClient.signOut();
      router.push("/login");
      router.refresh();
    } catch (error) {
      console.error("[sign-out] failed", { error });
      toast.error("Não foi possível sair. Tente novamente.");
      setPending(false);
    }
  };

  return (
    <Button
      className={className}
      disabled={pending}
      onClick={handleClick}
      type="button"
      variant="ghost"
    >
      <LogOut aria-hidden />
      {label}
    </Button>
  );
};

export { SignOutButton };
