// Illustrations officielles de World of Warcraft: Forever, tirées des annonces de Blizzard (article
// de lancement, panels « Deep Dive » et « What's Next » de la BlizzCon 2026). Elles appartiennent à
// Blizzard et ne sont pas copiées dans le dépôt : comme les icônes (voir icons.ts), le serveur les
// lit sur le CDN de Blizzard par l'optimiseur d'images de Next.js, qui les réduit et les convertit
// en WebP. Le navigateur ne contacte que ce site, et la CSP reste limitée à 'self'.

export const ART_HOST = "https://bnetcmsus-a.akamaihd.net";
export const ART_PATH = "/cms/";

/**
 * Cadrage d'une illustration dans un bandeau bien plus large que haut : la partie gardée quand
 * l'image est rognée. Correspond à un attribut data-focus de globals.css.
 */
export type ArtFocus = "top" | "center" | "bottom" | "right";

/**
 * Luminosité corrigée sous le voile sombre des bandeaux : « dark » éclaircit un paysage de nuit ou
 * de sous-bois, « bright » atténue un coucher de soleil. Attribut data-tone de globals.css.
 */
export type ArtTone = "dark" | "bright";

const ARTWORK = {
  // Peintures.
  valley: { path: "blog_header/6i/6IHESZC8SP111789292807115.png", focus: "center" },
  heroesCliff: { path: "blog_header/3l/3LTZUH2EFN4J1789293458662.png", focus: "bottom" },
  heroesVista: { path: "blog_header/7u/7UA1PXMMBZV61789247586051.png", focus: "bottom" },
  // Paysages du jeu.
  forge: { path: "content_entry_media/17QDSN2JCDVG1789247711310.png", focus: "center", tone: "dark" },
  lakeTower: { path: "content_entry_media/2w/2WRCABN8AK5Q1789247793344.jpg", focus: "center" },
  throne: { path: "content_entry_media/BIFSFIJ0UGV41789247712095.png", focus: "center", tone: "dark" },
  deepForest: { path: "content_entry_media/CB9ZES4LYT851789247719066.png", focus: "center", tone: "dark" },
  cliffCity: { path: "content_entry_media/FKR0Q5VJWV9U1789247709326.png", focus: "center", tone: "dark" },
  glade: { path: "content_entry_media/FZUNXBNP7ECE1789247715285.png", focus: "center", tone: "dark" },
  terraces: { path: "content_entry_media/HY398NET5CH61789247720286.png", focus: "center", tone: "bright" },
  road: { path: "content_entry_media/J4R9I8WZ7LGO1789247716880.png", focus: "center", tone: "dark" },
  grotto: { path: "content_entry_media/PDY6PFDLQDLA1789247713230.png", focus: "center", tone: "dark" },
  camp: { path: "content_entry_media/QDFMACEW41831789247714137.png", focus: "center", tone: "dark" },
  jungle: { path: "content_entry_media/R6A2B6E5TE7O1789247712280.png", focus: "center", tone: "dark" },
  harbor: { path: "content_entry_media/RLMTVX61QGEW1789247709428.png", focus: "bottom" },
  dusk: { path: "content_entry_media/UUIIBVJQ5URB1789247713326.png", focus: "center", tone: "bright" },
  galleons: { path: "content_entry_media/XSQGMJI0EB6O1789247709360.png", focus: "center", tone: "bright" },
  ossuary: { path: "content_entry_media/ZVK4D7TS961R1789247717638.png", focus: "center", tone: "dark" },
  mistwood: { path: "content_entry_media/e6/E6M8FPNN5PIW1789249925638.png", focus: "center", tone: "dark" },
  twilightGrove: { path: "content_entry_media/fo/FOU74XKXWD931789247935672.png", focus: "center", tone: "dark" },
} satisfies Record<string, { path: string; focus: ArtFocus; tone?: ArtTone }>;

export type ArtKey = keyof typeof ARTWORK;

export function artwork(key: ArtKey): { src: string; focus: ArtFocus; tone: ArtTone | undefined } {
  const entry: { path: string; focus: ArtFocus; tone?: ArtTone } = ARTWORK[key];
  return { src: `${ART_HOST}${ART_PATH}${entry.path}`, focus: entry.focus, tone: entry.tone };
}

/** Page de connexion : la grande peinture de l'annonce. */
export const LOGIN_ART: ArtKey = "valley";

/** Podium de l'accueil, du premier au troisième. */
export const CHAMPION_ART: readonly ArtKey[] = ["heroesVista", "lakeTower", "dusk"];

/** Bannières des comptes de l'accueil, attribuées dans l'ordre des identifiants. */
const ACCOUNT_ART: readonly ArtKey[] = ["road", "terraces", "glade", "deepForest", "twilightGrove", "cliffCity"];

/** Illustration d'un compte : la même à chaque visite, et distincte pour six comptes. */
export function accountArt(accountId: number): ArtKey {
  return ACCOUNT_ART[Math.abs(accountId) % ACCOUNT_ART.length];
}
