import type { Metadata } from "next";

import PendingScreen from "./pending-screen";

export const metadata: Metadata = {
  description: "Enviamos um e-mail de verificação para você.",
  robots: { follow: false, index: false },
  title: "Verifique seu e-mail",
};

type SearchParams = Promise<{ k?: string }>;

const VerifyEmailPage = async ({ searchParams }: { searchParams: SearchParams }) => {
  const { k } = await searchParams;
  return <PendingScreen token={k ?? null} />;
};

export default VerifyEmailPage;
