import { NextResponse, type NextRequest } from "next/server";
import { sessionCookieName } from "@/lib/auth/cookie";

// Deux rôles, sur chaque page :
// 1. poser une CSP stricte à nonce (aucun script ni style en ligne non signé) ;
// 2. renvoyer vers /login quand aucun cookie de session n'est présent. Ce n'est qu'un premier
//    filtre, que les requêtes de préchargement ne traversent pas (voir matcher) : la session est
//    réellement vérifiée en base par chaque page, par requireSession().

// Manifeste, icônes et service worker du site installable : le système les lit parfois sans la
// session du site (mise à jour du service worker, par exemple). Fichiers fixes, sans donnée.
const PUBLIC_PATHS = new Set(["/login", "/robots.txt", "/app.webmanifest", "/sw.js"]);

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (!PUBLIC_PATHS.has(pathname) && !request.cookies.has(sessionCookieName())) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(login);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const development = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    // En développement, le rechargement à chaud injecte des styles non signés ; un nonce présent
    // ferait ignorer 'unsafe-inline' par le navigateur, d'où deux formes distinctes.
    development ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    // Sans cette directive, celle des scripts s'appliquerait au service worker, et 'strict-dynamic'
    // y ignore 'self' : son inscription serait refusée.
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  // no-transform : Cloudflare ne réécrit plus la page. Son « Email Address Obfuscation » remplaçait
  // les adresses e-mail (noms des comptes) par « [email protected] » dans le HTML : React ne
  // retrouvait plus le texte rendu par le serveur et refaisait toute la page (erreur 418).
  response.headers.set("Cache-Control", "private, no-store, no-transform");
  return response;
}

export const config = {
  matcher: [
    {
      // Les routes d'API s'authentifient elles-mêmes ; les fichiers statiques n'ont pas de CSP.
      source: "/((?!api|_next/static|_next/image|favicon.ico|icons/|apple-icon).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
