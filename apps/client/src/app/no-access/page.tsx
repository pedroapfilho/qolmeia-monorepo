import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { ShieldAlert } from "lucide-react";
import type { Metadata } from "next";

import { SignOutButton } from "@/components/sign-out-button";

export const metadata: Metadata = {
  title: "Sem acesso",
};

const NoAccessPage = () => (
  <main
    className="flex min-h-screen items-center justify-center bg-background px-4 py-12"
    id="main-content"
  >
    <Card className="w-full max-w-md">
      <CardHeader>
        <div
          aria-hidden
          className="mb-1 flex size-10 items-center justify-center rounded-full bg-amber-50 text-amber-700 ring-1 ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-400/20 [&_svg]:size-5"
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
  </main>
);

export default NoAccessPage;
