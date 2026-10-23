# Contrat de l'API partenaire BedLink v1

Base : `https://app.bedlink.fr/api/partner/v1`. Documentation interactive :
`https://app.bedlink.fr/fr/partner-api/docs`, OpenAPI :
`https://app.bedlink.fr/api/partner/openapi`.

- **[DISPO]** : en ligne dans la sandbox. Les blocs suivis d'un drapeau entre
  parenthèses s'ouvrent partenaire par partenaire (`BEDLINK_FEATURES` côté kit) ;
  tant qu'un bloc n'est pas ouvert pour vous, il répond
  `404 {"error":{"code":"not_found","message":"Endpoint not found."}}`.
- **Logement Atypique** : tout est ouvert en sandbox depuis le 19/10/2026
  (`calendar_366`, `changes`, `webhooks`, `reservations_list`, `messages`,
  `payments`), l'envoi des webhooks depuis le 22/10/2026.
- **Modification des réservations** (`reservations_modify`) : ouverte à
  Logement Atypique en sandbox avec la mise en ligne BedLink du 22/10/2026
  (à ajouter à `BEDLINK_FEATURES` quand BedLink le confirme).
- **Pas encore ouvert** : la clé de production `blp_live_` et le paiement réel.
  En sandbox, le paiement est simulé (aucune carte, aucun appel Stripe).

Principe : **BedLink est la source de vérité, vous êtes un canal de vente**.
Vous gardez une copie pour afficher et chercher ; toute réservation passe par
BedLink (devis → option → paiement → réservation), jamais par votre copie.

## Conventions [DISPO]

| Sujet | Règle |
|---|---|
| Auth | `Authorization: Bearer blp_test_…` (43 caractères après le préfixe). Une clé = tous vos logements reliés. 90 jours. Créée et révoquée dans votre espace `https://app.bedlink.fr/fr/partenaire` |
| Format | JSON, anglais, `camelCase`, corps de 16 Ko maximum |
| Montants | entiers en centimes, devise ISO à côté (`"EUR"`) |
| Dates | `YYYY-MM-DD`, `checkOut` exclusif ; horodatages ISO 8601 UTC |
| `propertyId` | l'identifiant BedLink du logement vendable |
| Erreurs | `{ "error": { "code", "message" }, "requestId" }`, en-tête `X-Request-Id` |
| Limite | 120 appels/minute/clé → `429` + `Retry-After: 60` |
| Compatibilité | BedLink ajoute des champs sans prévenir : **ignorez les champs inconnus** |

Codes d'erreur : `invalid_request` 400, `guest_limit` 400, `invalid_token` 401,
`access_disabled` 403, `sandbox_only` 403, `not_found` 404, `dates_unavailable`
409, `quote_expired` 409, `hold_expired` 409, `hold_used` 409,
`reference_conflict` 409, `channel_not_configured` 409, `rate_limit` 429,
`service_unavailable` 503. [DISPO] `cursor_expired` 410, `payment_required`
409, `payment_unavailable` 409, `reservation_cancelled` 409,
`reservation_started` 409, `price_change_requires_payment` 409.

## Logements

`GET /properties` → `{ "properties": [Property] }` [DISPO]
`GET /properties/{id}` → `Property` [DISPO]

```json
{
  "id": "uuid", "name": "…", "description": "…", "imageUrl": null, "address": "…",
  "maxGuests": 4, "currency": "EUR", "timezone": "Europe/Paris",
  "channel": "…", "environment": "sandbox"
}
```

[DISPO] `checkInFrom` (`"16:00"`), `checkInUntil` (ou null), `checkOutUntil`
(`"10:00"`), `cancellationPolicy`, `securityDepositCents`, `status`,
`connectedAt`, `updatedAt`.

```json
"cancellationPolicy": {
  "type": "tiered",
  "tiers": [ { "daysBefore": 30, "charge": "none" }, { "daysBefore": 7, "charge": "deposit" }, { "daysBefore": 0, "charge": "full" } ],
  "depositPercent": 30, "taxesRefunded": true,
  "summary": { "fr": "Annulation gratuite jusqu'à 30 jours…", "en": "…" }
}
```

`type` : `free` | `non_refundable` | `tiered`. L'hôte gère et rembourse
lui-même : vous affichez, vous n'exécutez rien. Peut valoir `null`.

## Calendrier

`GET /properties/{id}/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD` [DISPO]

Bornes incluses. **365 jours d'écart maximum (366 dates)** avec `calendar_366`, 90 jours sinon.

```json
{ "propertyId": "uuid", "channel": "…", "currency": "EUR", "from": "…", "to": "…",
  "days": [ { "date": "2026-11-01", "priceCents": 14000, "available": true,
    "minNights": 2, "minNightsThrough": null, "maxNights": null,
    "arrivalAllowed": true, "departureAllowed": true } ] }
```

- `priceCents` : prix de votre canal, hors frais et taxes ; `null` = pas vendable.
- `minNights` : minimum pour une arrivée ce jour ; `minNightsThrough` :
  minimum pour tout séjour qui traverse ce jour.
- Un jour « disponible » n'est pas une garantie : seul le devis fait foi.
- Aucune date de modification par jour : datez votre copie vous-même.

## Fil des changements [DISPO] (`changes`)

`GET /changes?cursor=<opaque>&limit=500` : tous vos logements en un appel.

```json
{ "changes": [
    { "id": "chg_…", "kind": "calendar", "propertyId": "uuid", "from": "2026-11-03", "to": "2026-11-05", "occurredAt": "…" },
    { "id": "chg_…", "kind": "property", "propertyId": "uuid", "occurredAt": "…" },
    { "id": "chg_…", "kind": "reservation", "propertyId": "uuid", "reservationId": "uuid", "occurredAt": "…" } ],
  "nextCursor": "c_…", "hasMore": false }
```

- Sans `cursor` : `changes: []` et le curseur de tête (point de départ).
- Vous relisez ce qui a changé ; le fil ne porte pas les données.
- `hasMore: true` → rappeler tout de suite avec `nextCursor`.
- Rétention 30 jours ; curseur trop vieux → `410 cursor_expired` → synchro complète.
- Les réservations des autres canaux n'y apparaissent que sous forme de `calendar`.

## Devis et options [DISPO]

`POST /quotes` `{ propertyId, checkIn, checkOut, adults=2, children=0 }` (1 à 90 nuits) → `201`

```json
{ "id": "uuid", "propertyId": "uuid", "channel": "…", "checkIn": "…", "checkOut": "…",
  "adults": 2, "children": 0, "totalCents": 30000, "currency": "EUR",
  "nights": [ { "date": "…", "priceCents": 14000 } ], "expiresAt": "…" }
```

Valable 5 minutes.

`POST /holds` `{ quoteId, reference }` → `201 { id, quoteId, status: "active", expiresAt }`.
15 minutes ; la nuit est fermée partout (Airbnb, Booking…). `reference` est
unique chez vous : la rejouer à l'identique rend la même option, sans la
prolonger ; la réutiliser avec un autre devis → `409 reference_conflict`.
`DELETE /holds/{id}` → `{ id, status: "released" }`.

## Réservations

`POST /reservations` `{ holdId, externalId, guest: { name, email, phone? }, notes? }` [DISPO]
→ `201` (création), `200` (rejeu identique), `409 reference_conflict` (rejeu différent).
C'est le chemin sandbox, sans paiement en ligne.

`GET /reservations/{id}`, `DELETE /reservations/{id}` (annulation rejouable) [DISPO]

```json
{ "id": "uuid", "externalId": "…", "propertyId": "uuid", "channel": "…",
  "checkIn": "…", "checkOut": "…", "status": "confirmed", "adults": 2, "children": 0,
  "totalCents": 30000, "currency": "EUR",
  "guest": { "name": "…", "email": "…", "phone": "…" }, "notes": null }
```

`status` : `confirmed` | `cancelled` | `completed`. Vous ne voyez **que vos
réservations**, jamais celles des autres canaux.

[DISPO] champs `createdAt`, `updatedAt`, `cancelledBy` (`host` | `partner`),
`payment` :

```json
"payment": { "status": "paid", "amountCents": 30000, "hostAmountCents": 30000,
  "partnerFeeCents": 0, "currency": "EUR", "paidAt": "…", "refundedCents": 0 }
```

`PATCH /reservations/{id}` [DISPO] (`reservations_modify`) : le voyageur change
ses dates ou le nombre de voyageurs. Corps : seulement ce qui change,
`{ checkIn?, checkOut?, adults?, children? }` ; jamais de prix. → `200 Reservation`.

- Seulement **vos** réservations ; toute autre répond `404`.
- BedLink revérifie le séjour comme une création (dispo sans compter la
  réservation elle-même, règles de séjour, capacité) et **recalcule
  `totalCents`** au tarif du jour quand les dates changent. Voyageurs seuls :
  prix inchangé. Affichez le nouveau total au voyageur.
- Renvoyer les valeurs actuelles = `200` sans effet (rejouable).
- Refus : `409 dates_unavailable`, `409 reservation_cancelled`,
  `409 reservation_started` (arrivée passée : l'hôte s'en charge),
  `409 price_change_requires_payment` (payée en ligne et le montant changerait :
  rien n'est débité ni remboursé, voir l'hôte), `400 guest_limit`.
- Suivi : webhooks `reservation.modified` et `availability.changed`.

[DISPO] `GET /reservations?since=<ISO>&cursor=&limit=100` (`reservations_list`) :
vos réservations modifiées depuis `since`, `{ reservations, nextCursor, hasMore }`.

## Messages [DISPO] (`messages`)

Un seul fil par réservation, le même chez BedLink et chez vous.

`POST /reservations/{id}/messages` `{ externalId, sender: "guest" | "host", body, sentAt? }` → `201 Message`
(`externalId` unique : rejouer = même message, `200`). Texte brut, 5 000 caractères.

`GET /reservations/{id}/messages?cursor=` → `{ messages, nextCursor, hasMore }`.

```json
{ "id": "uuid", "reservationId": "uuid", "externalId": "…", "sender": "guest",
  "source": "partner", "body": "…", "createdAt": "…" }
```

`sender` : `guest` | `host` | `system` (message automatique BedLink).
`source` : `partner` (posté par vous) | `bedlink` (écrit dans BedLink, reçu
aussi par le webhook `message.created`). Ne renvoyez jamais un message
`source: bedlink` : ce serait une boucle.

## Paiement [DISPO] (`payments`) — simulé en sandbox, réel pas encore ouvert

Débit unique sur le compte Stripe de l'hôte, via une page de paiement BedLink
intégrée chez vous (« Powered by BedLink »), repli en redirection. Votre site
ne voit jamais la carte et ne charge pas Stripe.js.

`POST /payment-sessions`

```json
{ "holdId": "uuid", "externalId": "…", "guest": { "name": "…", "email": "…", "phone": "…" },
  "notes": "…", "returnUrl": "https://…/merci", "cancelUrl": "https://…" }
```

→ `201`

```json
{ "id": "ps_…", "status": "open", "embedUrl": "https://app.bedlink.fr/pay/ps_…?embed=1",
  "url": "https://app.bedlink.fr/pay/ps_…", "amountCents": 30000, "hostAmountCents": 30000,
  "partnerFeeCents": 0, "currency": "EUR", "expiresAt": "…" }
```

- `amountCents = hostAmountCents + partnerFeeCents`. Tout est débité chez
  l'hôte ; `partnerFeeCents` (0 pendant le pilote) sert à votre facturation
  mensuelle de l'hôte.
- Une fois payé, BedLink crée la réservation et envoie `reservation.confirmed`.
- La page poste à la fenêtre parente `{ type: "bedlink:payment", status, sessionId, reservationId? }`
  depuis `https://app.bedlink.fr` : simple confort d'affichage. **Seuls le
  webhook ou `GET /payment-sessions/{id}` font foi.**
- Option expirée ou nuit perdue entre-temps : BedLink rembourse et ne crée rien.

`GET /payment-sessions/{id}` → `{ id, status: "open" | "processing" | "succeeded" | "failed" | "expired", reservationId, … }`.

## Connexion des logements par l'hôte [À VENIR] (`connect`)

Le bouton « Connecter mon BedLink » sur votre site. L'association entre vos
annonces et ses logements BedLink se fait chez BedLink, sous les yeux de l'hôte.

1. **Votre serveur** : `POST /connect-sessions`
   ```json
   { "host": { "ref": "votre-id-hote", "email": "hote@exemple.fr", "name": "Marie" },
     "listings": [ { "id": "votre-id-annonce", "name": "Chalet des Dunes", "url": "https://…" } ],
     "returnUrl": "https://logement-atypique.fr/bedlink/retour", "locale": "fr" }
   ```
   Réponse `201` : `{ "id": "cs_…", "url": "https://app.bedlink.fr/fr/connecter/cs_…", "status": "pending", "expiresAt": "…" }`.
   Lien valable 30 minutes : redirigez l'hôte vers `url`.
2. **Chez BedLink** : l'hôte se connecte ou crée son compte, choisit pour
   chaque annonce le logement BedLink correspondant (ou « ne pas relier »), valide.
   Un compte tout neuf doit d'abord ajouter son logement : il reviendra par votre bouton.
3. **Retour** sur `returnUrl?session=cs_…&status=connected` (ou `cancelled`).
   Lisez le résultat avec votre clé : `GET /connect-sessions/{id}` →
   `{ "status": "completed", "connections": [ { "listingId": "…", "propertyId": "uuid" | null } ] }`.
   Vous recevez aussi un webhook `property.connected` par logement, avec `listingId`.
   `GET /properties` renvoie `listingId` sur chaque logement.
4. **Import** de ce que vous avez déjà, juste après :
   `POST /properties/{propertyId}/reservations/import`, 100 au plus par appel :
   ```json
   { "reservations": [ { "externalId": "LA-123", "checkIn": "2026-12-20", "checkOut": "2026-12-23",
       "adults": 2, "children": 0, "guest": { "name": "…", "email": "…", "phone": "…" },
       "totalCents": 42000, "currency": "EUR", "status": "confirmed" } ] }
   ```
   Chaque ligne répond `created`, `updated`, `cancelled`, `unchanged`, `skipped`
   (séjour passé, ou annulée jamais importée) ou `error`, avec l'`id` BedLink.
   Rejouer est sans risque (par `externalId`). Une réservation n'est **jamais**
   refusée pour indisponibilité : si ses nuits sont déjà prises chez BedLink, elle
   est créée avec `conflict: true` et l'hôte est alerté. Les nuits se ferment sur
   Airbnb et Booking.
   Puis les messages : `POST /reservations/{id}/messages` avec `sentAt` (jusqu'à
   3 ans pour une réservation importée ; plus d'une heure = historique, sans
   notifier l'hôte).
5. **Depuis BedLink** : dans BedLink → Plateformes, l'hôte clique « Connecter
   Logement Atypique ». BedLink l'envoie sur
   `https://logement-atypique.fr/bedlink/connecter?bedlink_return=<url BedLink>`
   (page à créer chez vous). Vous l'identifiez (connexion à son compte chez vous
   s'il ne l'est pas), puis vous faites exactement l'étape 1 avec
   `returnUrl` = la valeur de `bedlink_return`, et vous le redirigez vers l'`url`
   reçue. Il choisit ses logements chez BedLink et revient dans BedLink.
   N'acceptez comme `bedlink_return` qu'une adresse `https://app.bedlink.fr/…`.
6. **Déconnexion** : `DELETE /properties/{propertyId}/connection` chez vous, ou
   par l'hôte dans BedLink → Plateformes. Webhook `property.disconnected`.

Clé de test : seuls les comptes de test BedLink se relient. En production,
l'accès d'un logement s'ouvre après validation par BedLink.

## Webhooks [DISPO] (`webhooks`)

Voir `webhooks.md`.
