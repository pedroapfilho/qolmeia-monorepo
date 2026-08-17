import "@/styles/globals.css";

import { Toaster } from "@repo/ui/components/sonner";
import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, JetBrains_Mono, Sora } from "next/font/google";
import type { ReactNode } from "react";

import { Providers } from "@/components/providers";

const hanken = Hanken_Grotesk({ display: "swap", subsets: ["latin"], variable: "--font-hanken" });
const sora = Sora({ display: "swap", subsets: ["latin"], variable: "--font-sora" });
const jetbrainsMono = JetBrains_Mono({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-jetbrains",
});

export const metadata: Metadata = {
  authors: [{ name: "Qolmeia" }],
  category: "technology",
  creator: "Qolmeia",
  description:
    "Converse com os agentes de IA da Qolmeia para criar materiais de marca, agendar campanhas e acompanhar o trabalho em tempo real.",
  keywords: ["qolmeia", "chat", "ai", "clientes"],
  metadataBase: new URL(process.env.WEB_APP_URL ?? "https://app.qolmeia.com"),
  openGraph: {
    description: "Chat com os agentes de IA da Qolmeia.",
    locale: "pt_BR",
    siteName: "Qolmeia",
    title: "Qolmeia · Chat",
    type: "website",
  },
  publisher: "Qolmeia",
  robots: {
    follow: false,
    index: false,
  },
  title: {
    default: "Qolmeia · Chat",
    template: "%s · Qolmeia",
  },
  twitter: {
    card: "summary_large_image",
    description: "Chat com os agentes de IA da Qolmeia.",
    title: "Qolmeia · Chat",
  },
};

export const viewport: Viewport = {
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { color: "white", media: "(prefers-color-scheme: light)" },
    { color: "black", media: "(prefers-color-scheme: dark)" },
  ],
  userScalable: true,
  width: "device-width",
};

const RootLayout = ({ children }: { children: ReactNode }) => {
  return (
    <html className={`${hanken.variable} ${sora.variable} ${jetbrainsMono.variable}`} lang="pt-BR">
      <head>
        <meta content="telephone=no" name="format-detection" />
        <meta content="#000000" name="msapplication-TileColor" />
      </head>
      <body className={hanken.className} suppressHydrationWarning>
        <a
          className="sr-only fixed top-2 left-2 z-50 rounded-md bg-background px-3 py-2 text-sm font-medium text-foreground ring-1 ring-ring focus:not-sr-only"
          href="#main-content"
        >
          Pular para o conteúdo
        </a>
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
};

export default RootLayout;
