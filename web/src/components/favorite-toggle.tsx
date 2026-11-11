"use client";

import { useOptimistic } from "react";
import { setAccountFeaturedAction } from "@/lib/dashboard/actions";
import { StarIcon } from "./ui";

/**
 * Ajoute un compte aux favoris ou l'en retire. L'étoile change dès le clic ; l'accueil se réordonne
 * quand le serveur a répondu (les favoris passent en premier).
 *
 * `compact` : étoile seule, pour la bannière d'un compte. Sinon, bouton libellé et phrase d'aide
 * (page Comptes).
 */
export function FavoriteToggle({
  accountId,
  accountLabel,
  favorite,
  compact = false,
}: {
  accountId: number;
  accountLabel: string;
  favorite: boolean;
  compact?: boolean;
}) {
  const [shown, setShown] = useOptimistic(favorite);
  const toggle = async (formData: FormData) => {
    setShown(formData.get("featured") === "1");
    await setAccountFeaturedAction(formData);
  };
  const title = shown ? `Retirer ${accountLabel} des favoris` : `Ajouter ${accountLabel} aux favoris`;

  return (
    <form action={toggle} className={compact ? "flex-none" : "flex flex-wrap items-center gap-x-3 gap-y-1"}>
      <input type="hidden" name="id" value={accountId} />
      <input type="hidden" name="featured" value={shown ? "0" : "1"} />
      {compact ? (
        // Nom constant et état porté par aria-pressed : « Favori, bouton bascule, enfoncé ».
        <button type="submit" className="favorite-toggle" aria-pressed={shown} aria-label={`Favori : ${accountLabel}`} title={title}>
          <StarIcon filled={shown} size={18} />
        </button>
      ) : (
        <>
          <button type="submit" className="button" data-active={shown || undefined}>
            <StarIcon filled={shown} size={15} />
            {shown ? "Retirer des favoris" : "Ajouter aux favoris"}
          </button>
          <span className="text-xs text-muted">
            {shown ? "Ses personnages passent en premier à l'accueil, sous une bannière." : "Un favori passe en premier à l'accueil, sous une bannière."}
          </span>
        </>
      )}
    </form>
  );
}
