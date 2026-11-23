import { Meter, ProfessionIcon, SectionTitle } from "@/components/ui";
import type { CharacterDetail } from "@/lib/dashboard/queries";
import { formatInteger, formatRelative, progressPercent, REACTION_LABELS } from "@/lib/wow/format";

// Sections de la fiche sans état ni graphique : métiers, monnaies, statistiques, réputations.

export function ProfessionsSection({ character }: { character: CharacterDetail }) {
  return (
    <section aria-labelledby="professions">
      <SectionTitle>
        <span id="professions">Métiers</span>
      </SectionTitle>
      <div className="panel p-5">
        {character.professions.length === 0 ? (
          <p className="text-sm text-muted">Aucun métier appris.</p>
        ) : (
          <ul className="space-y-4">
            {character.professions.map((profession) => (
              <li key={profession.skillLine}>
                <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">
                    <ProfessionIcon skillLine={profession.skillLine} size={22} /> {profession.name}
                    {profession.isPrimary && <span className="badge ml-2">Principal</span>}
                  </span>
                  <span className="tabular-nums text-muted">
                    {profession.rank ?? "—"} / {profession.maxRank ?? "—"}
                    {progressPercent(profession.rank, profession.maxRank) !== null && (
                      <span className="ml-2 text-text">{progressPercent(profession.rank, profession.maxRank)} %</span>
                    )}
                  </span>
                </div>
                <Meter value={profession.rank} max={profession.maxRank} label={profession.name} tone="gold" />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function CurrenciesSection({ character }: { character: CharacterDetail }) {
  return (
    <section aria-labelledby="currencies">
      <SectionTitle>
        <span id="currencies">Monnaies</span>
      </SectionTitle>
      <div className="panel p-5">
        {character.currencies.length === 0 ? (
          <p className="text-sm text-muted">Aucune monnaie détenue.</p>
        ) : (
          <ul className="divide-y divide-white/5 text-sm">
            {character.currencies.map((currency) => (
              <li key={currency.name} className="flex items-baseline justify-between gap-3 py-2">
                <span>{currency.name}</span>
                <span className="tabular-nums">
                  {formatInteger(currency.quantity)}
                  {currency.maxQuantity !== null && currency.maxQuantity > 0 && (
                    <span className="text-muted"> / {formatInteger(currency.maxQuantity)}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

const percentFormat = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = (value: number | null) => (value === null ? null : `${percentFormat.format(value)} %`);

function formatNullable(value: number | null | undefined): string | null {
  return value === null || value === undefined ? null : formatInteger(value);
}

export function StatsSection({ character, now }: { character: CharacterDetail; now: Date }) {
  const stats = character.stats;
  const statRows: [string, string | null][] = stats
    ? [
        ["Force", stats.strength?.toString() ?? null],
        ["Agilité", stats.agility?.toString() ?? null],
        ["Endurance", stats.stamina?.toString() ?? null],
        ["Intelligence", stats.intellect?.toString() ?? null],
        ["Esprit", stats.spirit?.toString() ?? null],
        ["Armure", formatNullable(stats.armor)],
        ["Points de vie", formatNullable(stats.health)],
        [stats.powerType ? `Ressource (${stats.powerType})` : "Ressource", formatNullable(stats.power)],
        ["Puissance d'attaque", formatNullable(stats.attackPower)],
        ["Puissance d'attaque à distance", formatNullable(stats.rangedAttackPower)],
        ["Critique", percent(stats.crit)],
        ["Critique à distance", percent(stats.rangedCrit)],
        ["Toucher", percent(stats.hit)],
        ["Esquive", percent(stats.dodge)],
        ["Parade", percent(stats.parry)],
        ["Blocage", percent(stats.block)],
        ["Défense", formatNullable(stats.defense)],
        ["Puissance des sorts", formatNullable(stats.spellPower)],
        ["Critique des sorts", percent(stats.spellCrit)],
        ["Soins", formatNullable(stats.healing)],
        ["Toucher des sorts", percent(stats.spellHit)],
        ["Résistance au feu", formatNullable(stats.resFire)],
        ["Résistance à la nature", formatNullable(stats.resNature)],
        ["Résistance au givre", formatNullable(stats.resFrost)],
        ["Résistance à l'ombre", formatNullable(stats.resShadow)],
        ["Résistance aux arcanes", formatNullable(stats.resArcane)],
      ]
    : [];
  return (
    <section aria-labelledby="stats" className="xl:col-span-2">
      <SectionTitle aside={character.statsAt ? `Relevées ${formatRelative(character.statsAt, now)}, améliorations actives incluses` : undefined}>
        <span id="stats">Statistiques</span>
      </SectionTitle>
      <div className="panel p-5">
        {statRows.every(([, value]) => value === null) ? (
          <p className="text-sm text-muted">Aucune statistique relevée.</p>
        ) : (
          <dl className="grid grid-cols-1 gap-x-8 text-sm sm:grid-cols-2 xl:grid-cols-3">
            {statRows
              .filter(([, value]) => value !== null)
              .map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-3 border-b border-white/5 py-1.5">
                  <dt className="text-muted">{label}</dt>
                  <dd className="font-medium tabular-nums">{value}</dd>
                </div>
              ))}
          </dl>
        )}
      </div>
    </section>
  );
}

export function ReputationsSection({ character }: { character: CharacterDetail }) {
  const reputationGroups = Map.groupBy(character.reputations, (reputation) => reputation.groupName ?? "Autres");
  return (
    <section aria-labelledby="reputations" className="mt-8">
      <SectionTitle aside={`${character.reputations.length} faction${character.reputations.length > 1 ? "s" : ""}`}>
        <span id="reputations">Réputations</span>
      </SectionTitle>
      {character.reputations.length === 0 ? (
        <div className="panel p-5 text-sm text-muted">Aucune réputation relevée.</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[...reputationGroups.entries()].map(([group, reputations]) => (
            <div key={group} className="panel p-5">
              <h3 className="eyebrow mb-3">{group}</h3>
              <ul className="space-y-3">
                {reputations.map((reputation) => {
                  const span = reputation.minValue !== null && reputation.maxValue !== null ? reputation.maxValue - reputation.minValue : null;
                  const progress = reputation.currentValue !== null && reputation.minValue !== null ? reputation.currentValue - reputation.minValue : null;
                  return (
                    <li key={reputation.factionId}>
                      <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate">{reputation.name}</span>
                        <span className="whitespace-nowrap text-xs text-muted">
                          {reputation.reaction === null ? "—" : (REACTION_LABELS[reputation.reaction] ?? `Palier ${reputation.reaction}`)}
                          {progress !== null && span !== null && span > 0 && (
                            <span className="ml-2 tabular-nums text-text">
                              {formatInteger(progress)} / {formatInteger(span)}
                            </span>
                          )}
                        </span>
                      </div>
                      <Meter value={progress} max={span} label={reputation.name} />
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
