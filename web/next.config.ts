import type { NextConfig } from "next";
import { readBuildInfo } from "./src/lib/build-info.ts";

// Aujourd'hui servie à la racine d'un sous-domaine dédié. WOW_BASE_PATH (ex. "/wow") permet de la
// servir sous un préfixe sans modifier le code : liens, assets et routes d'API suivent.
const basePath = process.env.WOW_BASE_PATH || undefined;

// Versions affichées en pied de page. Le dépôt est le dossier parent, sauf dans l'image Docker où
// il est monté à part (WOW_REPO_DIR, voir Dockerfile) : le contexte de construction se limite à web/.
const build = readBuildInfo(process.cwd(), process.env.WOW_REPO_DIR || "..", new Date());

const nextConfig: NextConfig = {
  basePath,
  // Figées dans le code à la construction : l'image en service ne contient pas le dépôt.
  env: {
    WOW_SITE_VERSION: build.siteVersion ?? "",
    WOW_BUILD_COMMIT: build.commit ?? "",
    WOW_BUILD_TIME: build.builtAt,
    WOW_AGENT_VERSION: build.agentVersion ?? "",
  },
  output: "standalone",
  poweredByHeader: false,
  // La compression (brotli) est faite par le reverse proxy.
  compress: false,
  reactStrictMode: true,
  images: {
    // Seules les images des CDN officiels de Blizzard passent par l'optimiseur : icônes du jeu
    // (lib/wow/icons.ts) et illustrations de WoW Forever (lib/wow/art.ts).
    remotePatterns: [new URL("https://render.worldofwarcraft.com/eu/icons/56/**"), new URL("https://bnetcmsus-a.akamaihd.net/cms/**")],
    // Une icône ou une illustration publiée ne change jamais : cache d'un mois.
    minimumCacheTTL: 2_678_400,
    // Largeurs servies aux illustrations plein écran. Au-delà de 1920, une image assombrie en fond
    // ne gagnerait rien de visible : pas de variante 2048 ni 3840 à produire et à garder.
    deviceSizes: [640, 828, 1200, 1920],
    // Le cache vit dans un tmpfs compté dans la mémoire du conteneur (512 Mo, voir
    // deploy/proxmox/compose.yaml) : plafonné, les images les moins vues en sortent les premières.
    maximumDiskCacheSize: 64_000_000,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          // Tableau de bord privé : aucune indexation.
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
