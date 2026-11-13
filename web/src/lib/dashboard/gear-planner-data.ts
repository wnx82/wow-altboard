import { asc } from "drizzle-orm";
import type { Database } from "@/db/client";
import * as t from "@/db/schema";
import { loadItemIcons } from "@/lib/wow/icon-files";
import { loadItemSpecs } from "@/lib/wow/item-specs";
import type { EquippedItem, GearPlannerData } from "./gear-planner";
import { gearOnly } from "./gear-planner";
import { loadInventory } from "./inventory";

/** Page Équipement : l'équipement en réserve de tous les personnages, et ce que chacun porte. */
export async function loadGearPlanner(db: Database, now: Date = new Date()): Promise<GearPlannerData> {
  const [inventory, worn] = await Promise.all([
    loadInventory(db, now),
    db
      .select({
        characterId: t.characterEquipment.characterId,
        slot: t.characterEquipment.slot,
        itemId: t.characterEquipment.itemId,
        name: t.characterEquipment.name,
        quality: t.characterEquipment.quality,
        itemLevel: t.characterEquipment.itemLevel,
      })
      .from(t.characterEquipment)
      .orderBy(asc(t.characterEquipment.characterId), asc(t.characterEquipment.slot)),
  ]);
  const keys = worn.flatMap((item) => (item.itemId === null ? [] : [String(item.itemId)]));
  const [icons, specs] = await Promise.all([loadItemIcons(db, keys), loadItemSpecs(db, keys)]);
  const equipment: Record<string, EquippedItem[]> = {};
  for (const { characterId, ...item } of worn) {
    const key = item.itemId === null ? null : String(item.itemId);
    const spec = key === null ? undefined : specs.get(key);
    (equipment[String(characterId)] ??= []).push({
      ...item,
      icon: key === null ? null : (icons.get(key) ?? null),
      spec: spec ? { itemClass: spec.itemClass, subclass: spec.subclass } : null,
    });
  }
  return { ...gearOnly(inventory), equipment };
}
