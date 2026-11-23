import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";
import { CharacterEquipment, type EquipmentRow } from "@/components/character-equipment";
import { CharacterGoals } from "@/components/character-goals";
import { CharacterInventory, type CharacterInventoryPlace } from "@/components/character-inventory";
import { SectionNav, type SectionLink } from "@/components/section-nav";
import { SectionTitle } from "@/components/ui";
import { getDatabase } from "@/db/client";
import { describeError } from "@/lib/errors";
import { requireSession } from "@/lib/auth/session";
import { getCharacterDetail, getCharacterNeighbors, type CharacterDetail } from "@/lib/dashboard/queries";
import { catalogId, loadItemNames } from "@/lib/economy/item-names";
import { loadMarketValues } from "@/lib/economy/load";
import { isGear } from "@/lib/wow/gear";
import { loadItemSpecs } from "@/lib/wow/item-specs";
import { equippedItemKey, getEnchantText } from "@/lib/wow/item-tooltips";
import { listCharacterGoals, listTemplates } from "@/lib/goals/store";
import { classKey, formatRelative, QUALITY_LABELS } from "@/lib/wow/format";
import { CharacterHero, OverviewTiles } from "./hero";
import { HistorySection } from "./history";
import { LevelTimesSection, SessionsSection } from "./ledger";
import { CurrenciesSection, ProfessionsSection, ReputationsSection, StatsSection } from "./sections";

// L'identifiant vient de l'URL : seul un entier positif est accepté. Mis en cache le temps de la
// requête : les métadonnées et la page partagent une seule lecture.
const loadCharacter = cache(
  async (id: string): Promise<CharacterDetail | null> => (/^[1-9]\d{0,14}$/.test(id) ? getCharacterDetail(getDatabase(), Number(id)) : null),
);

async function load(params: Promise<{ id: string }>): Promise<CharacterDetail | null> {
  return loadCharacter((await params).id);
}

export async function generateMetadata({ params }: PageProps<"/characters/[id]">): Promise<Metadata> {
  // Le titre porte le nom du personnage : même contrôle que la page.
  await requireSession();
  const character = await load(params);
  return { title: character?.name ?? "Personnage introuvable" };
}

// Sommaire de la fiche : les identifiants sont ceux des titres de section, plus bas.
const SECTIONS: SectionLink[] = [
  { id: "goals", label: "Objectifs" },
  { id: "professions", label: "Métiers" },
  { id: "currencies", label: "Monnaies" },
  { id: "equipment", label: "Équipement" },
  { id: "stats", label: "Statistiques" },
  { id: "reputations", label: "Réputations" },
  { id: "inventory", label: "Inventaire" },
  { id: "level-times", label: "Temps par niveau" },
  { id: "sessions", label: "Sessions" },
  { id: "history", label: "Progression" },
];

export default async function CharacterPage({ params }: PageProps<"/characters/[id]">) {
  await requireSession();
  const character = await load(params);
  if (!character) notFound();
  const db = getDatabase();
  const now = new Date();
  const heldKeys = [...character.bags, ...character.bank, ...character.mail, ...character.auctions].map((item) => item.itemKey);
  const equipmentKeys = character.equipment.flatMap((item) => (item.itemId === null ? [] : [String(item.itemId)]));
  const [goals, templates, itemNames, values, specs, neighbors] = await Promise.all([
    listCharacterGoals(db, character.id),
    listTemplates(db),
    loadItemNames(db, [...heldKeys, ...equipmentKeys]),
    loadMarketValues(db, heldKeys, now),
    loadItemSpecs(db, [...heldKeys, ...equipmentKeys]),
    getCharacterNeighbors(db, character.id),
  ]);
  // Nom relevé par l'addon, sinon celui de la table du jeu, rangé sous l'identifiant de base.
  const slotItems = Object.fromEntries(
    [...new Set(heldKeys)].map((key) => {
      const own = itemNames.get(key);
      const id = catalogId(key);
      const base = id === null ? undefined : itemNames.get(String(id));
      const spec = specs.get(key);
      const gear = isGear(spec) ? spec : undefined;
      return [key, { name: own?.name ?? base?.name ?? null, quality: own?.quality ?? base?.quality ?? null, icon: own?.icon ?? null, ...(gear ? { gear } : {}) }];
    }),
  );
  const inventoryPlaces: CharacterInventoryPlace[] = [
    {
      place: "bags",
      seen: character.bagsAt?.toISOString() ?? null,
      never: "Sacs jamais relevés par l'addon.",
      items: character.bags.map((item) => ({ itemKey: item.itemKey, quantity: item.quantity, expiresAt: null })),
    },
    {
      place: "bank",
      seen: character.bankAt?.toISOString() ?? null,
      never: "Banque jamais relevée : l'addon ne la lit que lorsqu'elle est ouverte en jeu avec ce personnage.",
      items: character.bank.map((item) => ({ itemKey: item.itemKey, quantity: item.quantity, expiresAt: null })),
    },
    // Relevés par Baganator : absents tant que l'agent 0.8.0 n'a rien envoyé pour ce personnage.
    ...(character.holdingsAt
      ? (["mail", "auctions"] as const).map((place) => ({
          place,
          seen: character.holdingsAt!.toISOString(),
          never: "",
          items: character[place].map((item) => ({ itemKey: item.itemKey, quantity: item.quantity, expiresAt: item.expiresAt?.toISOString() ?? null })),
        }))
      : []),
  ];

  // Équipement : même bulle que les inventaires ; celle d'un objet enchanté porte son enchantement.
  const equipmentRows: EquipmentRow[] = character.equipment.map((item) => {
    const spec = item.itemId === null ? undefined : specs.get(String(item.itemId));
    const gear = isGear(spec) ? spec : undefined;
    return {
      slot: item.slot,
      tipKey: item.itemId === null ? null : equippedItemKey(item.itemId, item.enchantId),
      name: item.name ?? (item.itemId === null ? "Objet inconnu" : `Objet n° ${item.itemId}`),
      quality: item.quality,
      qualityLabel: item.quality === null ? undefined : QUALITY_LABELS[item.quality],
      icon: item.itemId === null ? null : (itemNames.get(String(item.itemId))?.icon ?? null),
      itemLevel: item.itemLevel,
      ...(gear ? { gear } : {}),
    };
  });
  // Effet de chaque enchantement : lu chez Wowhead à la première visite, il arrive après le reste de la page.
  const enchants = Object.fromEntries(
    character.equipment.flatMap((item) =>
      item.enchantId === null || item.enchantId === 0
        ? []
        : [
            [
              item.slot,
              <Suspense key={item.slot} fallback="Enchantement…">
                <EnchantEffect itemId={item.itemId} enchantId={item.enchantId} />
              </Suspense>,
            ],
          ],
    ),
  );

  return (
    <div data-class={classKey(character.class)}>
      <CharacterHero character={character} neighbors={neighbors} now={now} />

      <OverviewTiles character={character} now={now} />

      <SectionNav label="Sections de la fiche" items={SECTIONS} />

      <CharacterGoals
        characterId={character.id}
        goals={goals}
        templates={templates}
        suggestions={{
          professions: character.professions.map((profession) => profession.name),
          factions: character.reputations.map((reputation) => reputation.name),
          currencies: character.currencies.map((currency) => currency.name),
        }}
      />

      <div className="mt-8 grid grid-cols-1 gap-8 xl:grid-cols-2">
        <ProfessionsSection character={character} />

        <CurrenciesSection character={character} />

        {/* Fiche à la manière du jeu : pleine largeur, comme les statistiques en dessous. */}
        <section aria-labelledby="equipment" className="xl:col-span-2">
          {/* Le compte des emplacements garnis est au centre de la fiche. */}
          <SectionTitle
            aside={
              <Link href={`/gear?pour=${character.id}&ameliorations=1`} prefetch={false} className="text-gold hover:underline">
                Améliorations en réserve
              </Link>
            }
          >
            <span id="equipment">Équipement</span>
          </SectionTitle>
          <div className="panel">
            {character.equipment.length === 0 ? (
              <p className="p-5 text-sm text-muted">Aucun objet équipé relevé.</p>
            ) : (
              <CharacterEquipment
                rows={equipmentRows}
                enchants={enchants}
                hero={{ name: character.name, classToken: character.class, level: character.level, itemLevel: character.itemLevel }}
              />
            )}
          </div>
        </section>

        <StatsSection character={character} now={now} />
      </div>

      <ReputationsSection character={character} />

      <section aria-labelledby="inventory" className="mt-8">
        <SectionTitle>
          <span id="inventory">Inventaire</span>
        </SectionTitle>
        <CharacterInventory
          characterId={character.id}
          places={inventoryPlaces}
          items={slotItems}
          prices={Object.fromEntries(values.values)}
          market={values.market?.label ?? null}
          now={now.toISOString()}
        />
        {character.holdingsAt && (
          <p className="mt-3 text-xs text-faint">
            Courrier et enchères relevés par Baganator ({formatRelative(character.holdingsAt, now)}) : le courrier à la dernière ouverture
            de la boîte aux lettres, les enchères à leur mise en vente.
          </p>
        )}
      </section>

      <LevelTimesSection character={character} />

      <SessionsSection character={character} />

      <HistorySection character={character} />
    </div>
  );
}

/** Effet d'un enchantement porté ; son numéro quand Wowhead ne le donne pas. */
async function EnchantEffect({ itemId, enchantId }: { itemId: number | null; enchantId: number }) {
  const fallback = `Enchantement n° ${enchantId}`;
  if (itemId === null) return fallback;
  try {
    return (await getEnchantText(getDatabase(), itemId, enchantId, { now: new Date() })) ?? fallback;
  } catch (error) {
    // Base indisponible : la fiche reste lisible, l'enchantement garde son numéro.
    console.error(JSON.stringify({ event: "character.enchant.failed", itemId, enchantId, error: describeError(error) }));
    return fallback;
  }
}
