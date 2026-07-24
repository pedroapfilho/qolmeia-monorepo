import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Entrando",
};

type VerifyPageProps = {
  searchParams: Promise<{ error?: string }>;
};

const VerifyContent = async ({ searchParams }: VerifyPageProps) => {
  const { error } = await searchParams;
  if (error === undefined || error === "") {
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

// Redirect-first route: the magic-link callback normally redirects home, so
// the Suspense shell is empty; cacheComponents requires a boundary above the
// search-param read.
const VerifyPage = (props: VerifyPageProps) => (
  <Suspense fallback={null}>
    <VerifyContent {...props} />
  </Suspense>
);

export default VerifyPage;
