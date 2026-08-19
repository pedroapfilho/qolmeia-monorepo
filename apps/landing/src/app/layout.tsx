import "@/styles/globals.css";

import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, JetBrains_Mono, Sora } from "next/font/google";
import type { ReactNode } from "react";

import { Footer } from "@/components/footer";
import { Header } from "@/components/header";

const hanken = Hanken_Grotesk({ display: "swap", subsets: ["latin"], variable: "--font-hanken" });
const sora = Sora({ display: "swap", subsets: ["latin"], variable: "--font-sora" });
const jetbrainsMono = JetBrains_Mono({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-jetbrains",
});

const SHORT_DESCRIPTION = "Um time de IA que trabalha na conversa";
const metadataBase =
  URL.parse(process.env.NEXT_PUBLIC_LANDING_URL ?? "") ?? new URL("https://www.qolmeia.com");

export const metadata: Metadata = {
  authors: [{ name: "Qolmeia" }],
  category: "technology",
  creator: "Qolmeia",
  description:
    "A Qolmeia monta um time de agentes de IA para a sua marca. Peça na conversa, acompanhe o trabalho e aprove as entregas.",
  keywords: ["qolmeia", "agentes de ia", "marketing", "marca", "campanhas"],
  metadataBase,
  openGraph: {
    description: SHORT_DESCRIPTION,
    locale: "pt_BR",
    siteName: "Qolmeia",
    title: `Qolmeia · ${SHORT_DESCRIPTION}`,
    type: "website",
  },
  publisher: "Qolmeia",
  robots: {
    follow: true,
    googleBot: { follow: true, index: true },
    index: true,
  },
  title: {
    default: `Qolmeia · ${SHORT_DESCRIPTION}`,
    template: "%s · Qolmeia",
  },
  twitter: {
    card: "summary_large_image",
    description: SHORT_DESCRIPTION,
    title: `Qolmeia · ${SHORT_DESCRIPTION}`,
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

const RootLayout = ({ children }: { children: ReactNode }) => (
  <html
    className={`${hanken.variable} ${sora.variable} ${jetbrainsMono.variable} scroll-smooth`}
    lang="pt-BR"
  >
    <body className={`${hanken.className} flex min-h-dvh flex-col antialiased`}>
      <a
        className="sr-only fixed top-2 left-2 z-50 rounded-md bg-background px-3 py-2 text-sm font-medium text-foreground ring-1 ring-ring focus:not-sr-only"
        href="#main-content"
      >
        Pular para o conteúdo
      </a>
      <Header />
      <main className="flex-1" id="main-content">
        {children}
      </main>
      <Footer />
    </body>
  </html>
);

export default RootLayout;
