"use client";

import { Button } from "@repo/ui/components/button";

const ClientError = ({ reset }: { error: Error & { digest?: string }; reset: () => void }) => (
  <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center">
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold text-foreground">Não foi possível conectar ao chat</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        O serviço de autenticação pode ter ficado indisponível por um instante. Tente novamente em
        instantes.
      </p>
    </div>
    <Button onClick={() => reset()}>Tentar novamente</Button>
  </main>
);

export default ClientError;
