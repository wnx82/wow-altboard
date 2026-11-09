// Génère les icônes du site installable (public/icons et src/app/apple-icon.png) à partir d'un
// dessin vectoriel : un « A » doré sur fond nuit, aux couleurs du tableau de bord. Aucune police
// n'est utilisée, le rendu est donc identique sur toutes les machines.
// Lancer depuis web/ : npx tsx scripts/generate-icons.ts
import { mkdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const GOLD = "#e3bd6a";
const INK = "#070a12";

/** `scale` réduit la lettre pour la zone sûre d'une icône « maskable » ; `rounded` arrondit le fond. */
function svg({ scale, rounded }: { scale: number; rounded: boolean }): string {
  const radius = rounded ? 104 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#18213a"/>
      <stop offset="1" stop-color="${INK}"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="${radius}" fill="url(#bg)"/>
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <circle cx="256" cy="256" r="206" fill="none" stroke="${GOLD}" stroke-opacity="0.35" stroke-width="10"/>
    <path d="M156 386 L256 122 L356 386" fill="none" stroke="${GOLD}" stroke-width="46" stroke-linejoin="miter" stroke-linecap="square"/>
    <path d="M196 300 H316" stroke="${GOLD}" stroke-width="36"/>
  </g>
</svg>`;
}

const web = process.cwd();
const icons = path.join(web, "public", "icons");
mkdirSync(icons, { recursive: true });

const outputs: { file: string; size: number; scale: number; rounded: boolean }[] = [
  { file: path.join(icons, "icon-192.png"), size: 192, scale: 1, rounded: true },
  { file: path.join(icons, "icon-512.png"), size: 512, scale: 1, rounded: true },
  // Zone sûre d'une icône maskable : cercle de 80 % ; le système découpe le fond plein.
  { file: path.join(icons, "maskable-512.png"), size: 512, scale: 0.72, rounded: false },
  // iOS arrondit lui-même les coins de l'icône d'écran d'accueil.
  { file: path.join(web, "src", "app", "apple-icon.png"), size: 180, scale: 0.86, rounded: false },
];

for (const output of outputs) {
  await sharp(Buffer.from(svg(output))).resize(output.size, output.size).png({ compressionLevel: 9 }).toFile(output.file);
  console.log(path.relative(web, output.file));
}
