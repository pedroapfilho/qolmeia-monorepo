import type { Metadata } from "next";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Entrar",
};

const LoginPage = () => <LoginForm />;

export default LoginPage;
