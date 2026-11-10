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
export function Meter({ value, max, label, tone }: { value: number | null; max: number | null; label: string; tone?: "gold" }) {
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

export function StatTile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="panel px-4 py-4 sm:px-5">
      <div className="eyebrow">{label}</div>
      <div className="mt-1.5 text-xl font-semibold tabular-nums leading-tight sm:text-2xl">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <h2 className="display text-lg font-bold text-gold">{children}</h2>
      {aside && <div className="text-xs text-muted">{aside}</div>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="panel px-6 py-10 text-center">
      <p className="display text-lg font-bold text-gold">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-xl text-sm text-muted">{children}</div>}
    </div>
  );
}
