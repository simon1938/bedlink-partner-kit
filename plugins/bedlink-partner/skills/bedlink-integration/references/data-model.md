# Ce que vous stockez chez vous

Sept tables, toutes préfixées `bedlink_`, identiques dans les trois gabarits
(`templates/schema/bedlink.sql`, `drizzle.ts`, `prisma.prisma`). Le code du kit
(`lib/bedlink/store.ts`) les lit et les écrit en SQL paramétré.

« Origine » dit qui remplit le champ : un endpoint BedLink, un webhook, ou
vous. [PRÉVU] = champ que BedLink ne renvoie pas encore (reste `null`).

## `bedlink_properties` : logements reliés

| Champ | Type | Origine | Usage |
|---|---|---|---|
| `bedlink_property_id` | uuid PK | `Property.id` | clé de tous les appels |
| `listing_id` | text unique, null | **vous** | lien avec votre fiche (photos, textes) |
| `name` | text | `Property.name` | contrôle, back-office |
| `currency` | text | `Property.currency` | affichage des prix |
| `timezone` | text | `Property.timezone` | « aujourd'hui » du logement |
| `max_guests` | int null | `Property.maxGuests` | filtre de recherche |
| `check_in_from` | text null | `Property.checkInFrom` [PRÉVU] | affichage |
| `check_in_until` | text null | `Property.checkInUntil` [PRÉVU] | affichage |
| `check_out_until` | text null | `Property.checkOutUntil` [PRÉVU] | affichage |
| `cancellation_policy` | jsonb null | `Property.cancellationPolicy` [PRÉVU] | affichage avant paiement |
| `environment` | text | `Property.environment` | ne jamais mélanger sandbox et production |
| `status` | text | `active` / `disconnected` (liste, `property.*`) | retirer de la vente |
| `connected_at` | timestamptz | 1re vue ou `property.connected` | suivi |
| `disconnected_at` | timestamptz null | `property.disconnected` ou absent de la liste | suivi |
| `calendar_until` | date null | vous | dernier jour lu ; chaque jour, un jour de plus entre dans la fenêtre de 366 jours |
| `last_full_sync_at` | timestamptz null | vous | null = à lire en entier au prochain cron |
| `updated_at` | timestamptz | vous | |

## `bedlink_calendar_days` : la copie du calendrier

Clé (`bedlink_property_id`, `date`). Environ 1,5 million de lignes pour
4 000 logements × 366 jours. Index (`date`, `available`) pour la recherche.

| Champ | Type | Origine | Usage |
|---|---|---|---|
| `date` | date | `CalendarDay.date` | |
| `price_cents` | int null | `priceCents` | prix « à partir de » (le devis fait foi) |
| `available` | bool | `available` | recherche par dates |
| `min_nights` | int | `minNights` | séjour minimum pour une arrivée ce jour |
| `min_nights_through` | int null | `minNightsThrough` | séjour minimum pour tout séjour qui traverse ce jour |
| `max_nights` | int null | `maxNights` | |
| `arrival_allowed` | bool | `arrivalAllowed` | dates d'arrivée proposables |
| `departure_allowed` | bool | `departureAllowed` | dates de départ proposables |
| `synced_at` | timestamptz | **vous**, à l'écriture | fraîcheur de la copie (BedLink ne date pas les jours) |

Une recherche « libre du 3 au 5 » se fait sur cette table (toutes les nuits
`available`, `arrival_allowed` le 3, `departure_allowed` le 5, `min_nights`
respecté) ; le devis confirme ensuite.

## `bedlink_sync_state` : état de la synchro (une ligne `id = 'default'`)

| Champ | Type | Origine | Usage |
|---|---|---|---|
| `changes_cursor` | text null | `nextCursor` de `/changes` [PRÉVU] | reprendre où on s'est arrêté |
| `reservations_since` | timestamptz null | max `Reservation.updatedAt` vu [PRÉVU] | rattrapage des réservations |
| `last_full_sync_at` | timestamptz null | vous | |
| `last_poll_at` | timestamptz null | vous | surveiller que le cron tourne |
| `locked_until` | timestamptz null | vous | une seule synchro à la fois |
| `last_error` | text null | vous | diagnostic (code et `requestId` BedLink) |

## `bedlink_webhook_events` : journal des webhooks reçus

| Champ | Type | Origine | Usage |
|---|---|---|---|
| `event_id` | text PK | `id` / `BedLink-Event-Id` | **idempotence** |
| `type` | text | `type` | |
| `created_at` | timestamptz | `createdAt` | |
| `received_at` | timestamptz | vous | purge à 30 jours |
| `processed_at` | timestamptz null | vous | null = à retraiter |
| `error` | text null | vous | |
| `payload` | jsonb | corps | diagnostic (contient des données voyageur) |

## `bedlink_checkouts` : tentatives de réservation en cours

| Champ | Type | Origine | Usage |
|---|---|---|---|
| `external_id` | text PK | **vous**, créé au devis | votre référence ; sert aussi de `reference` d'option et d'`externalId` de réservation : chaque nouvel essai est sans doublon |
| `bedlink_property_id` | uuid | vous | |
| `check_in`, `check_out` | date | vous | |
| `adults`, `children` | int | `Quote` | |
| `quote_id`, `quote_expires_at` | uuid, timestamptz | `Quote` | |
| `total_cents`, `currency` | int, text | `Quote` | montant montré au voyageur |
| `hold_id`, `hold_expires_at` | uuid, timestamptz | `Hold` | |
| `payment_session_id` | text null | `PaymentSession.id` [PRÉVU] | |
| `status` | text | vous : `quoted` → `held` → `paying` → `confirmed` / `failed` / `expired` / `released` | |
| `bedlink_reservation_id` | uuid null | `Reservation.id` | |

## `bedlink_reservations` : vos réservations

| Champ | Type | Origine | Usage |
|---|---|---|---|
| `bedlink_reservation_id` | uuid PK | `Reservation.id` | |
| `external_id` | text unique | `externalId` | lien avec votre commande |
| `bedlink_property_id` | uuid | `propertyId` | |
| `status` | text | `status` | |
| `check_in`, `check_out` | date | | |
| `adults`, `children` | int | | |
| `total_cents`, `currency` | int, text | | |
| `guest_name`, `guest_email`, `guest_phone` | text | `guest` (vient de vous à la création) | |
| `notes` | text null | `notes` | |
| `payment_status` | text null | `payment.status` [PRÉVU] | |
| `host_amount_cents` | int null | `payment.hostAmountCents` [PRÉVU] | |
| `partner_fee_cents` | int null | `payment.partnerFeeCents` [PRÉVU] | votre facture mensuelle à l'hôte |
| `paid_at` | timestamptz null | `payment.paidAt` [PRÉVU] | |
| `cancelled_by` | text null | `cancelledBy` [PRÉVU] | |
| `bedlink_created_at`, `bedlink_updated_at` | timestamptz null | `createdAt`, `updatedAt` [PRÉVU] | rattrapage |
| `synced_at` | timestamptz | vous | |

## `bedlink_messages` : le fil [PRÉVU]

| Champ | Type | Origine | Usage |
|---|---|---|---|
| `bedlink_message_id` | uuid PK | `Message.id` | |
| `bedlink_reservation_id` | uuid | `reservationId` | |
| `external_id` | text unique null | vous, à l'envoi | idempotence de l'envoi |
| `sender` | text | `guest` / `host` / `system` | |
| `source` | text | `partner` / `bedlink` | ne pas renvoyer chez BedLink ce qui en vient |
| `body` | text | | |
| `created_at` | timestamptz | `createdAt` | ordre du fil |
