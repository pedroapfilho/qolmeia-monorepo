import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { SignOutButton } from "@repo/ui/components/sign-out-button";
import { ShieldAlert } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sem acesso",
};

/** @public Next.js app-router reads the instant segment config via the module loader */
export const instant = true;

const NoAccessPage = () => (
  <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
    <Card className="w-full max-w-md">
      <CardHeader>
        <div
          aria-hidden
          className="mb-1 flex size-10 items-center justify-center rounded-full bg-warning-surface text-warning-surface-foreground ring-1 ring-warning/20 [&_svg]:size-5"
        >
          <ShieldAlert />
        </div>
        <CardTitle className="text-2xl">Sem acesso ao chat</CardTitle>
        <CardDescription>
          Esta conta não tem acesso ao chat do cliente. Acesse o painel operacional ou peça ao dono
          para criar um convite.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SignOutButton className="w-full" label="Sair desta conta" />
      </CardContent>
    </Card>
  </div>
);

export default NoAccessPage;
