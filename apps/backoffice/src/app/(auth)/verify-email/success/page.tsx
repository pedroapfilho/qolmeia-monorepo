import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import type { Metadata } from "next";

export const metadata: Metadata = {
  description: "Seu e-mail foi verificado.",
  robots: { follow: false, index: false },
  title: "E-mail verificado",
};

const VerifyEmailSuccessPage = () => (
  <Card>
    <CardHeader className="text-center">
      <CardTitle className="text-xl">E-mail verificado</CardTitle>
      <CardDescription>
        Você pode fechar esta página e voltar para a aba onde criou a conta — ela entra
        automaticamente.
      </CardDescription>
    </CardHeader>
    <CardContent className="text-center text-sm text-muted-foreground">
      Se aquela aba já foi fechada, entre pela página de login.
    </CardContent>
  </Card>
);

export default VerifyEmailSuccessPage;
