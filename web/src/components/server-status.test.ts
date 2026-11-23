import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ServiceHistory, ServiceView } from "@/lib/status/view";
import { ServerStatusTable, ServerStatusTiles, ServiceHistoryPanel, StatusBadge, StatusLegend, TransitionsTable } from "./server-status";

const service = (overrides: Partial<ServiceView>): ServiceView => ({
  service: "auth",
  label: "Authentification Blizzard",
  targets: 1,
  status: "up",
  detail: "Connexion acceptée",
  latencyMs: 32,
  checkedAt: "2026-10-08T14:05:09.000Z",
  stale: false,
  lastAnswer: null,
  ...overrides,
});

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

test("chaque statut a son libellé, son ton et son explication", () => {
  const badge = (status: Parameters<typeof StatusBadge>[0]["status"]) => renderToStaticMarkup(createElement(StatusBadge, { status }));

  assert.match(badge("up"), /data-tone="ok" data-status="up"[^>]*>.*En ligne/);
  assert.match(badge("degraded"), /data-tone="warn" data-status="degraded"[^>]*>.*Dégradé/);
  assert.match(badge("down"), /data-tone="danger" data-status="down"[^>]*>.*Hors ligne/);
  // « Inconnu » garde le badge neutre : aucun ton.
  assert.match(badge("unknown"), /data-status="unknown"[^>]*>.*Inconnu/);
  assert.doesNotMatch(badge("unknown"), /data-tone/);
  for (const status of ["up", "degraded", "down", "unknown"] as const) assert.match(badge(status), /title="[^"]{20,}"/);
  // Aucun style en ligne : la CSP les interdit.
  assert.doesNotMatch(badge("up"), /style=/);
});

test("le tableau affiche service, statut, latence, heure de Bruxelles et constat", () => {
  const html = renderToStaticMarkup(
    createElement(ServerStatusTable, {
      services: [service({}), service({ service: "game", label: "Serveurs de jeu EU", status: "degraded", detail: "1 adresse sur 2 répond", latencyMs: 24 })],
    }),
  );
  const content = text(html);

  assert.match(content, /Service Statut Latence Dernier contrôle Constat/);
  assert.match(content, /Authentification Blizzard En ligne 32 ms 0?8\/10\/(20)?26 16:05:09 Connexion acceptée/);
  assert.match(content, /Serveurs de jeu EU Dégradé 24 ms .* 1 adresse sur 2 répond/);
  assert.match(html, /<time datetime="2026-10-08T14:05:09.000Z">/i);
  assert.doesNotMatch(html, /style=/);
});

test("hors ligne : pas de latence, la dernière mesure valide est rappelée", () => {
  const content = text(
    renderToStaticMarkup(
      createElement(ServerStatusTable, {
        services: [
          service({
            status: "down",
            detail: "Aucune réponse en 3 s : panne probable, non confirmée",
            latencyMs: null,
            lastAnswer: { at: "2026-10-08T14:04:09.000Z", latencyMs: 31 },
          }),
        ],
      }),
    ),
  );

  assert.match(content, /Hors ligne — /);
  assert.match(content, /Aucune réponse en 3 s : panne probable, non confirmée Dernière réponse : 0?8\/10\/(20)?26 16:04:09 \(31 ms\)/);
});

test("inconnu : ni latence ni heure inventées", () => {
  const content = text(
    renderToStaticMarkup(
      createElement(ServerStatusTable, {
        services: [service({ status: "unknown", detail: "Aucune adresse configurée", targets: 0, latencyMs: null, checkedAt: null })],
      }),
    ),
  );

  assert.match(content, /Authentification Blizzard Inconnu — — Aucune adresse configurée$/);
  assert.doesNotMatch(content, /ms/);
});

test("la légende explique les quatre statuts", () => {
  const content = text(renderToStaticMarkup(createElement(StatusLegend)));

  for (const label of ["En ligne", "Dégradé", "Hors ligne", "Inconnu"]) assert.match(content, new RegExp(label));
  assert.match(content, /Signification des statuts/);
});

const history = (overrides: Partial<ServiceHistory>): ServiceHistory => ({
  service: "auth",
  label: "Authentification Blizzard",
  availability: [
    { window: "24h", percent: null, measuredSeconds: 600, downSeconds: 0 },
    { window: "7d", percent: null, measuredSeconds: 600, downSeconds: 0 },
  ],
  hours: Array.from({ length: 24 }, (_, index) => ({
    start: new Date(Date.parse("2026-10-07T13:00:00Z") + index * 3_600_000).toISOString(),
    status: null,
    availableSeconds: 0,
    downSeconds: 0,
  })),
  ...overrides,
});

test("échantillon insuffisant : aucun pourcentage n'est affiché", () => {
  const content = text(renderToStaticMarkup(createElement(ServiceHistoryPanel, { history: history({}) })));

  assert.match(content, /Disponibilité sur 24 heures Échantillon insuffisant/);
  assert.match(content, /Disponibilité sur 7 jours Échantillon insuffisant/);
  assert.doesNotMatch(content, /%/);
});

test("disponibilité et frise des 24 dernières heures", () => {
  const base = history({});
  const hours = base.hours.map((cell, index) => {
    if (index === 21) return { ...cell, status: "degraded" as const, availableSeconds: 3_600 };
    if (index === 22) return { ...cell, status: "down" as const, availableSeconds: 3_000, downSeconds: 600 };
    if (index === 23) return { ...cell, status: "up" as const, availableSeconds: 1_200 };
    return cell;
  });
  const html = renderToStaticMarkup(
    createElement(ServiceHistoryPanel, {
      history: history({
        hours,
        availability: [
          { window: "24h", percent: (7_800 / 8_400) * 100, measuredSeconds: 8_400, downSeconds: 600 },
          { window: "7d", percent: null, measuredSeconds: 8_400, downSeconds: 600 },
        ],
      }),
    }),
  );
  const content = text(html);

  assert.match(content, /Disponibilité sur 24 heures 92,86 % sur 2 h 20 mesurées, dont 10 min hors ligne/);
  assert.match(content, /Disponibilité sur 7 jours Échantillon insuffisant/);
  assert.equal(html.match(/class="status-cell"/g)?.length, 24);
  assert.equal(html.match(/data-status="(up|degraded|down)"/g)?.length, 3);
  // Le statut de la frise ne passe pas par la couleur seule.
  assert.match(html, /aria-label="24 dernières heures : 1 h en ligne, 1 h avec dégradation, 1 h avec panne, 21 h sans mesure"/);
  assert.match(html, /title="13:00 – 14:00 : en ligne 50 min, hors ligne 10 min"/);
  assert.match(html, /title="12:00 – 13:00 : en ligne 1 h \(dégradé par moments\)"/);
  assert.match(html, /title="15:00 – 16:00 : aucune mesure"/);
  assert.doesNotMatch(html, /style=/);
});

test("les changements d'état montrent l'ancien et le nouveau statut", () => {
  const html = renderToStaticMarkup(
    createElement(TransitionsTable, {
      transitions: [
        { at: "2026-10-08T10:02:00.000Z", service: "auth", label: "Authentification Blizzard", from: "up", to: "down", detail: "Connexion refusée : panne confirmée par le serveur visé" },
      ],
    }),
  );

  assert.match(text(html), /0?8\/10\/(20)?26 12:02:00 Authentification Blizzard En ligne → devient Hors ligne Connexion refusée/);
});

test("les miniatures de l'accueil mènent à la page Serveurs et y résument l'état présent", () => {
  const { hours } = history({});
  hours[23] = { ...hours[23], status: "up", availableSeconds: 1_200 };
  hours[22] = { ...hours[22], status: "down", availableSeconds: 3_000, downSeconds: 600 };
  const now = new Date("2026-10-08T14:08:09.000Z");
  const html = renderToStaticMarkup(
    createElement(ServerStatusTiles, {
      now,
      services: [
        { ...service({}), availability: { window: "24h", percent: 92.857, measuredSeconds: 8_400, downSeconds: 600 }, hours },
        {
          ...service({ service: "game", label: "Serveurs de jeu EU", status: "down", detail: "Connexion refusée : panne confirmée par le serveur visé", latencyMs: null }),
          availability: { window: "24h", percent: null, measuredSeconds: 600, downSeconds: 600 },
          hours,
        },
        { ...service({ checkedAt: null, latencyMs: null, status: "unknown" }), availability: { window: "24h", percent: null, measuredSeconds: 0, downSeconds: 0 }, hours },
      ],
    }),
  );
  const tiles = html.split("<li>").slice(1).map(text);

  assert.equal(html.match(/<a [^>]*href="\/servers"/g)?.length, 3);
  assert.match(tiles[0], /^Authentification Blizzard En ligne 32 ms · contrôlé il y a 3 minutes Disponibilité sur 24 heures : 92,86 %$/);
  assert.match(tiles[1], /^Serveurs de jeu EU Hors ligne contrôlé il y a 3 minutes 24 heures : échantillon insuffisant$/);
  assert.match(tiles[2], /^Authentification Blizzard Inconnu Aucun contrôle enregistré/);
  // Le constat, absent de la carte, reste en infobulle ; l'heure exacte aussi.
  assert.match(html, /title="Connexion refusée : panne confirmée par le serveur visé"/);
  assert.match(html, /<time datetime="2026-10-08T14:05:09.000Z" title="0?8\/10\/(20)?26 16:05:09">/i);
  // Frise décorative : la disponibilité écrite la double.
  assert.equal(html.match(/class="status-strip mt-3" data-size="sm" aria-hidden="true"/g)?.length, 3);
  assert.equal(html.match(/class="status-cell"/g)?.length, 3 * 24);
  assert.doesNotMatch(html, /style=/);
});
