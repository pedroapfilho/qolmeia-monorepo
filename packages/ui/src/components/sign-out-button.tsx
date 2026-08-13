"use client";

import { createBetterAuthClient } from "@repo/auth/client";
import { magicLinkClient, usernameClient } from "better-auth/client/plugins";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { toast } from "../lib/toast";

import { Button } from "./button";

const authUrl = process.env.NEXT_PUBLIC_AUTH_URL;
const authClient = createBetterAuthClient({
  baseURL: authUrl !== undefined && authUrl !== "" ? `${authUrl}/api/auth` : "",
  plugins: [usernameClient(), magicLinkClient()],
});

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
      toast.error("Não foi possível sair. Tente novamente.");
      setPending(false);
    }
  };

  return (
    <Button
      className={className}
      disabled={pending}
      onClick={() => {
        void signOut();
      }}
      type="button"
      variant="ghost"
    >
      <LogOut aria-hidden />
      {label}
    </Button>
  );
};

export { SignOutButton };
