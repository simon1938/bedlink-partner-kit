# Le tunnel branché sur l'API partenaire BedLink, étape par étape

Base : `https://app.bedlink.fr/api/partner/v1`, en-tête
`Authorization: Bearer blp_test_…` (côté serveur seulement). Contrat complet :
`references/contract.md` de la skill `bedlink-integration`. Documentation
interactive : https://app.bedlink.fr/fr/partner-api/docs.

Rien ici n'est nouveau : chaque appel existe déjà dans l'API (sandbox ouverte à
Logement Atypique depuis le 19/10/2026, location à la journée depuis le
28/10/2026). Montants en centimes, dates `YYYY-MM-DD`, `checkOut` exclusif.

## Sandbox d'abord

- Clé `blp_test_…` créée dans l'espace partenaire : https://app.bedlink.fr/fr/partenaire.
- Compte de test : « Logement Test » (6 pers.) et « Chalet des Dunes » (4 pers.,
  2 nuits minimum). La location à la journée est allumée sur le compte de test
  de Logement Atypique.
- `BEDLINK_FEATURES` contient `payments` : la page de paiement est **simulée**
  (bouton « paiement réussi », aucune carte, aucun appel Stripe), puis BedLink
  crée la réservation comme en réel. Sans `payments`, la sandbox confirme tout
  de suite (`POST /reservations`), utile pour monter les écrans.
- Paiement réel et clé `blp_live_` : pas encore ouverts. Rien à changer dans le
  code le jour venu, sauf la clé.

## Étape 1 : dates (nuit)

**Calendrier** : la copie locale `bedlink_calendar_days`, tenue à jour par
l'intégration (webhook `availability.changed`, fil `/changes`, cron). Action
`loadCalendar` ; si la copie est vide (synchro jamais lancée), elle lit
`GET /properties/{id}/calendar?from=&to=` (90 jours par appel, 366 avec
`calendar_366`). Champs utilisés : `available` (la NUIT de ce jour),
`arrivalAllowed`, `departureAllowed`, `minNights`, `minNightsThrough`,
`maxNights`. Le `priceCents` n'est **pas** affiché dans le tunnel.

**Devis**, dès que l'arrivée et le départ sont posés, et à chaque changement
de voyageurs : action `quoteNights` → `booking.startCheckout` →

```
POST /quotes { propertyId, checkIn, checkOut, adults, children }   (1 à 90 nuits)
→ 201 { id, totalCents, currency, nights: [{ date, priceCents }], expiresAt }  (5 min)
```

Le récap affiche `nights` (somme) et `totalCents`. Le devis crée une ligne
`bedlink_checkouts` avec votre `externalId` (préfixe `BEDLINK_EXTERNAL_ID_PREFIX`).

Erreurs : `409 dates_unavailable` (dates effacées, message), `400 guest_limit`,
`400 invalid_request`.

## Étape 1 bis et 2 : jour et créneau (journée, soirée)

Ouvert par BedLink partenaire par partenaire (`formules`) ; le logement doit
avoir la location à la journée allumée par l'hôte.

```
GET /properties/{id}/formules
→ { formules: [{ id, name, description, slots: [{ id, label, start, end, priceCents }],
                 capacity, nightIncluded, days, minNoticeHours, active }] }
GET /properties/{id}/creneaux?from=&to=          (62 jours au plus)
→ { slots: [{ date, formuleId, slotId, label, start, end, startAt, endAt, priceCents, currency }] }
```

Seuls les créneaux **libres** reviennent (jamais pendant un séjour, jamais déjà
pris, jamais trop tôt, jamais un jour fermé) : le calendrier ne propose que les
jours qui en ont. Nuit / Journée / Soirée n'existe pas chez BedLink : le tunnel
classe un créneau en Soirée s'il commence à 17:00 ou après (`kindOfSlot`,
réglable). `409 day_rental_disabled` ou un 404 « Endpoint not found. » = pas de
location à la journée : le choix du type disparaît.

Créneau choisi : action `quoteSlot` →

```
POST /creneaux/quotes { propertyId, formuleId, slotId, date, guests }
→ { available, totalCents, currency, startAt, endAt, nightIncluded }
```

Rien n'est gardé. **Aucune majoration de canal** : le prix est celui de la
formule. Erreurs : `409 capacity_exceeded`, `409 slot_unavailable`.

## Étape 3 : extras

Aucun appel. Le catalogue est celui du partenaire (`getListing().extras`). Les
prix sont relus côté serveur dans `startPayment`. Ils ne sont pas payés en
ligne : ils partent dans `notes` (« Extras demandés sur Logement Atypique, à
régler sur place : … »), 2 000 caractères au plus avec le message du voyageur.

## Étape 4 : coordonnées

Aucun appel. `guest = { name: "Prénom Nom", email, phone }`.

## Étape 5 : paiement et option de 15 minutes

Déclenché quand le voyageur coche les conditions. Action `startPayment`.

**Nuit** (`booking.holdCheckout` puis `booking.payCheckout`) :

```
POST /holds { quoteId, reference }            → 201 { id, status: "active", expiresAt }   (15 min)
POST /payment-sessions { holdId, externalId, guest, notes, returnUrl, cancelUrl? }
→ 201 { id: "ps_…", status: "open", embedUrl, url, amountCents, hostAmountCents, partnerFeeCents, currency, expiresAt }
```

Si le devis a plus de 5 minutes, `holdCheckout` refait un devis : le prix peut
changer, le tunnel l'annonce (« Le tarif a été recalculé »). Dès l'option, les
nuits sont fermées partout (Airbnb, Booking…).

**Créneau** (`dayRental.reserve`) :

```
POST /creneaux/reservations { propertyId, formuleId, slotId, date, guests, externalId,
                              guest, notes, payment: { returnUrl, cancelUrl? } }
→ 201 { id, status: "pending_payment", totalCents, payment: { id: "pc_…", url, embedUrl, expiresAt } }
```

Rejouer le même `externalId` rend la même réservation (200).

**La page de paiement** : `PaymentFrame` affiche `embedUrl` (repli : lien vers
`url`). Carte saisie chez BedLink, sur le compte Stripe Connect de l'hôte ; le
site ne voit rien. Cliquer « Payer » prolonge l'option de 10 minutes (plafond
30 minutes). La page poste à la fenêtre parente, depuis `https://app.bedlink.fr`
et vers l'**origine de `returnUrl`** :
`{ type: "bedlink:payment", status: "succeeded" | "failed" | "expired", sessionId, reservationId? }`.
Après un succès, elle propose « Continuer », qui ouvre `returnUrl` en plein
écran (`/reserver/merci?ref=…`).

**Retour** pendant le paiement : action `release` → `DELETE /holds/{id}` (nuit)
ou `DELETE /creneaux/reservations/{id}` (créneau en attente) : les dates se
rouvrent tout de suite.

Erreurs : `409 hold_expired`, `409 quote_expired`, `409 payment_unavailable`
(hôte sans Stripe Connect), `409 dates_unavailable`, `409 slot_unavailable`.

## Étape 6 : confirmation

Ce qui fait foi, jamais le message du navigateur (action `bookingStatus`,
`lib/tunnel/status.ts`) :

```
GET /payment-sessions/{id}   → { status: open | processing | succeeded | failed | expired, reservationId }
GET /reservations/{id}       → la réservation (status confirmed, payment.status paid)
GET /creneaux/reservations/{id} → { status: pending_payment | confirmed | cancelled | expired, … }
```

Webhook `reservation.confirmed` pour un séjour (rien de dédié pour un créneau :
seulement `availability.changed` sur le jour). `failed` = carte refusée, la
page BedLink laisse réessayer : le tunnel reste en attente. Option échue ou nuit
perdue entre-temps : BedLink rembourse et ne crée rien (`expired`).

À la première confirmation vue (tunnel, page de retour, webhook ou cron),
`confirmAndNotify` envoie l'e-mail au voyageur et celui à l'hôte, une seule fois.

## Ce qui n'existe pas (ne pas l'inventer)

- un endpoint d'extras, ou des extras dans `POST /payment-sessions` ;
- un réglage des couleurs de la page `/pay/…` ;
- un lien direct vers la réservation dans le tableau de bord BedLink ;
- un webhook de confirmation de créneau.
