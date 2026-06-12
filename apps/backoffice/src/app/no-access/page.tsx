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
          className="mb-1 flex size-10 items-center justify-center rounded-full bg-warning-surface text-warning-surface-foreground ring-1 ring-warning/20 [&_svg]:size-5"
        >
          <ShieldAlert />
        </div>
        <CardTitle className="text-2xl">Sem acesso ao painel</CardTitle>
        <CardDescription>
          Esta conta não tem papel de Operador (OWNER ou STAFF) nesta organização. Acesse o app do
          cliente ou peça ao dono para promover seu papel.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SignOutButton className="w-full" label="Sair desta conta" />
      </CardContent>
    </Card>
  </main>
);

export default NoAccessPage;
