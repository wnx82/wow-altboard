import { PHASE_PRODUCTION_BUILD } from "next/constants";

// Appelé une fois au démarrage du serveur : lance la surveillance des serveurs de jeu
// (voir docs/SERVER-STATUS.md ; sans adresse configurée, rien ne démarre) et la mise à jour
// quotidienne des noms des objets.
export async function register() {
  // Sondes TCP et base de données : runtime Node.js seulement, jamais pendant la construction.
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) return;
  const { syncStatusRuntime } = await import("@/lib/status/runtime");
  // Sans attendre : la lecture des réglages en base ne doit pas retarder le démarrage du serveur.
  void syncStatusRuntime();
  // Noms des objets importés de wago.tools une minute après le démarrage, puis chaque jour.
  const [{ startItemNamesRuntime }, { getDatabase }] = await Promise.all([import("@/lib/economy/item-names-runtime"), import("@/db/client")]);
  startItemNamesRuntime(getDatabase);
}
