import { Card, CardDescription, CardHeader, CardTitle } from "@repo/ui/components/card";
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
        <CardTitle className="text-2xl">Sem acesso ao chat</CardTitle>
        <CardDescription>
          Esta conta não tem acesso ao chat do cliente. Acesse o painel operacional ou peça ao dono
          para criar um convite.
        </CardDescription>
      </CardHeader>
      <div className="px-6 pb-6">
        <SignOutButton className="w-full" label="Sair desta conta" />
      </div>
    </Card>
  </main>
);

export default NoAccessPage;
