import type { Metadata } from "next";
import { Cinzel, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const cinzel = Cinzel({ variable: "--font-cinzel", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "WoW AltBoard", template: "%s · WoW AltBoard" },
  description: "Tous mes personnages World of Warcraft, synchronisés depuis l'addon AltBoard.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${inter.variable} ${cinzel.variable} antialiased`}>
      <body>{children}</body>
    </html>
  );
}
