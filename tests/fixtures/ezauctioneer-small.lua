
-- Fixture synthétique au format réel d'EZAuctioneer 0.4.3 (EZAuctioneerDB, schéma 5), relevé sur
-- les fichiers du 2026-11-19 : mêmes clés, mêmes formes de valeur, valeurs inventées.
-- Cas couverts : relevés dans le désordre, objet à suffixe aléatoire, clé non reconnue, relevé
-- invalide (prix nul), marché sans historique, rapport et résumé du même scan datés à une seconde
-- d'écart, scan rejeté, portefeuille d'un personnage fictif (transmis depuis l'agent 0.11.0), bonne
-- affaire sans type (ignorée).
EZAuctioneerDB = {
["options"] = {
["share"] = 0.25,
["market"] = "auto",
["maxSamples"] = 12,
["minScans"] = 3,
["cut"] = 0.05,
["neutralCut"] = 0.15,
},
["ui"] = {
["point"] = {
"CENTER",
"CENTER",
0,
0,
},
["tab"] = "all",
},
["lastRequest"] = 1795079117,
["markets"] = {
["3:Royaume Test PvE:Alliance:faction"] = {
["history"] = {
["i:2589"] = {
["name"] = "Étoffe de lin",
["link"] = "|cffffffff|Hitem:2589::::::::20:::::::::|h[Étoffe de lin]|h|r",
["id"] = 2589,
["samples"] = {
{
["ts"] = 1795009157,
["p"] = 12,
["units"] = 840,
},
{
["ts"] = 1794915321,
["p"] = 10,
["units"] = 1200,
},
{
["ts"] = 1795079141,
["p"] = 15,
["units"] = 610,
},
},
["lastSeen"] = 1795079141,
},
["i:4306:s1019"] = {
["name"] = "Bottes de l'Ours",
["id"] = 4306,
["samples"] = {
{
["ts"] = 1795079141,
["p"] = 24750,
["units"] = 2,
},
},
["lastSeen"] = 1795079141,
},
["i:13133"] = {
["name"] = "Épaulettes drakefeu",
["id"] = 13133,
["samples"] = {
{
["ts"] = 1795009157,
["p"] = 0,
["units"] = 1,
},
{
["ts"] = 1795079141,
["p"] = 149900,
["units"] = 1,
},
},
["lastSeen"] = 1795079141,
},
["x:1"] = {
["samples"] = {
{
["ts"] = 1795079141,
["p"] = 5,
["units"] = 1,
},
},
},
},
["lastSuccess"] = 1795079141,
["lastSummary"] = {
["ghost"] = 0,
["auctions"] = 174284,
["opportunities"] = 130,
["origin"] = "own",
["at"] = 1795079141,
["items"] = 6744,
["incomplete"] = 0,
["candidates"] = 140,
},
["lastDeals"] = {
{
["key"] = "i:13133",
["cost"] = 49898,
["profit"] = 80000,
["name"] = "Épaulettes drakefeu",
},
},
["depositProbe"] = {
["at"] = 1795079141,
["answered"] = 3,
["api"] = true,
},
},
["3:Royaume Test PvE:neutral"] = {
["history"] = {
},
["lastDeals"] = {
},
},
},
["scanLog"] = {
{
["outcome"] = "ok",
["origin"] = "own",
["market"] = "3:Royaume Test PvE:Alliance:faction",
["startedAt"] = 1795079117,
["endedAt"] = 1795079142,
["auctions"] = 174284,
["items"] = 6744,
["version"] = "0.4.3",
},
{
["outcome"] = "rejected",
["origin"] = "own",
["market"] = "3:Royaume Test PvE:Alliance:faction",
["endedAt"] = 1795020000,
["auctions"] = 10,
},
{
["outcome"] = "ok",
["origin"] = "external",
["market"] = "3:Royaume Test PvE:Alliance:faction",
["endedAt"] = 1795009158,
["auctions"] = 241312,
["items"] = 5981,
},
},
["portfolio"] = {
["3:Royaume Test PvE:Testeur"] = {
["log"] = {
{
["t"] = 1795079248,
["amount"] = 16800,
["key"] = "i:5266",
["kind"] = "buy",
["qty"] = 1,
},
},
["positions"] = {
},
["auctions"] = {
},
["stats"] = {
["sales"] = 0,
["realized"] = 0,
},
},
},
["watch"] = {
},
["schema"] = 5,
}
