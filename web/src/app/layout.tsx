import type { Metadata, Viewport } from "next";
import { Cinzel, Inter } from "next/font/google";
import { AppInstall } from "@/components/app-install";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const cinzel = Cinzel({ variable: "--font-cinzel", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "WoW AltBoard", template: "%s · WoW AltBoard" },
  description: "Tous mes personnages World of Warcraft, synchronisés depuis l'addon AltBoard.",
  robots: { index: false, follow: false },
  // Ajouté à l'écran d'accueil d'un iPhone : plein écran, sous ce nom.
  appleWebApp: { capable: true, title: "AltBoard", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { themeColor: "#070a12" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${inter.variable} ${cinzel.variable} antialiased`}>
      <head>
        {/* Avec les cookies : sans eux, Cloudflare Access renverrait sa page de connexion au lieu du manifeste. */}
        <link rel="manifest" href={`${process.env.WOW_BASE_PATH ?? ""}/app.webmanifest`} crossOrigin="use-credentials" />
      </head>
      <body>
        {children}
        {/* Ici et non dans le tableau de bord : Chrome peut proposer l'installation dès la page de connexion. */}
        <AppInstall basePath={process.env.WOW_BASE_PATH ?? ""} />
      </body>
    </html>
  );
}
