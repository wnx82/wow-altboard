import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { decodeEntities, enchantText, lineText, MAX_LINES, parseWowheadTooltip, type TooltipLine, wowheadItemUrl } from "./wowhead-tooltip";

// Bulles réelles de Wowhead (WoW Forever, en français), relevées le 2026-11-13.
const THUNDERFURY =
  '<table><tr><td><!--nstart--><b class="q5">Lame-tonnerre, épée bénie du Cherchevent</b><!--nend--><!--ndstart--><!--ndend--><span class="q"><br>Niveau d\'objet <!--ilvl-->80</span><!--bo--><br>Lié quand ramassé<br>Unique<!--ue--><!--ue--><table width="100%"><tr><td>À une main</td><th><!--scstart2:7--><span class="q1">Epée</span><!--scend--></th></tr></table><!--rf--><table width="100%"><tr>\n    <td><span><!--dmg-->Dégâts : 44 - 115</span></td>\n    <th>Vitesse <!--spd-->1.90</th>\n</tr></table><!--dps-->(41.84 dégâts par seconde)<br><span><!--stat3-->+5 Agilité</span><br><span><!--stat7-->+8 Endurance</span><!--ebstats--><!--egstats--><!--eistats--><!--nameDescStats--><!--rs--><br>+8 à la résistance Feu<br>+9 à la résistance Nature<!--e--><!--ps--><br>Durabilité 125 / 125</td></tr></table><table><tr><td>Niveau <!--rlvl-->60 requis<br><!--rr--><!--useText:0:1--><span id="useText1" class="q2">Chances quand vous touchez : <!--useEffect:0:1--><a href="/forever/fr/spell=21992/lame-tonnerre" class="q2">Votre ennemi est frappé par la foudre, qui lui inflige 300 points de dégâts de Nature.</a><!--useEffect:1--></span><!--useText:1--><!--itemEffects:1--><br><!--pvpEquip--><!--pvpEquip--><div class="whtt-sellprice">Prix de Vente: <span class="moneygold">25</span> <span class="moneysilver">53</span> <span class="moneycopper">55</span></div></td></tr></table>';

const SUFFIX =
  '<table><tr><td><!--nstart--><b class="q2">Epée courte d\'écumeur de la baleine</b><!--nend--><span class="q"><br>Niveau d\'objet <!--ilvl-->16</span><!--bo--><br>Lié quand équipé<table width="100%"><tr><td>À une main</td><th><span class="q1">Epée</span></th></tr></table><table width="100%"><tr>\n<td><span>Dégâts : 11 - 20</span></td>\n<th>Vitesse 1.90</th>\n</tr></table>(8.16 dégâts par seconde)<br><span class="q1">+<!--stat7476-->3 Esprit<br />+<!--stat7502-->4 Endurance</span><br>Durabilité 50 / 50</td></tr></table><table><tr><td>Niveau 11 requis<br><div class="whtt-sellprice">Prix de Vente: <span class="moneysilver">8</span> <span class="moneycopper">25</span></div></td></tr></table>';

const EQUIP =
  '<table><tr><td><!--nstart--><b class="q3">Gants de grand gardien</b><!--nend--><span class="q"><br>Niveau d\'objet 55</span><br>Lié quand ramassé<table width="100%"><tr><td>Mains</td><th><span class="q1">Plaques</span></th></tr></table><span><!--amr-->Armure : 361</span><br><span>+16 Endurance</span></td></tr></table><table><tr><td>Niveau 50 requis<br><span class="q2">Équiper : Défense augmentée de +<!--rtg12-->11.</span><br><span class="q2">Équipé : augmente les dégâts et les soins des sorts de <span><!--rtg41-->11</span> au maximum.</span><br><div class="whtt-sellprice">Prix de Vente: <span class="moneysilver">66</span> <span class="moneycopper">20</span></div></td></tr></table><!--i?250553:1:60:50-->';

const SET =
  '<table><tr><td><!--nstart--><b class="q4">Jambières de transcendance</b><!--nend--><span class="q"><br>Niveau d\'objet 76</span><br>Lié quand ramassé<table width="100%"><tr><td>Jambes</td><th><span class="q1">Tissu</span></th></tr></table><span>Armure : 221</span><div class="wowhead-tooltip-item-classes">Classes : <a href="/forever/fr/class=5/prêtre" class="c5">Prêtre</a></div></td></tr></table><table><tr><td>Niveau 60 requis<br /><span class="q"><a href="/forever/fr/item-set=211" class="q">Habits de transcendance</a> (0/8)</span><div class="q0 indent"><span><a href="/forever/fr/item=16925">Ceinture de transcendance</a></span><br /><span><a href="/forever/fr/item=16926">Manchettes de transcendance</a></span></div><br /><span class="q0"><span>(3) Set : <a href="/forever/fr/spell=21894">Augmente votre Esprit de 50.</a></span><br /><span>(5) Set : <a href="/forever/fr/spell=21853">Lorsque vous êtes touché, vous avez 50% de chances.</a></span></span><div class="whtt-sellprice">Prix de Vente: <span class="moneygold">7</span> <span class="moneysilver">12</span> <span class="moneycopper">85</span></div><div class="whtt-extra whtt-droppedby">Dépouillé sur: Ragnaros</div><div class="whtt-extra whtt-dropchance">Chance de Butin: 8.40%</div></td></tr></table>';

const POTION =
  '<table><tr><td><!--nstart--><b class="q1">Potion de soins majeure</b><!--nend--><span class="q whtt-extra whtt-ilvl"><br>Niveau d\'objet <!--ilvl-->55</span></td></tr></table><table><tr><td>Niveau <!--rlvl-->45 requis<br><br><span id="useText1" class="q2">Utilise: <a href="/forever/fr/spell=17534" class="q2">Rend 1050 à 1750 points de vie.</a> (2 Min Recharge)</span><br><div class="whtt-extra whtt-maxstack">Empilement maxi: 5</div><div class="whtt-sellprice">Prix de Vente: <span class="moneysilver">10</span></div></td></tr></table>';

const texts = (lines: TooltipLine[]) => lines.map(lineText);

describe("bulles de Wowhead : lecture", () => {
  test("arme : niveau, liaison, emplacement et type, dégâts et vitesse, caractéristiques, effet, prix", () => {
    const lines = parseWowheadTooltip(THUNDERFURY);
    assert.deepEqual(texts(lines), [
      "Niveau d'objet 80",
      "Lié quand ramassé",
      "Unique",
      "À une main | Epée",
      "Dégâts : 44 - 115 | Vitesse 1.90",
      "(41.84 dégâts par seconde)",
      "+5 Agilité",
      "+8 Endurance",
      "+8 à la résistance Feu",
      "+9 à la résistance Nature",
      "Durabilité 125 / 125",
      "Niveau 60 requis",
      "Chances quand vous touchez : Votre ennemi est frappé par la foudre, qui lui inflige 300 points de dégâts de Nature.",
      "Prix de vente 255355",
    ]);
    // Le nom est omis : la bulle l'affiche déjà, à la couleur de la qualité.
    assert.ok(!texts(lines).some((text) => text.includes("Lame-tonnerre")));
    assert.deepEqual(lines[0], { type: "text", segments: [{ text: "Niveau d'objet 80", tone: "gold" }] });
    assert.deepEqual(lines[3], { type: "pair", left: [{ text: "À une main" }], right: [{ text: "Epée", tone: "q1" }] });
    assert.equal(lines[12].type === "text" && lines[12].segments[0].tone, "q2");
    assert.deepEqual(lines.at(-1), { type: "money", copper: 255_355 });
  });

  test("suffixe aléatoire : ses caractéristiques, une par ligne", () => {
    const lines = texts(parseWowheadTooltip(SUFFIX));
    assert.deepEqual(lines.slice(4, 8), ["(8.16 dégâts par seconde)", "+3 Esprit", "+4 Endurance", "Durabilité 50 / 50"]);
    assert.equal(lines.at(-1), "Prix de vente 825");
  });

  test("armure : armure, caractéristiques et effets « Équipé », en vert", () => {
    const lines = parseWowheadTooltip(EQUIP);
    assert.deepEqual(texts(lines), [
      "Niveau d'objet 55",
      "Lié quand ramassé",
      "Mains | Plaques",
      "Armure : 361",
      "+16 Endurance",
      "Niveau 50 requis",
      "Équiper : Défense augmentée de +11.",
      "Équipé : augmente les dégâts et les soins des sorts de 11 au maximum.",
      "Prix de vente 6620",
    ]);
    assert.deepEqual(lines[7], { type: "text", segments: [{ text: "Équipé : augmente les dégâts et les soins des sorts de 11 au maximum.", tone: "q2" }] });
  });

  test("ensemble : titre et nombre de pièces, pièces en retrait, bonus en gris ; butin de Wowhead omis", () => {
    const lines = parseWowheadTooltip(SET);
    assert.deepEqual(texts(lines), [
      "Niveau d'objet 76",
      "Lié quand ramassé",
      "Jambes | Tissu",
      "Armure : 221",
      "Classes : Prêtre",
      "Niveau 60 requis",
      "Habits de transcendance (8 pièces)",
      "Ceinture de transcendance",
      "Manchettes de transcendance",
      "(3) Set : Augmente votre Esprit de 50.",
      "(5) Set : Lorsque vous êtes touché, vous avez 50% de chances.",
      "Prix de vente 71285",
    ]);
    assert.deepEqual(lines[6], { type: "text", segments: [{ text: "Habits de transcendance (8 pièces)", tone: "gold" }] });
    assert.deepEqual(lines[7], { type: "text", segments: [{ text: "Ceinture de transcendance", tone: "q0" }], indent: true });
    assert.equal(lines[9].type === "text" && lines[9].indent, undefined);
  });

  test("consommable : « Utilise : » à la française, lignes vides retirées", () => {
    assert.deepEqual(texts(parseWowheadTooltip(POTION)), [
      "Niveau d'objet 55",
      "Niveau 45 requis",
      "Utilise : Rend 1050 à 1750 points de vie. (2 Min Recharge)",
      "Empilement maxi : 5",
      "Prix de vente 1000",
    ]);
  });

  test("HTML abîmé : balises non fermées ou orphelines, entités, scripts ignorés", () => {
    const lines = parseWowheadTooltip('</span><b class="q10">Rouge &amp; <i>gras</b> &lt;Enchantement aléatoire&gt;<script>alert(1)</script><br>&#233;t&#xe9; &bogus; <table><tr><td>seul');
    assert.deepEqual(texts(lines), ["Rouge & gras <Enchantement aléatoire>", "été &bogus;", "seul"]);
    assert.deepEqual(lines[0], {
      type: "text",
      segments: [
        { text: "Rouge & gras", tone: "red" },
        { text: " <Enchantement aléatoire>" },
      ],
    });
    assert.deepEqual(parseWowheadTooltip(""), []);
  });

  test("au plus MAX_LINES lignes", () => {
    assert.equal(parseWowheadTooltip("ligne<br>".repeat(MAX_LINES + 20)).length, MAX_LINES);
  });

  test("entités et adresse de la fiche", () => {
    assert.equal(decodeEntities("a&nbsp;b &quot;c&quot; &#39;d&#39; &#0; &#xFFFFFFF;"), "a b \"c\" 'd' &#0; &#xFFFFFFF;");
    assert.equal(wowheadItemUrl(19019), "https://www.wowhead.com/forever/fr/item=19019");
    assert.equal(wowheadItemUrl(15210, 1017), "https://www.wowhead.com/forever/fr/item=15210?rand=1017");
    assert.equal(wowheadItemUrl(2969, null, 24), "https://www.wowhead.com/forever/fr/item=2969?ench=24");
    assert.equal(wowheadItemUrl(15210, 1017, 24), "https://www.wowhead.com/forever/fr/item=15210?rand=1017&ench=24");
  });

  test("enchantement demandé (ench) : sa ligne verte est marquée, et seule elle", () => {
    // Relevé réel du 2026-11-14 : Déchireuse en arcanite, ench=1900 (Croisé).
    const reaper =
      '<table><tr><td><!--nstart--><b class="q3">Déchireuse en arcanite</b><!--nend--><table width="100%"><tr><td>Deux mains</td><th><span class="q1">Hache</span></th></tr></table><span><!--stat7-->+13 Endurance</span><!--ebstats--><!--egstats--><!--eistats--><!--nameDescStats--><!--rs--><br /><span class="q2"><!--ee1900:0:0:0:0:0-->Croisé</span><!--ps--><br>Durabilité 100 / 100</td></tr></table>';
    const lines = parseWowheadTooltip(reaper);
    assert.deepEqual(texts(lines), ["Deux mains | Hache", "+13 Endurance", "Croisé", "Durabilité 100 / 100"]);
    assert.deepEqual(lines[2], { type: "text", segments: [{ text: "Croisé", tone: "q2" }], enchant: true });
    assert.equal(enchantText(lines), "Croisé");
    // Sans ench, ni marque ni effet ; un « Équiper : » vert n'est pas un enchantement.
    assert.equal(enchantText(parseWowheadTooltip(EQUIP)), null);
    assert.ok(parseWowheadTooltip(THUNDERFURY).every((line) => line.type !== "text" || line.enchant === undefined));
  });
});
