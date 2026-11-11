// Service worker du site installable (application sur l'écran d'accueil du téléphone).
//
// Rien n'est mis en cache : les pages sont privées et doivent rester fraîches. Le réseau répond
// toujours ; quand il manque, une page « Hors ligne » remplace l'erreur du navigateur. Seules les
// navigations passent ici, le reste (scripts, images, API) va directement au réseau.

const OFFLINE_PAGE = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#070a12">
<title>Hors ligne · WoW AltBoard</title>
<style>
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 1.5rem; box-sizing: border-box;
         background: #070a12; color: #e8ecf5; font: 16px/1.5 system-ui, sans-serif; text-align: center; }
  h1 { margin: 0 0 0.5rem; font: 700 1.6rem Georgia, serif; letter-spacing: 0.04em; color: #e3bd6a; }
  p { margin: 0 0 1.5rem; color: #9aa5bd; }
  button { font: inherit; font-weight: 600; color: #070a12; background: #e3bd6a; border: 0; border-radius: 0.6rem; padding: 0.6rem 1.4rem; }
</style>
</head>
<body>
<main>
  <h1>Hors ligne</h1>
  <p>WoW AltBoard a besoin du réseau pour afficher vos personnages.</p>
  <button type="button" onclick="location.reload()">Réessayer</button>
</main>
</body>
</html>`;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Préchargement des navigations : la requête part pendant que le service worker démarre.
  event.waitUntil(
    (async () => {
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    (async () => {
      try {
        return (await event.preloadResponse) || (await fetch(event.request));
      } catch {
        return new Response(OFFLINE_PAGE, {
          status: 503,
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        });
      }
    })(),
  );
});
