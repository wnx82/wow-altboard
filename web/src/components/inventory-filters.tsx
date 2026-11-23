"use client";

import type { InventoryCharacter } from "@/lib/dashboard/inventory";
import { gearFiltered, type InventoryPlace, type InventorySort, type InventoryState, PLACE_LABELS, SORTS, defaultView } from "@/lib/dashboard/inventory-view";
import { classLabel, QUALITY_LABELS } from "@/lib/wow/format";
import { ARMOR_TYPES, CLASSIC_CLASSES, GEAR_SLOTS, WEAPON_TYPES } from "@/lib/wow/gear";
import { CATEGORY_GROUPS, type ITEM_CATEGORIES } from "@/lib/wow/item-categories";

// Fenêtre des filtres de la page Inventaires : une rangée étiquetée par question (quoi, quel
// équipement, où), repliée derrière un bouton sur téléphone.

const SORT_LABELS: Record<InventorySort, string> = { category: "Catégorie", total: "Quantité", value: "Valeur", name: "Nom", quality: "Qualité", level: "Niveau requis" };

/** Niveau saisi : chiffres seulement, vide pour zéro. */
function levelInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 3);
  return digits === "" || Number(digits) === 0 ? "" : String(Number(digits));
}

export type InventoryFiltersProps = {
  state: InventoryState;
  update: (patch: Partial<InventoryState>) => void;
  togglePlace: (place: InventoryPlace) => void;
  /** Ouverte sur téléphone ; toujours visible au-delà. */
  filtersOpen: boolean;
  /** Bascule « Tous les objets » / « Sac par sac », placée au bout de la première rangée. */
  viewNav: React.ReactNode;
  accounts: [number, string][];
  characters: Map<number, InventoryCharacter>;
  characterOptions: InventoryCharacter[];
  categories: (typeof ITEM_CATEGORIES)[number][];
  hasGear: boolean;
  wearers: InventoryCharacter[];
  lostWearer: boolean;
  available: InventoryPlace[];
  hasSoon: boolean;
  hasExpired: boolean;
  /** Plus d'un objet : le tri est proposé. */
  sortable: boolean;
};

export function InventoryFilters({
  state,
  update,
  togglePlace,
  filtersOpen,
  viewNav,
  accounts,
  characters,
  characterOptions,
  categories,
  hasGear,
  wearers,
  lostWearer,
  available,
  hasSoon,
  hasExpired,
  sortable,
}: InventoryFiltersProps) {
  return (
    <div id="inventory-filters" className={`filter-window ${filtersOpen ? "" : "hidden sm:grid"}`}>
      <div className="filter-row" role="group" aria-labelledby="inventory-filters-show">
        <span id="inventory-filters-show" className="filter-label">
          Afficher
        </span>
        <div className="filter-controls">
          {accounts.length > 1 && (
            <select
              className="field min-w-36 flex-1 sm:flex-none sm:w-auto"
              aria-label="Filtrer par compte"
              value={state.account}
              onChange={(event) => {
                const account = event.target.value;
                const keep = state.character !== "" && account !== "" && String(characters.get(Number(state.character))?.account.id) === account;
                const character = keep || account === "" ? state.character : "";
                update({ account, character, view: character === state.character ? state.view : defaultView(character) });
              }}
            >
              <option value="">Tous les comptes</option>
              {accounts.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          )}
          <select
            className="field min-w-36 flex-1 sm:flex-none sm:w-auto"
            aria-label="Filtrer par personnage"
            value={state.character}
            onChange={(event) => update({ character: event.target.value, view: defaultView(event.target.value) })}
          >
            <option value="">Tous les personnages</option>
            {characterOptions.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name} ({character.realm}
                {state.account === "" && accounts.length > 1 ? `, ${character.account.label}` : ""})
              </option>
            ))}
          </select>
          <select
            className="field min-w-36 flex-1 sm:flex-none sm:w-auto"
            aria-label="Qualité minimale"
            value={state.minQuality}
            onChange={(event) => update({ minQuality: event.target.value })}
          >
            <option value="">Toutes qualités</option>
            {QUALITY_LABELS.slice(1, 6).map((label, index) => (
              <option key={label} value={index + 1}>
                {label} et mieux
              </option>
            ))}
          </select>
          <select
            className="field min-w-36 flex-1 sm:flex-none sm:w-auto"
            aria-label="Catégorie"
            value={state.category}
            onChange={(event) => update({ category: event.target.value })}
          >
            <option value="">Toutes catégories</option>
            {CATEGORY_GROUPS.map((group) => {
              const options = categories.filter((category) => category.group === group);
              return (
                options.length > 0 && (
                  <optgroup key={group} label={group}>
                    {options.map((category) => (
                      <option key={category.value} value={category.value}>
                        {category.label}
                      </option>
                    ))}
                  </optgroup>
                )
              );
            })}
          </select>
          <span className="hidden flex-1 sm:block" />
          <div className="hidden sm:block">{viewNav}</div>
        </div>
      </div>

      {(hasGear || gearFiltered(state)) && (
        <fieldset className="filter-row">
          <legend className="sr-only">Équipement</legend>
          <span aria-hidden="true" className="filter-label">
            Équipement
          </span>
          <div className="filter-controls">
            <select
              className="field min-w-36 flex-1 sm:flex-none sm:w-auto"
              aria-label="Type d'armure ou d'arme"
              value={state.gearType}
              onChange={(event) => update({ gearType: event.target.value })}
            >
              <option value="">Armures et armes</option>
              <optgroup label="Armures">
                {ARMOR_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Armes">
                {WEAPON_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </optgroup>
            </select>
            <select
              className="field min-w-36 flex-1 sm:flex-none sm:w-auto"
              aria-label="Emplacement"
              value={state.gearSlot}
              onChange={(event) => update({ gearSlot: event.target.value })}
            >
              <option value="">Tous les emplacements</option>
              {GEAR_SLOTS.map((slot) => (
                <option key={slot.value} value={slot.value}>
                  {slot.label}
                </option>
              ))}
            </select>
            <span className="flex items-center gap-1.5 text-xs text-muted">
              Niveau requis
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={999}
                className="field w-[4.5rem]"
                aria-label="Niveau requis minimal"
                placeholder="de"
                value={state.minLevel}
                onChange={(event) => update({ minLevel: levelInput(event.target.value) })}
              />
              à
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={999}
                className="field w-[4.5rem]"
                aria-label="Niveau requis maximal"
                placeholder="à"
                value={state.maxLevel}
                onChange={(event) => update({ maxLevel: levelInput(event.target.value) })}
              />
            </span>
            <select
              className="field min-w-36 flex-1 sm:flex-none sm:w-auto"
              aria-label="Équipement portable par"
              title="Une classe : tout ce qu'elle peut apprendre à porter. Un personnage : ce qu'il peut porter à son niveau."
              value={state.wearer}
              onChange={(event) => update({ wearer: event.target.value })}
            >
              <option value="">Pour toutes les classes</option>
              {/* Lien vers un personnage supprimé ou d'une autre classe : visible, pour pouvoir changer. */}
              {lostWearer && <option value={state.wearer}>Personnage introuvable</option>}
              <optgroup label="Classe">
                {CLASSIC_CLASSES.map((token) => (
                  <option key={token} value={token}>
                    {classLabel(token)}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Personnage, à son niveau">
                {wearers.map((character) => (
                  <option key={character.id} value={character.id}>
                    {character.name} · {classLabel(character.class)}
                    {character.level === null ? "" : ` ${character.level}`}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
        </fieldset>
      )}

      <div className="filter-row" role="group" aria-labelledby="inventory-filters-places">
        <span id="inventory-filters-places" className="filter-label">
          Chercher dans
        </span>
        <div className="filter-controls">
          {available.map((place) => (
            <button key={place} type="button" className="button" aria-pressed={state.places.includes(place)} onClick={() => togglePlace(place)}>
              {PLACE_LABELS[place]}
            </button>
          ))}
          {(hasSoon || state.soon) && (
            <button
              type="button"
              className="button"
              aria-pressed={state.soon}
              title="Seulement les courriers et les ventes qui expirent dans les trois jours"
              onClick={() => update({ soon: !state.soon })}
            >
              Bientôt échus
            </button>
          )}
          {hasExpired && (
            <button
              type="button"
              className="button"
              aria-pressed={state.expired}
              title="Inclure les courriers et les ventes dont l'échéance est passée depuis le relevé"
              onClick={() => update({ expired: !state.expired })}
            >
              Échus
            </button>
          )}
          <span className="flex-1" />
          {sortable && (
            <label className="flex items-center gap-2 text-xs text-muted">
              Trier par
              <select className="field w-auto" value={state.sort} onChange={(event) => update({ sort: event.target.value as InventorySort })}>
                {SORTS.map((sort) => (
                  <option key={sort} value={sort}>
                    {SORT_LABELS[sort]}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>
    </div>
  );
}
