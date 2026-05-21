import "@/styles/globals.css";

import { Toaster } from "@repo/ui/components/sonner";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";

import { Providers } from "@/components/providers";

const inter = Inter({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  authors: [{ name: "Qolmeia" }],
  category: "technology",
  creator: "Qolmeia",
  description:
    "Converse com os agentes de IA da Qolmeia para criar materiais de marca, agendar campanhas e acompanhar o trabalho em tempo real.",
  icons: {
    icon: "/favicon.ico",
  },
  keywords: ["qolmeia", "chat", "ai", "clientes"],
  metadataBase: new URL(process.env.CLIENT_APP_URL ?? "https://chat.qolmeia.ai"),
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
    <html className={inter.variable} lang="pt-BR">
      <head>
        <meta content="telephone=no" name="format-detection" />
        <meta content="#000000" name="msapplication-TileColor" />
        <meta content="nosniff" httpEquiv="X-Content-Type-Options" />
        <meta content="DENY" httpEquiv="X-Frame-Options" />
      </head>
      <body className={inter.className} suppressHydrationWarning>
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
