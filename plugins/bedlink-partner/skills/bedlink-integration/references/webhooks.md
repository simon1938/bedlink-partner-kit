# Webhooks BedLink [DISPO]

Un webhook dit « il y a du nouveau ». Il **complète** le fil des changements
et le cron, il ne les remplace pas : un webhook peut se perdre, le cron
rattrape toujours.

**Délai** : ouvert depuis le 22/10/2026. Un événement part dans la seconde
qui suit le geste (votre appel, une réservation Airbnb/Booking/Expedia, un
changement de calendrier dans BedLink). Ce qui est fait ailleurs dans BedLink
(annulation ou réponse de l'hôte) part en moins d'une minute. Un envoi raté
est relancé (voir plus bas).

## Réglage

Dans votre espace partenaire : l'URL (`https://<votre-domaine>/api/bedlink/webhook`)
et le secret `whsec_…`, affiché une fois. Rangez-le dans
`BEDLINK_WEBHOOK_SECRET` (serveur uniquement). Pendant une rotation, deux
secrets sont valables 24 h : `BEDLINK_WEBHOOK_SECRET="whsec_nouveau,whsec_ancien"`.

La skill génère aussi un secret **local** (`whsec_local_…`) : il sert au test
de votre route par `check.mjs`, sans passer par BedLink.

## Requête reçue

```
POST /api/bedlink/webhook
Content-Type: application/json
BedLink-Signature: t=1760882531,v1=5257a869e7ecebeda32affa62cdca3fa51cad7e77a0e56ff536d0ce8e108d8bd
BedLink-Event-Id: evt_01JA…
BedLink-Event-Type: availability.changed
```

```json
{ "id": "evt_01JA…", "type": "availability.changed", "createdAt": "2026-10-19T14:02:11Z",
  "apiVersion": "2026-10-19", "environment": "sandbox",
  "data": { "propertyId": "uuid", "from": "2026-11-03", "to": "2026-11-05" } }
```

## Vérifier (déjà écrit dans `lib/bedlink/webhook-signature.ts`)

1. Lire le corps **brut** (`await request.text()`), avant tout `JSON.parse`.
2. Extraire `t` et chaque `v1` de `BedLink-Signature`.
3. Refuser si `|maintenant - t| > 300` secondes (rejeu d'un vieux message).
4. Calculer `HMAC-SHA256(secret, "<t>.<corps brut>")` en hexadécimal.
5. Comparer **en temps constant** (`crypto.timingSafeEqual`), jamais avec `===`.
6. Dédupliquer sur `id` (`bedlink_webhook_events`) : déjà traité → `200` sans rien refaire.
7. Répondre `2xx` en moins de 10 secondes. Tout le reste est relancé.

## Relances

1 min, 5 min, 30 min, 2 h, 6 h, 12 h, puis toutes les 24 h pendant 3 jours.
Ensuite l'URL est désactivée. Ordre non garanti, livraison au moins une fois.

## Événements

| Type | `data` | Ce que fait le kit |
|---|---|---|
| `property.connected` | `{ propertyId }` | lit la fiche et 366 jours de calendrier |
| `property.disconnected` | `{ propertyId }` | retire le logement de la vente, efface son calendrier local |
| `availability.changed` | `{ propertyId, from, to }` | **signal seul** : relit le calendrier sur la plage auprès de BedLink |
| `reservation.confirmed` | `{ reservation }` | enregistre la réservation, clôt la tentative (`bedlink_checkouts`) |
| `reservation.cancelled` | `{ reservation }` | met à jour le statut (annulée par l'hôte ou par vous) |
| `reservation.modified` | `{ reservation }` | met à jour dates, voyageurs, montant |
| `message.created` | `{ reservationId, message }` | ajoute le message au fil (réponse de l'hôte ou message automatique) |
| `ping` | `{}` | rien (bouton « Tester » de l'espace partenaire, et `check.mjs`) |

Type inconnu : `200`, rien d'autre. BedLink peut en ajouter.
