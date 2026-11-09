// Navigation principale : dix-sept pages en trois groupes, pour que l'en-tête tienne sur une ligne
// à toutes les largeurs. Chaque groupe s'ouvre en liste déroulante ; sur téléphone, un seul bouton
// ouvre les trois groupes à la fois.

export type NavItem = { href: string; label: string };
export type NavGroup = { id: string; label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "characters",
    label: "Personnages",
    items: [
      { href: "/", label: "Personnages" },
      { href: "/goals", label: "Objectifs" },
      { href: "/items", label: "Objets" },
      { href: "/professions", label: "Métiers" },
      { href: "/reputations", label: "Réputations" },
      { href: "/levels", label: "Niveaux" },
      { href: "/playtime", label: "Temps de jeu" },
      { href: "/activity", label: "Activité" },
    ],
  },
  {
    id: "economy",
    label: "Économie",
    items: [
      { href: "/opportunities", label: "Opportunités" },
      { href: "/market", label: "Marché" },
      { href: "/crafting", label: "Craft" },
      { href: "/farming", label: "Farm" },
      { href: "/audit", label: "Audit" },
    ],
  },
  {
    id: "admin",
    label: "Gestion",
    items: [
      { href: "/accounts", label: "Comptes" },
      { href: "/machines", label: "Machines" },
      { href: "/servers", label: "Serveurs" },
      { href: "/settings", label: "Paramètres" },
    ],
  },
];

/** Un lien mène à la page en cours, ou à la page parente (la fiche d'un personnage relève de l'accueil). */
export function isActiveLink(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/" || pathname === "/characters" || pathname.startsWith("/characters/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Groupe et lien de la page en cours, ou null hors du menu. */
export function activeNav(pathname: string): { group: NavGroup; item: NavItem } | null {
  for (const group of NAV_GROUPS) {
    const item = group.items.find((candidate) => isActiveLink(candidate.href, pathname));
    if (item) return { group, item };
  }
  return null;
}
