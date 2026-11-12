// Manifeste du site installable (écran d'accueil du téléphone ; sur Android, Chrome en fait une
// application à part entière, proposée par components/app-install.tsx). Servi par une route plutôt
// que par la convention app/manifest.ts : le site est derrière Cloudflare Access, et la balise
// générée par Next.js ne demande pas le manifeste avec les cookies. La balise est posée dans
// app/layout.tsx.

export const dynamic = "force-static";

export function GET(): Response {
  const base = process.env.WOW_BASE_PATH ?? "";
  // Appui long sur l'icône de l'application : accès direct à ces pages.
  const shortcut = (name: string, path: string) => ({
    name,
    url: `${base}${path}`,
    icons: [{ src: `${base}/icons/icon-192.png`, sizes: "192x192", type: "image/png" }],
  });
  const manifest = {
    // Identité stable de l'application installée, même si start_url change un jour.
    id: `${base}/`,
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
    // Le manifeste se désigne lui-même : depuis un onglet, navigator.getInstalledRelatedApps() dit
    // alors si l'application est déjà installée (bandeau tu, aide adaptée sur la page Application).
    // prefer_related_applications reste faux : l'installation n'est pas renvoyée vers un magasin.
    related_applications: [{ platform: "webapp", url: `${base}/app.webmanifest` }],
    shortcuts: [
      shortcut("Objectifs", "/goals"),
      shortcut("Opportunités", "/opportunities"),
      shortcut("Finances", "/finances"),
      shortcut("Serveurs", "/servers"),
    ],
  };
  return new Response(JSON.stringify(manifest), { headers: { "Content-Type": "application/manifest+json; charset=utf-8" } });
}
