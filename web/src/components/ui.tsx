import { getImageProps } from "next/image";
import { classKey, formatMoney, progressPercent, splitMoney } from "@/lib/wow/format";
import { classIconUrl, professionIconUrl } from "@/lib/wow/icons";

// Briques d'affichage sans état, utilisables côté serveur comme côté client.

/**
 * Icône du jeu, servie par l'optimiseur d'images (même origine). L'attribut style que pose
 * next/image est retiré : la CSP interdit les styles en ligne. Texte alternatif vide : l'icône
 * double toujours un libellé écrit, et une image indisponible ne laisse aucune trace visible.
 */
export function GameIcon({ src, size, className }: { src: string; size: number; className?: string }) {
  const { props } = getImageProps({ src, alt: "", width: size, height: size });
  // eslint-disable-next-line @next/next/no-img-element -- getImageProps fournit déjà src et srcSet optimisés
  return <img {...props} alt="" style={undefined} className={className} />;
}

export function ProfessionIcon({ skillLine, size = 20 }: { skillLine: number | null; size?: number }) {
  const src = professionIconUrl(skillLine);
  return src ? <GameIcon src={src} size={size} className="profession-icon" /> : null;
}

/**
 * Avatar : icône de classe posée sur les initiales du personnage. Classe inconnue ou image
 * indisponible : les initiales restent visibles. `level` ajoute le niveau en médaillon ; décoratif,
 * il double un niveau toujours écrit à côté.
 */
export function ClassAvatar({
  name,
  classToken,
  size = "md",
  level,
}: {
  name: string;
  classToken: string | null;
  size?: "sm" | "md" | "lg";
  level?: number | null;
}) {
  const initials = name
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => [...part][0]!.toUpperCase())
    .join("");
  const dimensions = { sm: "size-9 text-xs", md: "size-12 text-base", lg: "size-16 text-2xl" }[size];
  const icon = classIconUrl(classToken);
  const avatar = (
    <span className={`avatar ${dimensions}`} data-class={classKey(classToken)} aria-hidden="true">
      {initials}
      {icon && <GameIcon src={icon} size={{ sm: 36, md: 48, lg: 64 }[size]} />}
    </span>
  );
  if (level === null || level === undefined) return avatar;
  return (
    // Le médaillon déborde de l'avatar, qui rogne son contenu : il lui faut un cadre à part.
    <span className="relative flex-none" aria-hidden="true">
      {avatar}
      <span className="level-badge" data-size={size}>
        {level}
      </span>
    </span>
  );
}

/** Étoile d'un compte mis en avant ; creuse quand il ne l'est pas. Décorative. */
export function StarIcon({ filled = true, size = 16, className }: { filled?: boolean; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m12 2.8 2.83 5.74 6.33.92-4.58 4.46 1.08 6.3L12 17.25l-5.66 2.97 1.08-6.3-4.58-4.46 6.33-.92Z" />
    </svg>
  );
}

/** Médaille d'une place du podium (1 à 3). Décorative : le rang est toujours écrit ailleurs. */
export function RankMedal({ rank, size = "md", title }: { rank: number; size?: "sm" | "md"; title?: string }) {
  return (
    <span className="rank-medal" data-rank={rank} data-size={size} title={title} aria-hidden="true">
      {rank}
    </span>
  );
}

export function Money({ copper }: { copper: number | null }) {
  if (copper === null) return <span className="text-faint">—</span>;
  // Une perte (profit négatif) garde son signe : la valeur absolue est découpée en pièces.
  const negative = copper < 0;
  const money = splitMoney(Math.abs(copper));
  return (
    // Trop large pour sa place (tuile sur téléphone), la somme passe à la ligne entre deux pièces au lieu d'être coupée.
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5 tabular-nums" title={`${negative ? "−" : ""}${formatMoney(Math.abs(copper))}`}>
      {negative && <span className="text-danger">−</span>}
      {money.gold > 0 && (
        <span className="coin-gold font-semibold">
          {new Intl.NumberFormat("fr-FR").format(money.gold)}
          <span className="ml-0.5 text-[0.7em] font-medium opacity-80">po</span>
        </span>
      )}
      {(money.gold > 0 || money.silver > 0) && (
        <span className="coin-silver">
          {money.silver}
          <span className="ml-0.5 text-[0.7em] opacity-80">pa</span>
        </span>
      )}
      <span className="coin-copper">
        {money.copper}
        <span className="ml-0.5 text-[0.7em] opacity-80">pc</span>
      </span>
    </span>
  );
}

/** Barre de progression. Rien n'est affiché quand la progression n'est pas calculable. */
export function Meter({ value, max, label, tone }: { value: number | null; max: number | null; label: string; tone?: "gold" | "income" | "expense" }) {
  const percent = progressPercent(value, max);
  if (percent === null) return null;
  return <progress className="meter" value={percent} max={100} aria-label={`${label} : ${percent} %`} data-tone={tone} />;
}

export function FactionBadge({ faction }: { faction: string | null }) {
  if (!faction) return null;
  return (
    <span className="badge" data-faction={faction}>
      {faction}
    </span>
  );
}

/** Chiffre clé : libellé, valeur, précision. Un liseré doré en tête ; tone colore la valeur. */
export function StatTile({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "ok" | "warn" | "danger" }) {
  return (
    <div className="panel stat-tile px-4 py-4 sm:px-5" data-tone={tone}>
      <div className="eyebrow">{label}</div>
      <div className="stat-value mt-2 text-xl font-semibold tabular-nums leading-tight sm:text-[1.6rem]">{value}</div>
      {hint && <div className="mt-1.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

/** Titre de section : le titre, un filet doré qui s'efface, puis la précision à droite. */
export function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
      <h2 className="display text-lg font-bold text-gold">{children}</h2>
      <span className="section-rule" aria-hidden="true" />
      {aside && <div className="text-xs text-muted">{aside}</div>}
    </div>
  );
}

/** Rien à montrer : un sceau, le titre, puis ce qu'il faut faire pour que des données arrivent. */
export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="panel empty-state px-6 py-12 text-center">
      <span className="empty-sigil" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
          <path d="M12 2.5 21.5 12 12 21.5 2.5 12Z" />
          <path d="M12 7.5 16.5 12 12 16.5 7.5 12Z" />
        </svg>
      </span>
      <p className="display mt-4 text-lg font-bold text-gold">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-muted">{children}</div>}
    </div>
  );
}

export type PageSection = "characters" | "economy" | "admin";

const SECTION_LABELS: Record<PageSection, string> = { characters: "Personnages", economy: "Économie", admin: "Gestion" };

/** Emblème d'une rubrique du menu : casque, pièces, engrenage. Décoratif. */
function SectionIcon({ section }: { section: PageSection }) {
  const paths: Record<PageSection, React.ReactNode> = {
    characters: (
      <>
        <path d="M12 3c-4 0-7 3-7 7.5V15l2 2h2.5l1-3h3l1 3H17l2-2v-4.5C19 6 16 3 12 3Z" />
        <path d="M9 10h6" />
        <path d="M12 3v4" />
      </>
    ),
    economy: (
      <>
        <ellipse cx="9" cy="7" rx="5.5" ry="2.5" />
        <path d="M3.5 7v4c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5V7" />
        <path d="M9.5 15.4v1.1c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5v-4c0-1.4-2.5-2.5-5.5-2.5" />
      </>
    ),
    admin: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[section]}
    </svg>
  );
}

/**
 * En-tête de page : emblème de la rubrique, rubrique, titre et présentation, actions à droite. Un
 * halo doré derrière le titre, un filet doré dessous. eyebrow remplace le nom de la rubrique.
 */
export function PageHeader({
  section,
  title,
  eyebrow,
  actions,
  children,
}: {
  section: PageSection;
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="page-hero mb-2">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="page-sigil hidden sm:grid" aria-hidden="true">
            <SectionIcon section={section} />
          </span>
          <div className="min-w-0">
            <p className="page-eyebrow">{eyebrow ?? SECTION_LABELS[section]}</p>
            <h1 className="display mt-1 break-words text-3xl font-bold leading-tight sm:text-[2.4rem]">{title}</h1>
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-4 max-w-3xl text-sm leading-relaxed text-muted">{children}</div>}
    </header>
  );
}
