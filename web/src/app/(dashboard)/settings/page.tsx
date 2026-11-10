import type { Metadata } from "next";
import { EconomySettingsForm, ItemNamesImportForm } from "@/components/economy-forms";
import { ResetCharactersForm, StatusSettingsForm } from "@/components/settings-forms";
import { SectionTitle } from "@/components/ui";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { todayInBrussels } from "@/lib/economy/days";
import { importItemNamesAction, saveEconomySettingsAction } from "@/lib/economy/actions";
import { catalogSummary } from "@/lib/economy/item-names";
import { resetCharactersAction, saveStatusSettingsAction } from "@/lib/settings/actions";
import { characterSummary } from "@/lib/settings/reset";
import { readSettings } from "@/lib/settings/store";
import { DEFAULT_LABEL, formatTarget, MAX_LABEL_LENGTH, MAX_TARGETS, type ServiceKey } from "@/lib/status/config";
import { syncStatusRuntime } from "@/lib/status/runtime";
import { formatDateTime, formatInteger } from "@/lib/wow/format";

export const metadata: Metadata = { title: "Paramètres" };

export default async function SettingsPage() {
  await requireSession();
  const db = getDatabase();
  const [{ config }, settings, summary, catalog] = await Promise.all([syncStatusRuntime(), readSettings(db), characterSummary(db), catalogSummary(db)]);
  const lines = (service: ServiceKey) => config.targets[service].map(formatTarget).join("\n");
  const fromSite = config.fromSite.auth || config.fromSite.game;

  return (
    <>
      <p className="eyebrow text-gold">Réglages du site</p>
      <h1 className="display mt-1 text-3xl font-bold sm:text-4xl">Paramètres</h1>
      <p className="mt-2 max-w-3xl text-sm text-muted">
        Ces réglages s&apos;appliquent aussitôt, sans redéployer le serveur. Ils sont enregistrés dans la base de données.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section aria-label="Serveurs surveillés">
          <SectionTitle aside={fromSite ? "adresses définies sur cette page" : "adresses de l'environnement du serveur"}>Serveurs surveillés</SectionTitle>
          <div className="panel p-5">
            <p className="mb-4 text-sm text-muted">
              Adresses que ce serveur sonde pour la page Serveurs : une par ligne, sous la forme{" "}
              <code className="text-text">hôte:port</code>, {MAX_TARGETS} au plus par service. Seule une adresse publique est
              acceptée. Enregistrer remplace les adresses de l&apos;environnement du serveur ; une liste vide arrête la surveillance du
              service.
            </p>
            <StatusSettingsForm
              action={saveStatusSettingsAction}
              label={settings.statusLabel}
              defaultLabel={DEFAULT_LABEL}
              authTargets={lines("auth")}
              gameTargets={lines("game")}
              maxLabelLength={MAX_LABEL_LENGTH}
              fromSite={fromSite}
            />
          </div>
        </section>

        <section aria-label="Réinitialisation des personnages">
          <SectionTitle aside="suppression définitive">Réinitialisation des personnages</SectionTitle>
          <div className="panel p-5">
            <p className="text-sm text-muted">
              À la sortie officielle, les personnages de la bêta n&apos;existent plus. La réinitialisation supprime ici les personnages
              et tout leur historique : équipement, métiers, réputations, sacs et banque, temps de jeu, sessions, instantanés. Comptes,
              machines, jetons et journal des synchronisations sont conservés.
            </p>
            <p className="mt-2 text-sm text-muted">
              Un personnage non vu en jeu depuis la date limite est ensuite ignoré, même si un PC renvoie encore son fichier. Un
              personnage joué après cette date revient à sa synchronisation suivante.
            </p>

            <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="eyebrow">Personnages</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">{summary.count}</dd>
              </div>
              <div>
                <dt className="eyebrow">Vus en jeu</dt>
                <dd className="mt-0.5">
                  {summary.oldestSeenAt && summary.newestSeenAt ? (
                    <>
                      du {formatDateTime(summary.oldestSeenAt)}
                      <br />
                      au {formatDateTime(summary.newestSeenAt)}
                    </>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt className="eyebrow">Date limite en vigueur</dt>
                <dd className="mt-0.5">
                  {settings.charactersCutoffAt ? (
                    <>
                      {formatDateTime(settings.charactersCutoffAt)}
                      <span className="block text-xs text-faint">réinitialisation du {formatDateTime(settings.charactersResetAt)}</span>
                    </>
                  ) : (
                    "aucune"
                  )}
                </dd>
              </div>
            </dl>

            <div className="mt-5 border-t border-line pt-4">
              <ResetCharactersForm action={resetCharactersAction} />
            </div>
          </div>
        </section>

        <section aria-label="Moteur économique">
          <SectionTitle aside="pages Marché, Craft, Farm et Opportunités">Moteur économique</SectionTitle>
          <div className="panel p-5">
            <p className="mb-4 text-sm text-muted">
              Les prix de la bêta faussent médianes et tendances : le moteur ignore les relevés antérieurs au début de l&apos;historique. La
              commission de l&apos;hôtel des ventes est déduite de chaque vente estimée.
            </p>
            <EconomySettingsForm
              action={saveEconomySettingsAction}
              historyFrom={settings.marketHistoryFrom ? todayInBrussels(settings.marketHistoryFrom) : ""}
              auctionCut={settings.auctionCutPercent === null ? "" : String(settings.auctionCutPercent).replace(".", ",")}
              cutoffDay={settings.charactersCutoffAt ? todayInBrussels(settings.charactersCutoffAt) : null}
              today={todayInBrussels(new Date())}
            />
          </div>
        </section>

        <section aria-label="Noms des objets">
          <SectionTitle aside="pages Marché, Craft, Farm et Opportunités">Noms des objets</SectionTitle>
          <div className="panel p-5">
            <p className="text-sm text-muted">
              L&apos;addon ne nomme que les objets que vos personnages ont eus en main. Les autres, cités par l&apos;hôtel des ventes et les
              recettes, prennent leur nom dans la table des objets du jeu que publie wago.tools pour chaque version du client WoW Forever, en
              français. L&apos;agent 0.7.0 y ajoute les noms du cache de votre client de jeu, plus récents : ils remplacent ceux de wago.tools.
              Le nom relevé par l&apos;addon reste prioritaire.
            </p>
            <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="eyebrow">Noms importés</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">{formatInteger(catalog.wago.count)}</dd>
              </div>
              <div>
                <dt className="eyebrow">Version du jeu</dt>
                <dd className="mt-0.5 tabular-nums">{catalog.wago.build ?? "—"}</dd>
              </div>
              <div>
                <dt className="eyebrow">Dernier import</dt>
                <dd className="mt-0.5">{catalog.wago.updatedAt ? formatDateTime(catalog.wago.updatedAt) : "jamais"}</dd>
              </div>
              <div>
                <dt className="eyebrow">Cache du jeu</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">{formatInteger(catalog.client.count)}</dd>
                <dd className="text-xs text-muted">
                  {catalog.client.updatedAt ? `reçus le ${formatDateTime(catalog.client.updatedAt)}` : "aucun envoi de l'agent"}
                </dd>
              </div>
            </dl>
            <div className="mt-5 border-t border-line pt-4">
              <ItemNamesImportForm action={importItemNamesAction} imported={catalog.wago.count > 0} />
              <p className="mt-2 text-xs text-faint">
                Automatique : le serveur vérifie la version du jeu à son démarrage puis chaque jour, et importe la table à chaque nouvelle
                version. Le bouton force un import immédiat ; le serveur télécharge environ 6 Mo depuis wago.tools.
              </p>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
