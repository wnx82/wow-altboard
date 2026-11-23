// Préférences d'affichage de l'accueil (cartes ou tableau, comptes repliés), gardées dans des cookies
// lus au rendu serveur : la page arrive directement dans la vue choisie, sans basculer après coup.
// Un cookie illisible vaut l'absence de préférence.

export const VIEW_COOKIE = "wab_view";
export const COLLAPSED_COOKIE = "wab_collapsed";
const MAX_AGE = 365 * 24 * 3600;
const MAX_COLLAPSED = 200;

export type CharacterView = "cards" | "table";
/** null : cookie absent, la valeur par défaut s'applique. */
export type ViewPrefs = { view: CharacterView | null; collapsed: string[] | null };

export function parseView(value: string | undefined | null): CharacterView | null {
  return value === "cards" || value === "table" ? value : null;
}

/** Identifiants de comptes séparés par des virgules ; tout autre contenu est ignoré. */
export function parseCollapsed(value: string | undefined | null): string[] | null {
  if (value === undefined || value === null) return null;
  // Virgule encodée ou non (%2C) ; pas de decodeURIComponent, qui lève une exception sur un « % » isolé.
  const ids = value
    .replace(/%2C/gi, ",")
    .split(",")
    .filter((id) => /^[1-9]\d{0,14}$/.test(id));
  return [...new Set(ids)].slice(0, MAX_COLLAPSED);
}

export function readViewPrefs(get: (name: string) => string | undefined): ViewPrefs {
  return { view: parseView(get(VIEW_COOKIE)), collapsed: parseCollapsed(get(COLLAPSED_COOKIE)) };
}

/** En-tête document.cookie d'une préférence : un an, tout le site, jamais envoyée d'un autre site. */
export function prefCookie(name: string, value: string, secure: boolean): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax${secure ? "; Secure" : ""}`;
}
