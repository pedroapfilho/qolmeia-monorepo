import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Entrando",
};

type VerifyPageProps = {
  searchParams: Promise<{ error?: string }>;
};

const VerifyPage = async ({ searchParams }: VerifyPageProps) => {
  const { error } = await searchParams;
  if (!error) {
    redirect("/");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Não conseguimos entrar</CardTitle>
        <CardDescription>
          O link mágico expirou ou já foi usado. Solicite um novo no login.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground" role="alert">
          {error}
        </p>
      </CardContent>
    </Card>
  );
};

export default VerifyPage;
