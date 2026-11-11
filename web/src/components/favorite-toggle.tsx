"use client";

import { unstable_rethrow } from "next/navigation";
import { useOptimistic, useState } from "react";
import { setAccountFeaturedAction } from "@/lib/dashboard/actions";
import { StarIcon } from "./ui";

/**
 * Ajoute un compte aux favoris ou l'en retire. L'étoile change dès le clic ; l'accueil se réordonne
 * quand le serveur a répondu (les favoris passent en premier). En cas d'échec, l'étoile reprend son
 * état et un message court le dit, sans quitter la page.
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
  const [error, setError] = useState<string | null>(null);
  const toggle = async (formData: FormData) => {
    setError(null);
    setShown(formData.get("featured") === "1");
    try {
      const result = await setAccountFeaturedAction(formData);
      if (result.error) setError(result.error);
    } catch (thrown) {
      // Session expirée : la redirection vers la connexion passe par une exception de Next.js.
      unstable_rethrow(thrown);
      setError("Serveur injoignable. Réessayez.");
    }
  };
  const title = shown ? `Retirer ${accountLabel} des favoris` : `Ajouter ${accountLabel} aux favoris`;
  const message = error && (
    <span role="alert" className="text-xs text-danger">
      {error}
    </span>
  );

  return (
    <form action={toggle} className={compact ? "flex flex-none items-center gap-1.5" : "flex flex-wrap items-center gap-x-3 gap-y-1"}>
      <input type="hidden" name="id" value={accountId} />
      <input type="hidden" name="featured" value={shown ? "0" : "1"} />
      {compact ? (
        <>
          {/* Nom constant et état porté par aria-pressed : « Favori, bouton bascule, enfoncé ». */}
          <button type="submit" className="favorite-toggle" aria-pressed={shown} aria-label={`Favori : ${accountLabel}`} title={title}>
            <StarIcon filled={shown} size={18} />
          </button>
          {message}
        </>
      ) : (
        <>
          <button type="submit" className="button" data-active={shown || undefined}>
            <StarIcon filled={shown} size={15} />
            {shown ? "Retirer des favoris" : "Ajouter aux favoris"}
          </button>
          {message || (
            <span className="text-xs text-muted">
              {shown ? "Ses personnages passent en premier à l'accueil, sous une bannière." : "Un favori passe en premier à l'accueil, sous une bannière."}
            </span>
          )}
        </>
      )}
    </form>
  );
}
