"use client";

import Link from "next/link";
import { use } from "react";

import { safeRedirectPath } from "@/lib/redirect-validation";

type RegisterLinkProps = {
  searchParams: Promise<{ from?: string }>;
};

const RegisterLink = ({ searchParams }: RegisterLinkProps) => {
  const { from } = use(searchParams);
  const redirectTo = safeRedirectPath(from);

  return (
    <Link
      className="font-medium text-primary underline-offset-4 hover:underline"
      href={redirectTo === "/" ? "/register" : `/register?from=${encodeURIComponent(redirectTo)}`}
    >
      Criar conta
    </Link>
  );
};

export { RegisterLink };
