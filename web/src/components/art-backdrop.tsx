import { getImageProps } from "next/image";
import { artwork, type ArtKey } from "@/lib/wow/art";

/**
 * Illustration de fond d'un bandeau, décorative (voir lib/wow/art.ts). Le parent la place et la
 * fond dans le décor par CSS. next/image est retiré comme pour GameIcon : la CSP interdit les
 * styles en ligne. `sizes` dit la largeur affichée, pour que le téléphone reçoive une petite image.
 * `eager` : image en haut de page, chargée sans attendre.
 */
export function ArtBackdrop({ art, className, sizes, eager = false }: { art: ArtKey; className: string; sizes: string; eager?: boolean }) {
  const { src, focus, tone } = artwork(art);
  const { props } = getImageProps({
    src,
    alt: "",
    fill: true,
    sizes,
    loading: eager ? "eager" : "lazy",
    fetchPriority: eager ? "high" : "auto",
  });
  // eslint-disable-next-line @next/next/no-img-element -- getImageProps fournit déjà src et srcSet optimisés
  return <img {...props} alt="" style={undefined} className={className} data-focus={focus} data-tone={tone} aria-hidden="true" />;
}
