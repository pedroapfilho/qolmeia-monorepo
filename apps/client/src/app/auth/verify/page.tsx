"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

// Better Auth's magic-link verify endpoint sets the session cookie on
// the API side then redirects the browser here. By the time we hit this
// page the cookie is already on disk — we just bounce to "/" so the user
// lands in the chat.
//
// If Better Auth appends ?error=... (token expired, etc.), we show it
// instead of silently looping back to /login.
const VerifyClient = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const errorParam = searchParams.get("error");

  useEffect(() => {
    if (errorParam) {
      return;
    }
    router.push("/");
    router.refresh();
  }, [errorParam, router]);

  if (errorParam) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Não conseguimos entrar</CardTitle>
          <CardDescription>
            O link mágico expirou ou já foi usado. Solicite um novo no login.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Entrando...</CardTitle>
        <CardDescription>Aguarde um instante.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">Você será redirecionado em segundos.</p>
      </CardContent>
    </Card>
  );
};

const VerifyPage = () => (
  <Suspense fallback={null}>
    <VerifyClient />
  </Suspense>
);

export default VerifyPage;
