import type { Metadata } from "next";
import Link from "next/link";
import { ChecklistCheck } from "@/components/checklist-check";
import { type ChecklistCharacter, ChecklistItemEditor, ChecklistItemForm, ResetForm } from "@/components/checklist-forms";
import { EmptyState, Meter, PageHeader, SectionTitle } from "@/components/ui";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { createItemAction, deleteItemAction, saveResetAction, updateItemAction } from "@/lib/checklists/actions";
import { CHECKLIST_PERIODS, describeRule, formatReset, nextReset, PERIOD_LABELS } from "@/lib/checklists/period";
import { type ChecklistItem, listChecklist, loadResetRule } from "@/lib/checklists/store";
import { collator } from "@/lib/dashboard/character-filter";
import { listCharacters } from "@/lib/dashboard/queries";
import { classKey } from "@/lib/wow/format";

export const metadata: Metadata = { title: "Listes" };

const PERIOD_IDS = { daily: "chaque-jour", weekly: "chaque-semaine" } as const;

export default async function ChecklistsPage() {
  await requireSession();
  const db = getDatabase();
  const now = new Date();
  const [rule, characters] = await Promise.all([loadResetRule(db), listCharacters(db)]);
  const items = await listChecklist(db, now, rule);

  // Comptes favoris d'abord, puis par compte, niveau décroissant et nom.
  const choices: ChecklistCharacter[] = [...characters]
    .sort(
      (a, b) =>
        Number(b.account.featured) - Number(a.account.featured) ||
        collator.compare(a.account.label, b.account.label) ||
        (b.level ?? -1) - (a.level ?? -1) ||
        collator.compare(a.name, b.name),
    )
    .map((c) => ({ id: c.id, name: c.name, class: c.class, level: c.level, account: { id: c.account.id, label: c.account.label }, tags: c.tags }));
  const byId = new Map(choices.map((c) => [c.id, c]));
  const order = new Map(choices.map((c, index) => [c.id, index]));

  return (
    <>
      <PageHeader art="road" section="characters" title="Listes">
        Les tâches à refaire chaque jour ou chaque semaine, pour les personnages choisis : une coche vaut jusqu&apos;à la remise à zéro
        suivante. Chaque fiche de personnage montre aussi ses propres tâches.
      </PageHeader>

      {characters.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="Aucun personnage" action={{ href: "/machines#ajouter-un-pc", label: "Ajouter un PC" }}>
            Les tâches se rattachent aux personnages synchronisés : il en faut au moins un.
          </EmptyState>
        </div>
      ) : (
        <>
          {items.length > 0 && (
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {CHECKLIST_PERIODS.map((period) => {
                const members = items.filter((item) => item.period === period).flatMap((item) => item.members);
                const done = members.filter((member) => member.done).length;
                return (
                  <a key={period} href={`#${PERIOD_IDS[period]}`} className="panel block p-4 hover:border-gold/40">
                    <p className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="font-semibold">{PERIOD_LABELS[period]}</span>
                      <span className="tabular-nums text-muted">{members.length === 0 ? "aucune tâche" : `${done} / ${members.length} faites`}</span>
                    </p>
                    {members.length > 0 && (
                      <div className="mt-2">
                        <Meter value={done} max={members.length} label={`Tâches faites, ${PERIOD_LABELS[period].toLowerCase()}`} tone="gold" />
                      </div>
                    )}
                    <p className="mt-2 text-xs text-faint">Remise à zéro {formatReset(nextReset(period, now, rule), now)}</p>
                  </a>
                );
              })}
            </div>
          )}

          {CHECKLIST_PERIODS.map((period) => {
            const list = items.filter((item) => item.period === period);
            if (list.length === 0) return null;
            return (
              <section key={period} aria-labelledby={PERIOD_IDS[period]} className="mt-8 scroll-mt-24">
                <SectionTitle aside={`${list.length} tâche${list.length > 1 ? "s" : ""}`}>
                  <span id={PERIOD_IDS[period]}>{PERIOD_LABELS[period]}</span>
                </SectionTitle>
                <ul className="space-y-3">
                  {list.map((item) => (
                    <TaskRow key={item.id} item={item} characters={choices} byId={byId} order={order} />
                  ))}
                </ul>
              </section>
            );
          })}

          <section aria-labelledby="new-task" className="mt-8">
            <SectionTitle>
              <span id="new-task">Nouvelle tâche</span>
            </SectionTitle>
            <div className="panel p-5">
              <ChecklistItemForm action={createItemAction} characters={choices} />
            </div>
          </section>

          <section aria-labelledby="reset" className="mt-8">
            <SectionTitle>
              <span id="reset">Remise à zéro</span>
            </SectionTitle>
            <div className="panel p-5">
              <p className="mb-3 text-sm text-muted">
                Actuellement {describeRule(rule)}, heure de Bruxelles. Une coche vaut pour la période commencée à la dernière remise à zéro :
                changer le jour de la semaine remet donc à faire les tâches hebdomadaires déjà cochées.
              </p>
              <ResetForm rule={rule} action={saveResetAction} />
            </div>
          </section>
        </>
      )}
    </>
  );
}

function TaskRow({
  item,
  characters,
  byId,
  order,
}: {
  item: ChecklistItem;
  characters: ChecklistCharacter[];
  byId: Map<number, ChecklistCharacter>;
  order: Map<number, number>;
}) {
  const members = [...item.members].sort((a, b) => (order.get(a.characterId) ?? 0) - (order.get(b.characterId) ?? 0));
  const done = members.filter((member) => member.done).length;
  const complete = members.length > 0 && done === members.length;

  return (
    <li className="panel p-4" data-complete={complete || undefined}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className={complete ? "font-semibold text-muted line-through decoration-gold/60" : "font-semibold"}>{item.label}</h3>
        <span className="text-xs tabular-nums text-muted">
          {done} / {members.length} fait{done > 1 ? "s" : ""}
        </span>
      </div>
      <ul className="mt-3 flex flex-wrap gap-2" aria-label={`Personnages de la tâche ${item.label}`}>
        {members.map((member) => {
          const character = byId.get(member.characterId);
          if (!character) return null;
          return (
            <li
              key={member.characterId}
              className="flex items-center gap-2 rounded-lg border border-line px-2 py-1"
              data-class={classKey(character.class)}
              data-reached={member.done || undefined}
            >
              <ChecklistCheck itemId={item.id} characterId={member.characterId} done={member.done} label={`${item.label}, ${character.name}`} />
              <Link href={`/characters/${character.id}`} prefetch={false} className={`text-sm class-text hover:underline ${member.done ? "opacity-60" : ""}`}>
                {character.name}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="mt-3">
        <ChecklistItemEditor
          action={updateItemAction}
          deleteAction={deleteItemAction}
          characters={characters}
          item={{ id: item.id, label: item.label, period: item.period, characterIds: members.map((member) => member.characterId) }}
        />
      </div>
    </li>
  );
}
