// Manifeste du site installable (écran d'accueil du téléphone). Servi par une route plutôt que par
// la convention app/manifest.ts : le site est derrière Cloudflare Access, et la balise générée par
// Next.js ne demande pas le manifeste avec les cookies. La balise est posée dans app/layout.tsx.

export const dynamic = "force-static";

export function GET(): Response {
  const base = process.env.WOW_BASE_PATH ?? "";
  const manifest = {
    name: "WoW AltBoard",
    short_name: "AltBoard",
    description: "Tous mes personnages World of Warcraft, synchronisés depuis l'addon AltBoard.",
    lang: "fr",
    start_url: `${base}/`,
    scope: `${base}/`,
    display: "standalone",
    background_color: "#070a12",
    theme_color: "#070a12",
    icons: [
      { src: `${base}/icons/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${base}/icons/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `${base}/icons/maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return new Response(JSON.stringify(manifest), { headers: { "Content-Type": "application/manifest+json; charset=utf-8" } });
}
