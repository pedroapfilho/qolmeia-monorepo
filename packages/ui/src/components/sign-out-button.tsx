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

type SignOutButtonDependencies = {
  showError: (message: string) => void;
  signOut: () => Promise<void>;
  useAppRouter: () => Pick<ReturnType<typeof useRouter>, "push" | "refresh">;
};

const createSignOutButton = ({ showError, signOut, useAppRouter }: SignOutButtonDependencies) => {
  const SignOutButtonWithDependencies = ({ className, label = "Sair" }: SignOutButtonProps) => {
    const { push, refresh } = useAppRouter();
    const [pending, setPending] = useState(false);

    const handleSignOut = async () => {
      if (pending) {
        return;
      }
      setPending(true);
      try {
        await signOut();
        push("/login");
        refresh();
      } catch {
        showError("Não foi possível sair. Tente novamente.");
        setPending(false);
      }
    };

    return (
      <Button
        className={className}
        disabled={pending}
        onClick={() => {
          void handleSignOut();
        }}
        type="button"
        variant="ghost"
      >
        <LogOut aria-hidden />
        {label}
      </Button>
    );
  };

  return SignOutButtonWithDependencies;
};

const SignOutButton = createSignOutButton({
  showError: (message) => {
    toast.error(message);
  },
  signOut: async () => {
    await authClient.signOut();
  },
  useAppRouter: useRouter,
});

export { createSignOutButton, SignOutButton };
export type { SignOutButtonDependencies, SignOutButtonProps };
