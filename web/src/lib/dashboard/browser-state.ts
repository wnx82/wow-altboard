// État de la liste des personnages de l'accueil (recherche, filtres, tri, favoris), porté par
// l'adresse de la page : il survit à l'ouverture d'une fiche puis au retour, et se partage par lien.
// Les paramètres absents valent l'état par défaut ; une valeur illisible est ignorée.

export const SORT_KEYS = ["level", "name", "itemLevel", "money", "activity", "progress"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type Sort = { key: SortKey; descending: boolean };

export const GOAL_STATES = ["open", "done", "none"] as const;
export type GoalState = (typeof GOAL_STATES)[number];

export type Filters = {
  account: string;
  realm: string;
  classToken: string;
  race: string;
  faction: string;
  profession: string;
  machine: string;
  goals: "" | GoalState;
  minLevel: string;
  maxLevel: string;
};

export type BrowserState = { query: string; filters: Filters; sort: Sort; favoritesOnly: boolean };

export const NO_FILTERS: Filters = {
  account: "",
  realm: "",
  classToken: "",
  race: "",
  faction: "",
  profession: "",
  machine: "",
  goals: "",
  minLevel: "",
  maxLevel: "",
};

/** Sens naturel d'un tri : le nom de A à Z, le reste du plus grand au plus petit. */
export const naturalDescending = (key: SortKey) => key !== "name";

export const DEFAULT_SORT: Sort = { key: "level", descending: true };

export const DEFAULT_STATE: BrowserState = { query: "", filters: NO_FILTERS, sort: DEFAULT_SORT, favoritesOnly: false };

/** Nom du paramètre de chaque filtre, lisible dans la barre d'adresse. */
const FILTER_PARAMS: Record<keyof Filters, string> = {
  account: "compte",
  realm: "royaume",
  classToken: "classe",
  race: "race",
  faction: "faction",
  profession: "metier",
  machine: "pc",
  goals: "objectifs",
  minLevel: "niveau-min",
  maxLevel: "niveau-max",
};

const SORT_VALUES: Record<SortKey, string> = {
  level: "niveau",
  name: "nom",
  itemLevel: "niveau-objet",
  money: "or",
  activity: "activite",
  progress: "progression",
};

const PARAMS = {
  query: "q",
  sort: "tri",
  order: "ordre",
  favorites: "favoris",
} as const;

/** Paramètres lus et écrits ici ; les autres restent tels quels. */
const OWNED = [...Object.values(PARAMS), ...Object.values(FILTER_PARAMS)];

const MAX_TEXT = 100;
const ID = /^[1-9]\d{0,9}$/;
const LEVEL = /^\d{1,3}$/;

function valid(key: keyof Filters, value: string): boolean {
  switch (key) {
    case "account":
    case "machine":
      return ID.test(value);
    case "minLevel":
    case "maxLevel":
      return LEVEL.test(value);
    case "goals":
      return (GOAL_STATES as readonly string[]).includes(value);
    default:
      return value.trim() !== "" && value.length <= MAX_TEXT;
  }
}

/** État lu dans les paramètres de l'adresse. */
export function readBrowserState(params: { get(name: string): string | null }): BrowserState {
  const filters = { ...NO_FILTERS };
  for (const key of Object.keys(FILTER_PARAMS) as (keyof Filters)[]) {
    const value = params.get(FILTER_PARAMS[key]);
    if (value !== null && valid(key, value)) (filters as Record<keyof Filters, string>)[key] = value;
  }

  const sortValue = params.get(PARAMS.sort);
  const key = SORT_KEYS.find((candidate) => SORT_VALUES[candidate] === sortValue) ?? DEFAULT_SORT.key;
  const order = params.get(PARAMS.order);
  const descending = order === "decroissant" ? true : order === "croissant" ? false : naturalDescending(key);

  return {
    query: (params.get(PARAMS.query) ?? "").slice(0, MAX_TEXT),
    filters,
    sort: { key, descending },
    favoritesOnly: params.get(PARAMS.favorites) === "1",
  };
}

/**
 * Chaîne de requête (« ?… », ou vide) qui porte l'état, à partir des paramètres actuels : seuls
 * ceux de la liste changent. Les valeurs par défaut sont omises.
 */
export function writeBrowserState(state: BrowserState, current = ""): string {
  const params = new URLSearchParams(current);
  for (const name of OWNED) params.delete(name);

  if (state.query.trim() !== "") params.set(PARAMS.query, state.query);
  if (state.favoritesOnly) params.set(PARAMS.favorites, "1");
  for (const key of Object.keys(FILTER_PARAMS) as (keyof Filters)[]) {
    if (state.filters[key] !== "") params.set(FILTER_PARAMS[key], state.filters[key]);
  }
  if (state.sort.key !== DEFAULT_SORT.key) params.set(PARAMS.sort, SORT_VALUES[state.sort.key]);
  if (state.sort.descending !== naturalDescending(state.sort.key)) params.set(PARAMS.order, state.sort.descending ? "decroissant" : "croissant");

  const search = params.toString();
  return search === "" ? "" : `?${search}`;
}

/** Lien vers l'accueil filtré, depuis une autre page : « /?compte=780 », « /?metier=Couture ». */
export function homeHref(filters: Partial<Filters>): string {
  return `/${writeBrowserState({ ...DEFAULT_STATE, filters: { ...NO_FILTERS, ...filters } })}`;
}
