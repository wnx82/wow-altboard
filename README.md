# WoW AltBoard — synchronisation et tableau de bord

Centralise dans PostgreSQL les données de l'addon World of Warcraft **AltBoard** et les présente
dans un tableau de bord web privé : tous les personnages de tous les comptes, depuis tous les PC.
Les prix de l'hôtel des ventes (addon **Auctionator**) et les recettes connues (addon
**NaowhForever**) alimentent un moteur économique : marché, rentabilité des crafts, farm et
opportunités ([ECONOMY-ENGINE](docs/ECONOMY-ENGINE.md)). L'addon **Baganator** ajoute le courrier,
les ventes en cours et les banques de guilde : la page Inventaires montre tout ce que possèdent les
personnages, et la page Équipement y cherche le meilleur équipement pour une classe à un niveau.

En production : **https://wow.ekreativ.be**

```text
PC Windows ── AltBoardSync.exe sync ──► POST /api/sync ──► PostgreSQL ──► tableau de bord
   (WTF\Account\*\SavedVariables\AltBoard.lua)   HTTPS + jeton        base dédiée      wow.ekreativ.be
```

La synchronisation est **manuelle** : rien n'est lu ni envoyé tant que la commande n'est pas lancée.

## Contenu du dépôt

| Dossier | Rôle | Technologies |
|---|---|---|
| `agent/` | Agent Windows : découverte des comptes, lecture stable, parser Lua, envoi | .NET 10, C#, xUnit |
| `web/` | API de synchronisation, tableau de bord, export Excel | Next.js 16, React 19, TypeScript, Drizzle, PostgreSQL |
| `deploy/` | Composition Docker de production | Docker Compose |
| `tests/fixtures/` | Fichiers AltBoard réels anonymisés et cas limites, partagés par les deux projets | |
| `tools/` | Anonymisation de fichiers AltBoard.lua, génération des fixtures de l'économie | Node.js |
| `docs/` | Documentation | |

## Démarrage local

Prérequis : .NET SDK 10, Node.js 24, Docker.

```bash
# 1. PostgreSQL 17 local (port 35432, bases wow_altboard et wow_altboard_test)
docker compose -f docker-compose.dev.yml up -d

# 2. Application web
cd web
cp .env.example .env.local
npm install
npm run db:migrate
npm run admin:create -- vous@exemple.test      # compte d'accès au tableau de bord
npm run token:create -- "Mon PC"               # jeton d'agent, affiché une seule fois
npm run dev                                    # http://localhost:3000

# 3. Agent
cd ../agent
dotnet run --project src/AltBoardSync -- config set serverUrl http://localhost:3000/api/sync
dotnet run --project src/AltBoardSync -- token set
dotnet run --project src/AltBoardSync -- sync
```

## Vérifications

```bash
cd agent && dotnet test
cd web && npm run typecheck && npm run lint && npm test && npm run build
```

GitHub Actions relance ces contrôles à chaque push et à chaque pull request, construit l'image Docker
et publie l'exécutable de l'agent en artefact : voir `.github/workflows/ci.yml`.

Les tests web vident la base `wow_altboard_test`. Le code refuse toute base dont le nom ne commence
pas par `wow_altboard` : voir `web/src/db/env.ts`.

## Documentation

| Document | Sujet |
|---|---|
| [CHANGELOG](CHANGELOG.md) | Versions du site et de l'agent, et ce qu'elles changent |
| [ROADMAP](docs/ROADMAP.md) | État d'avancement, phase par phase |
| [TODO](docs/TODO.md) | À faire : idées de fonctions et constats de l'audit du 2026-10-11 |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Composants, flux, décisions |
| [ALTBOARD-DATA-MODEL](docs/ALTBOARD-DATA-MODEL.md) | Structure réellement observée de `AltBoardDB` |
| [LEDGER-DATA-MODEL](docs/LEDGER-DATA-MODEL.md) | Temps de jeu par niveau et sessions, issus de l'addon Allemano Ledger |
| [AUCTIONATOR-DATA-MODEL](docs/AUCTIONATOR-DATA-MODEL.md) | Prix de l'hôtel des ventes relevés par l'addon Auctionator |
| [PROFESSIONS-DATA-MODEL](docs/PROFESSIONS-DATA-MODEL.md) | Recettes connues par personnage, relevées par l'addon NaowhForever |
| [BAGANATOR-DATA-MODEL](docs/BAGANATOR-DATA-MODEL.md) | Courrier, ventes en cours et banques de guilde relevés par l'addon Baganator |
| [ECONOMY-ENGINE](docs/ECONOMY-ENGINE.md) | Règles du moteur économique : prix, confiance, craft, farm, opportunités, assistant |
| [DATABASE](docs/DATABASE.md) | Schéma PostgreSQL, identifiants, snapshots |
| [API](docs/API.md) | Contrat de `POST /api/sync` et des autres routes |
| [AGENT](docs/AGENT.md) | Installation, commandes, surveillance, fenêtre et démarrage avec Windows |
| [SERVER-STATUS](docs/SERVER-STATUS.md) | État des serveurs WoW Forever EU : sondes, configuration, limites, diagnostic |
| [SECURITY](docs/SECURITY.md) | Authentification, validation, confidentialité |
| [DEPLOYMENT](docs/DEPLOYMENT.md) | Mise en production, domaine, migrations |

## Limites connues

- AltBoard n'écrit ses données qu'au `/reload`, à la déconnexion ou à la fermeture du jeu, et
  seulement pour le personnage connecté. Le tableau de bord montre la **dernière donnée connue**,
  jamais du temps réel.
- Le source de l'addon (tous droits réservés) n'est pas versionné ici.
