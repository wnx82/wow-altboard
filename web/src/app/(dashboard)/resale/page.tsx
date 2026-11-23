import type { Metadata } from "next";
import Link from "next/link";
import { ItemName } from "@/components/economy";
import { ScrollRegion } from "@/components/scroll-region";
import { EmptyState, Money, PageHeader, SectionTitle, StatTile } from "@/components/ui";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { formatChange, formatPercent } from "@/lib/economy/view";
import { JOURNAL_SHOWN, loadResale, type ResaleCharacter, type ResaleData } from "@/lib/resale/load";
import { DEAL_KINDS, DEAL_LIVE, EVENT_LABELS, premium } from "@/lib/resale/view";
import { classKey, formatDateTime, formatInteger, formatRelative } from "@/lib/wow/format";

export const metadata: Metadata = { title: "Revente" };

/** Affaires montrées par marché : les mieux classées par l'addon. */
const DEALS_SHOWN = 25;

export default async function ResalePage() {
  await requireSession();
  const data = await loadResale(getDatabase(), new Date());
  const empty = data.portfolios.length === 0 && data.deals.length === 0;

  return (
    <>
      <PageHeader art="dusk" section="economy" title="Revente">
        Le portefeuille de l&apos;addon EZAuctioneer : objets achetés pour être revendus, mises en vente, ventes et invendus, personnage par
        personnage. Gains réalisés tels que l&apos;addon les compte, commission et dépôts perdus déduits ; stock estimé au prix du marché du
        site.
      </PageHeader>

      {empty ? (
        <div className="mt-6">
          <EmptyState title="Aucun portefeuille reçu" action={{ href: "/machines#instructions", label: "Instructions de synchronisation" }}>
            Le portefeuille et les affaires d&apos;EZAuctioneer arrivent avec l&apos;agent 0.11.0 : achetez un objet repéré par l&apos;addon,
            /reload ou déconnectez-vous, puis lancez l&apos;agent.
          </EmptyState>
        </div>
      ) : (
        <>
          <Overview data={data} />
          {data.positions.length > 0 && <Positions data={data} />}
          {data.auctions.length > 0 && <Auctions data={data} />}
          {data.items.length > 0 && <ItemResults data={data} />}
          {data.portfolios.length > 0 && <Portfolios data={data} />}
          {data.journal.length > 0 && <Journal data={data} />}
          {data.deals.map((list) => (
            <Deals key={list.scanMarketId} list={list} names={data.names} />
          ))}
        </>
      )}
    </>
  );
}

function Overview({ data }: { data: ResaleData }) {
  const { totals } = data;
  return (
    <section aria-label="Vue générale" className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
      <StatTile
        label="Gain réalisé"
        value={<Money copper={totals.realizedCopper} />}
        hint={`${formatInteger(totals.sales)} vente${totals.sales > 1 ? "s" : ""} · commission ${formatInteger(Math.round(totals.cutsCopper / 10_000))} po`}
      />
      <StatTile label="Capital engagé" value={<Money copper={totals.invested} />} hint={`${formatInteger(data.positions.length)} position${data.positions.length > 1 ? "s" : ""} en stock`} />
      <StatTile
        label="Valeur du stock"
        value={totals.priced === 0 ? "—" : <Money copper={totals.value} />}
        hint={totals.priced === 0 ? "aucun prix de marché" : `au prix du marché ${data.market?.label ?? ""}, ${totals.priced} sur ${data.positions.length}`}
      />
      <StatTile
        label="Plus-value latente"
        value={totals.priced === 0 ? "—" : <Money copper={totals.unrealized} />}
        hint={`vendu à ce prix, commission de ${formatPercent(data.auctionCut)} déduite ; invendus ${formatInteger(totals.expired)}, issues inconnues ${formatInteger(totals.unknownOutcomes)}`}
      />
    </section>
  );
}

function Owner({ owner }: { owner: ResaleCharacter }) {
  return owner.characterId === null ? (
    <span className="text-muted">{owner.name}</span>
  ) : (
    <span data-class={classKey(owner.className)}>
      <Link href={`/characters/${owner.characterId}`} prefetch={false} className="class-text font-semibold hover:underline">
        {owner.name}
      </Link>
    </span>
  );
}

function Positions({ data }: { data: ResaleData }) {
  return (
    <section aria-label="Positions" className="mt-8">
      <SectionTitle aside="objets achetés pour la revente, encore détenus">Positions</SectionTitle>
      <ScrollRegion className="panel overflow-x-auto" label="Positions">
        <table className="data-table min-w-[880px]">
          <caption className="sr-only">Positions</caption>
          <thead>
            <tr>
              <th scope="col">Objet</th>
              <th scope="col">Personnage</th>
              <th scope="col" className="num">
                Quantité
              </th>
              <th scope="col" className="num">
                Coût moyen
              </th>
              <th scope="col" className="num">
                Prix du marché
              </th>
              <th scope="col" className="num">
                Plus-value latente
              </th>
              <th scope="col">Depuis</th>
            </tr>
          </thead>
          <tbody>
            {data.positions.map((position, index) => {
              const latent = position.unitValue === null ? null : Math.round(position.unitValue * position.quantity * (1 - data.auctionCut) - position.costCopper);
              return (
                <tr key={`${position.itemKey}-${position.name}-${index}`}>
                  <th scope="row">
                    <ItemName itemKey={position.itemKey} names={data.names} />
                  </th>
                  <td>
                    <Owner owner={position} />
                  </td>
                  <td className="num">
                    {formatInteger(position.quantity)}
                    {position.listed > 0 && <span className="ml-1 text-xs text-faint">({formatInteger(position.listed)} en vente)</span>}
                  </td>
                  <td className="num">
                    <Money copper={position.quantity > 0 ? Math.round(position.costCopper / position.quantity) : null} />
                  </td>
                  <td className="num">
                    <Money copper={position.unitValue} />
                  </td>
                  <td className="num">
                    <Money copper={latent} />
                  </td>
                  <td className="text-xs text-muted">{position.openedAt ? formatRelative(position.openedAt) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollRegion>
      <p className="mt-3 text-xs text-faint">
        Coût moyen : prix payé, divisé par les unités encore détenues. Prix du marché : médiane des plus bas journaliers sur 14 jours. Plus-value
        latente : ce que rapporterait la vente de tout le stock à ce prix, commission déduite, moins le coût.
      </p>
    </section>
  );
}

function Auctions({ data }: { data: ResaleData }) {
  return (
    <section aria-label="Annonces en cours" className="mt-8">
      <SectionTitle aside="suivies par l'addon jusqu'à la vente ou l'invendu">Annonces en cours</SectionTitle>
      <ScrollRegion className="panel overflow-x-auto" label="Annonces en cours">
        <table className="data-table min-w-[820px]">
          <caption className="sr-only">Annonces en cours</caption>
          <thead>
            <tr>
              <th scope="col">Objet</th>
              <th scope="col">Personnage</th>
              <th scope="col" className="num">
                Quantité
              </th>
              <th scope="col" className="num">
                Prix demandé
              </th>
              <th scope="col" className="num">
                Écart au marché
              </th>
              <th scope="col" className="num">
                Dépôt
              </th>
              <th scope="col">Mise en vente</th>
            </tr>
          </thead>
          <tbody>
            {data.auctions.map((auction, index) => {
              const gap = premium(auction.unitCopper, auction.unitValue);
              return (
                <tr key={`${auction.itemKey}-${index}`}>
                  <th scope="row">
                    <ItemName itemKey={auction.itemKey} names={data.names} />
                  </th>
                  <td>
                    <Owner owner={auction} />
                  </td>
                  <td className="num">{formatInteger(auction.quantity)}</td>
                  <td className="num">
                    <Money copper={auction.unitCopper} />
                  </td>
                  <td className="num">{formatChange(gap)}</td>
                  <td className="num">
                    <Money copper={auction.depositCopper} />
                  </td>
                  <td className="text-xs text-muted">{auction.postedAt ? formatDateTime(auction.postedAt) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollRegion>
    </section>
  );
}

function ItemResults({ data }: { data: ResaleData }) {
  return (
    <section aria-label="Résultat par objet" className="mt-8">
      <SectionTitle aside="d'après le journal reçu, meilleur résultat d'abord">Résultat par objet</SectionTitle>
      <ScrollRegion className="panel overflow-x-auto" label="Résultat par objet">
        <table className="data-table min-w-[900px]">
          <caption className="sr-only">Résultat par objet</caption>
          <thead>
            <tr>
              <th scope="col">Objet</th>
              <th scope="col" className="num">
                Achetés
              </th>
              <th scope="col" className="num">
                Dépensé
              </th>
              <th scope="col" className="num">
                Vendus
              </th>
              <th scope="col" className="num">
                Produit des ventes
              </th>
              <th scope="col" className="num">
                Commission
              </th>
              <th scope="col" className="num">
                Dépôts perdus
              </th>
              <th scope="col" className="num">
                Gain
              </th>
              <th scope="col" className="num">
                Rendement
              </th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item) => {
              const net = item.gainCopper - item.depositsLostCopper;
              return (
                <tr key={item.itemKey}>
                  <th scope="row">
                    <ItemName itemKey={item.itemKey} names={data.names} />
                  </th>
                  <td className="num">{formatInteger(item.boughtUnits)}</td>
                  <td className="num">
                    <Money copper={item.spentCopper} />
                  </td>
                  <td className="num">{formatInteger(item.soldUnits)}</td>
                  <td className="num">
                    <Money copper={item.grossCopper} />
                  </td>
                  <td className="num">
                    <Money copper={item.feesCopper} />
                  </td>
                  <td className="num">
                    <Money copper={item.depositsLostCopper} />
                  </td>
                  <td className="num">
                    <Money copper={net} />
                  </td>
                  <td className="num">{formatChange(item.roi)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollRegion>
      <p className="mt-3 text-xs text-faint">
        Gain : produit des ventes moins la commission et le coût d&apos;achat des unités vendues (calculé par l&apos;addon), moins les dépôts
        perdus des invendus. Rendement : ce gain rapporté au coût d&apos;achat des unités vendues. L&apos;addon ne garde que ses 200 dernières
        opérations par personnage ; le site les accumule depuis l&apos;agent 0.11.0.
      </p>
    </section>
  );
}

function Portfolios({ data }: { data: ResaleData }) {
  return (
    <section aria-label="Personnages" className="mt-8">
      <SectionTitle aside="bilan cumulé de l'addon, par personnage et par PC">Personnages</SectionTitle>
      <ScrollRegion className="panel overflow-x-auto" label="Bilan par personnage">
        <table className="data-table min-w-[900px]">
          <caption className="sr-only">Bilan par personnage</caption>
          <thead>
            <tr>
              <th scope="col">Personnage</th>
              <th scope="col">Compte</th>
              <th scope="col">PC</th>
              <th scope="col" className="num">
                Gain réalisé
              </th>
              <th scope="col" className="num">
                Ventes
              </th>
              <th scope="col" className="num">
                Commission
              </th>
              <th scope="col" className="num">
                Invendus
              </th>
              <th scope="col" className="num">
                Dépôts perdus
              </th>
              <th scope="col" className="num">
                Issues inconnues
              </th>
              <th scope="col" className="num">
                Positions
              </th>
            </tr>
          </thead>
          <tbody>
            {data.portfolios.map((portfolio) => (
              <tr key={portfolio.id}>
                <th scope="row">
                  <Owner owner={portfolio} />
                  {portfolio.realm && <span className="ml-2 text-xs text-faint">{portfolio.realm}</span>}
                </th>
                <td className="text-muted">{portfolio.account}</td>
                <td className="text-muted">{portfolio.machine}</td>
                <td className="num">
                  <Money copper={portfolio.realizedCopper} />
                </td>
                <td className="num">{formatInteger(portfolio.sales)}</td>
                <td className="num">
                  <Money copper={portfolio.cutsCopper} />
                </td>
                <td className="num">{formatInteger(portfolio.expired)}</td>
                <td className="num">
                  <Money copper={portfolio.depositsLostCopper} />
                </td>
                <td className="num">{formatInteger(portfolio.unknownOutcomes)}</td>
                <td className="num">{formatInteger(portfolio.positions)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
      <p className="mt-3 text-xs text-faint">
        Issue inconnue : une annonce disparue sans notification (fin pendant que le personnage était déconnecté) ; l&apos;addon ne sait pas si
        elle a été vendue, son dépôt n&apos;est pas compté. Royaume : le nom que donne le jeu, vide quand l&apos;addon ne le connaissait pas. Le
        fichier de l&apos;addon est propre à chaque PC : un personnage joué sur deux PC a deux portefeuilles.
      </p>
    </section>
  );
}

function Journal({ data }: { data: ResaleData }) {
  return (
    <section aria-label="Journal" className="mt-8">
      <SectionTitle aside={data.journalTotal > JOURNAL_SHOWN ? `${JOURNAL_SHOWN} dernières sur ${formatInteger(data.journalTotal)}` : `${formatInteger(data.journalTotal)} opérations`}>
        Journal
      </SectionTitle>
      <ScrollRegion className="panel overflow-x-auto" label="Journal">
        <table className="data-table min-w-[860px]">
          <caption className="sr-only">Journal des opérations</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Opération</th>
              <th scope="col">Objet</th>
              <th scope="col">Personnage</th>
              <th scope="col" className="num">
                Quantité
              </th>
              <th scope="col" className="num">
                Montant
              </th>
              <th scope="col" className="num">
                Gain
              </th>
            </tr>
          </thead>
          <tbody>
            {data.journal.map((entry, index) => (
              <tr key={`${entry.occurredAt.getTime()}-${index}`}>
                <td className="whitespace-nowrap text-xs text-muted">{formatDateTime(entry.occurredAt)}</td>
                <td>
                  <span className="badge" data-tone={entry.kind === "sale" ? "ok" : entry.kind === "expire" || entry.kind === "cancel" ? "warn" : undefined}>
                    {EVENT_LABELS[entry.kind] ?? entry.kind}
                  </span>
                </td>
                <th scope="row">
                  <ItemName itemKey={entry.itemKey} names={data.names} />
                </th>
                <td>
                  <Owner owner={entry} />
                </td>
                <td className="num">{formatInteger(entry.quantity)}</td>
                <td className="num">
                  <Money copper={entry.amountCopper ?? (entry.unitCopper === null ? entry.depositCopper : entry.unitCopper * entry.quantity)} />
                </td>
                <td className="num">
                  <Money copper={entry.gainCopper} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
      <p className="mt-3 text-xs text-faint">
        Montant : prix payé (achat), produit de la vente avant commission (vente), prix demandé (mise en vente) ou dépôt perdu (invendu,
        annulation).
      </p>
    </section>
  );
}

function Deals({ list, names }: { list: ResaleData["deals"][number]; names: ResaleData["names"] }) {
  const shown = list.entries.slice(0, DEALS_SHOWN);
  return (
    <section aria-label={`Affaires repérées : ${list.label}`} className="mt-8">
      <SectionTitle aside={list.capturedAt ? `scan du ${formatDateTime(list.capturedAt)}` : undefined}>Affaires repérées en jeu</SectionTitle>
      <p className="mb-3 text-sm text-muted">
        {list.label} : le classement d&apos;EZAuctioneer au dernier scan, {shown.length < list.entries.length ? `${shown.length} premières sur ${list.entries.length}` : `${list.entries.length} affaires`}.
      </p>
      <ScrollRegion className="panel overflow-x-auto" label={`Affaires repérées : ${list.label}`}>
        <table className="data-table min-w-[900px]">
          <caption className="sr-only">Affaires repérées : {list.label}</caption>
          <thead>
            <tr>
              <th scope="col" className="num">
                Rang
              </th>
              <th scope="col">Objet</th>
              <th scope="col">Revendre</th>
              <th scope="col" className="num">
                Quantité
              </th>
              <th scope="col" className="num">
                Coût
              </th>
              <th scope="col" className="num">
                Revente à l&apos;unité
              </th>
              <th scope="col" className="num">
                Profit estimé
              </th>
              <th scope="col" className="num">
                Rendement
              </th>
              <th scope="col">État</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((deal) => (
              <tr key={deal.rank}>
                <td className="num text-muted">{deal.rank}</td>
                <th scope="row">
                  <ItemName itemKey={deal.itemKey} names={names} />
                </th>
                <td>
                  {DEAL_KINDS[deal.kind] ?? deal.kind}
                  {deal.thin && <span className="ml-2 text-xs text-faint">peu d&apos;offres</span>}
                </td>
                <td className="num">{formatInteger(deal.quantity)}</td>
                <td className="num">
                  <Money copper={deal.costCopper} />
                </td>
                <td className="num">
                  <Money copper={deal.resaleCopper} />
                </td>
                <td className="num">
                  <Money copper={deal.profitCopper} />
                </td>
                <td className="num">{formatChange(deal.roi)}</td>
                <td className="text-xs text-muted">{deal.live ? DEAL_LIVE[deal.live] ?? deal.live : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
      <p className="mt-3 text-xs text-faint">
        Calculs de l&apos;addon en jeu, repris tels quels : coût d&apos;achat des lots, revente visée, profit après commission et réserve de
        risque. État : l&apos;annonce vue en vente, partie depuis, ou en cours de vérification au dernier contrôle.
      </p>
    </section>
  );
}
