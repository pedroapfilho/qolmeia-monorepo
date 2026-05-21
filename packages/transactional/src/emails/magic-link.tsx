import { Heading, Link, Text } from "react-email";

import { Button } from "../components/button";
import { Divider } from "../components/divider";

import { BaseLayout } from "./base-layout";

type MagicLinkEmailProps = {
  url: string;
  userEmail: string;
  username?: string;
};

const MagicLinkEmail = ({ url, userEmail, username }: MagicLinkEmailProps) => {
  return (
    <BaseLayout
      footerText="Você está recebendo este email porque alguém solicitou acesso à sua conta Qolmeia."
      preview="Seu link de acesso à Qolmeia"
    >
      <Heading className="mt-0 mb-4 text-2xl font-semibold tracking-tight text-balance break-words text-foreground">
        Entre na Qolmeia
      </Heading>

      <Text className="m-0 mb-2 text-base text-pretty break-words text-muted-foreground">
        Olá{username ? ` ${username}` : ""},
      </Text>

      <Text className="m-0 mb-6 text-base text-pretty break-words text-muted-foreground">
        Clique no botão abaixo para entrar na sua conta Qolmeia. O link é válido por uma única vez e
        expira em 15 minutos.
      </Text>

      <div className="mb-6">
        <Button fullWidth href={url} variant="primary">
          Entrar na Qolmeia
        </Button>
      </div>

      <Divider />

      <Text className="m-0 mb-4 text-sm text-muted-foreground">
        Se você não solicitou este email, pode ignorá-lo com segurança — ninguém terá acesso à sua
        conta sem clicar no link.
      </Text>

      <Text className="m-0 mb-4 text-sm text-muted-foreground">
        <strong>Detalhes da conta</strong>
        <br />
        Email: {userEmail}
      </Text>

      <Divider spacing="sm" />

      <Text className="m-0 text-xs text-muted-foreground">
        Se o botão acima não funcionar, copie e cole este link no seu navegador:
        <br />
        <Link className="break-all text-foreground underline" href={url}>
          {url}
        </Link>
      </Text>
    </BaseLayout>
  );
};

export { MagicLinkEmail };
export default MagicLinkEmail;
