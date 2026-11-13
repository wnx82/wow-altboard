// Bulle d'un objet telle que Wowhead la publie pour WoW Forever (dataEnv 16), lue en lignes
// structurées : texte et couleur seulement. Le HTML reçu n'est jamais injecté dans la page ; liens,
// styles et attributs sont abandonnés. Module pur, partagé par le serveur (lecture) et le client
// (types).

/** Couleurs du jeu : qualités (q0 médiocre … q7 héritage), jaune des titres, rouge des exigences non remplies. */
export type TooltipTone = "q0" | "q1" | "q2" | "q3" | "q4" | "q5" | "q6" | "q7" | "gold" | "red";

/** Un morceau de texte d'une couleur ; sans couleur, le blanc de la bulle. */
export type TooltipSegment = { text: string; tone?: TooltipTone };

/**
 * Une ligne de la bulle : texte (éventuellement en retrait, pour les pièces d'un ensemble), paire
 * calée à gauche et à droite (« Tête » / « Plaques », « Dégâts » / « Vitesse »), ou prix de vente.
 */
export type TooltipLine =
  | { type: "text"; segments: TooltipSegment[]; indent?: true }
  | { type: "pair"; left: TooltipSegment[]; right: TooltipSegment[] }
  | { type: "money"; copper: number };

export const MAX_LINES = 80;
const MAX_SEGMENT = 600;

type Node = { tag: string; classes: string[]; children: (Node | string)[] };

const VOID_TAGS = new Set(["br", "img", "hr", "input", "meta", "link", "wbr", "col", "source"]);
// Ajouts de Wowhead absents du jeu : où tomber l'objet et avec quelle chance.
const SKIPPED_CLASSES = new Set(["whtt-droppedby", "whtt-dropchance"]);

const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Entités HTML : nommées courantes et numériques ; une entité inconnue reste telle quelle. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function classesOf(attributes: string): string[] {
  const match = /\bclass\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attributes);
  return (match?.[2] ?? match?.[3] ?? "").split(/\s+/).filter(Boolean);
}

/** Arbre minimal, tolérant : une balise fermante sans ouvrante est ignorée, une ouvrante sans fermante est close par son parent. */
function parseTree(html: string): Node {
  const root: Node = { tag: "#root", classes: [], children: [] };
  const stack: Node[] = [root];
  const token = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|[^<]+|</g;
  for (const match of html.matchAll(token)) {
    const [whole, closing, rawTag, attributes] = match;
    const parent = stack[stack.length - 1];
    if (whole.startsWith("<!--")) continue;
    if (rawTag === undefined) {
      parent.children.push(decodeEntities(whole));
      continue;
    }
    const tag = rawTag.toLowerCase();
    if (closing) {
      const index = stack.findLastIndex((node) => node.tag === tag);
      if (index > 0) stack.length = index;
      continue;
    }
    const node: Node = { tag, classes: classesOf(attributes ?? ""), children: [] };
    parent.children.push(node);
    if (!VOID_TAGS.has(tag) && !(attributes ?? "").trim().endsWith("/")) stack.push(node);
  }
  return root;
}

/** Couleur portée par les classes de Wowhead : q (jaune), q0 à q7 (qualités), q10 (rouge). */
function toneOf(classes: readonly string[]): TooltipTone | undefined {
  for (const name of classes) {
    if (name === "q") return "gold";
    const match = /^q(\d{1,2})$/.exec(name);
    if (!match) continue;
    const level = Number(match[1]);
    if (level <= 7) return `q${level}` as TooltipTone;
    if (level === 10) return "red";
  }
  return undefined;
}

/** Morceaux mis bout à bout : espaces resserrés, morceaux voisins de même couleur fusionnés, bords rognés. */
function tidy(segments: readonly TooltipSegment[]): TooltipSegment[] {
  const merged: TooltipSegment[] = [];
  for (const segment of segments) {
    const text = segment.text.replace(/\s+/g, " ");
    if (text === "") continue;
    const last = merged.at(-1);
    if (last && last.tone === segment.tone) last.text += text;
    else merged.push({ text, ...(segment.tone ? { tone: segment.tone } : {}) });
  }
  while (merged.length > 0 && merged[0].text.trim() === "") merged.shift();
  while (merged.length > 0 && merged.at(-1)!.text.trim() === "") merged.pop();
  if (merged.length === 0) return [];
  merged[0].text = merged[0].text.trimStart();
  merged[merged.length - 1].text = merged[merged.length - 1].text.trimEnd();
  // Deux-points à la française : « Utilise: » devient « Utilise : ».
  for (const segment of merged) segment.text = segment.text.replace(/(\p{L}):(?=\s|$)/gu, "$1 :").slice(0, MAX_SEGMENT);
  return merged;
}

/** Montant d'un prix de vente : pièces d'or, d'argent et de cuivre. */
function moneyOf(node: Node): number {
  let copper = 0;
  const visit = (current: Node) => {
    for (const child of current.children) {
      if (typeof child === "string") continue;
      const amount = Number(textOf(child).replace(/\D/g, "") || "0");
      if (child.classes.includes("moneygold")) copper += amount * 10_000;
      else if (child.classes.includes("moneysilver")) copper += amount * 100;
      else if (child.classes.includes("moneycopper")) copper += amount;
      else visit(child);
    }
  };
  visit(node);
  return copper;
}

function textOf(node: Node): string {
  return node.children.map((child) => (typeof child === "string" ? child : textOf(child))).join("");
}

const isCell = (node: Node | string): node is Node => typeof node !== "string" && (node.tag === "td" || node.tag === "th");

/** Rangées d'un tableau, qu'elles soient dans un tbody ou non. */
function rowsOf(table: Node): Node[] {
  const rows: Node[] = [];
  for (const child of table.children) {
    if (typeof child === "string") continue;
    if (child.tag === "tr") rows.push(child);
    else if (child.tag === "tbody" || child.tag === "thead") rows.push(...rowsOf(child));
  }
  return rows;
}

/** Lignes d'une bulle Wowhead. Le nom de l'objet (entre `nstart` et `nend`) est omis : la bulle l'affiche déjà. */
export function parseWowheadTooltip(html: string): TooltipLine[] {
  const lines: TooltipLine[] = [];
  let current: TooltipSegment[] = [];
  let indent = false;

  const flush = () => {
    const segments = tidy(current);
    current = [];
    if (segments.length === 0 || lines.length >= MAX_LINES) return;
    lines.push({ type: "text", segments: setCount(segments), ...(indent ? { indent: true as const } : {}) });
  };

  // Texte d'une cellule, sur une seule ligne : un retour à la ligne devient une espace.
  const inline = (node: Node, tone: TooltipTone | undefined, out: TooltipSegment[]) => {
    for (const child of node.children) {
      if (typeof child === "string") out.push({ text: child, tone });
      else if (child.tag === "br") out.push({ text: " ", tone });
      else inline(child, toneOf(child.classes) ?? tone, out);
    }
  };

  const block = (node: Node, tone: TooltipTone | undefined) => {
    for (const child of node.children) {
      if (typeof child === "string") {
        current.push({ text: child, tone });
        continue;
      }
      if (child.classes.some((name) => SKIPPED_CLASSES.has(name))) continue;
      const childTone = toneOf(child.classes) ?? tone;
      switch (child.tag) {
        case "br":
          flush();
          break;
        case "table":
          flush();
          for (const row of rowsOf(child)) {
            const cells = row.children.filter(isCell);
            if (cells.length >= 2) {
              const left: TooltipSegment[] = [];
              const right: TooltipSegment[] = [];
              inline(cells[0], toneOf(cells[0].classes) ?? childTone, left);
              inline(cells[1], toneOf(cells[1].classes) ?? childTone, right);
              const pair = { left: tidy(left), right: tidy(right) };
              if ((pair.left.length > 0 || pair.right.length > 0) && lines.length < MAX_LINES) lines.push({ type: "pair", ...pair });
            } else if (cells.length === 1) {
              block(cells[0], toneOf(cells[0].classes) ?? childTone);
              flush();
            }
          }
          break;
        case "div":
        case "p":
          flush();
          if (child.classes.includes("whtt-sellprice")) {
            const copper = moneyOf(child);
            if (copper > 0 && lines.length < MAX_LINES) lines.push({ type: "money", copper });
            break;
          }
          {
            const outer = indent;
            indent = outer || child.classes.includes("indent");
            block(child, childTone);
            flush();
            indent = outer;
          }
          break;
        case "script":
        case "style":
          break;
        default:
          block(child, childTone);
      }
    }
  };

  block(parseTree(html.replace(/<!--nstart-->[\s\S]*?<!--nend-->/, "")), undefined);
  flush();
  return lines;
}

/** Titre d'un ensemble : « (0/8) » de Wowhead (pièces portées par son lecteur) devient « (8 pièces) ». */
function setCount(segments: TooltipSegment[]): TooltipSegment[] {
  const last = segments.at(-1);
  if (!last || last.tone !== "gold") return segments;
  const match = /\s*\(0\/(\d{1,2})\)$/.exec(last.text);
  if (!match) return segments;
  return [...segments.slice(0, -1), { ...last, text: `${last.text.slice(0, match.index)} (${match[1]} pièces)` }];
}

/** Fiche de l'objet sur Wowhead, version WoW Forever en français. */
export const wowheadItemUrl = (itemId: number, suffix: number | null = null) =>
  `https://www.wowhead.com/forever/fr/item=${itemId}${suffix === null ? "" : `?rand=${suffix}`}`;

/** Texte brut d'une ligne, pour les tests et l'accessibilité. */
export function lineText(line: TooltipLine): string {
  if (line.type === "money") return `Prix de vente ${line.copper}`;
  if (line.type === "pair") return `${line.left.map((segment) => segment.text).join("")} | ${line.right.map((segment) => segment.text).join("")}`;
  return line.segments.map((segment) => segment.text).join("");
}
