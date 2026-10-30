---
name: bedlink-tunnel
description: Construit le tunnel de réservation directe d'un partenaire BedLink (Next.js App Router) à ses couleurs, sur l'API partenaire BedLink - calendrier de période, type de séjour Nuit / Journée / Soirée, créneau, extras en photos, coordonnées, paiement intégré avec option de 15 minutes, confirmation, e-mails voyageur et hôte. Composants React de référence tirés des sites directs BedLink, jetons de design en variables CSS, recette finale. À utiliser quand on demande de créer, adapter, habiller ou vérifier le tunnel ou la page de réservation, le parcours de paiement, ou les e-mails de confirmation de réservation BedLink.
argument-hint: "[install | recette]"
---

# Tunnel de réservation BedLink

> **Dossier de la skill.** Sous Claude Code, `${CLAUDE_SKILL_DIR}` est remplacé
> automatiquement. Sous Cursor, lis-le comme le chemin du dossier qui contient
> ce fichier (par défaut `.cursor/skills/bedlink-tunnel`).

Tu construis, dans le projet courant, la page où le voyageur réserve et paie un
logement relié à BedLink. Le dessin est **déjà validé** (croquis du 30/10/2026,
`references/croquis.html`, à ouvrir dans un navigateur) : tu l'adaptes aux
couleurs, aux polices et au logo du partenaire, tu ne réinventes pas le parcours.

BedLink est la source de vérité : il donne les nuits libres, **le seul prix qui
compte (le devis)**, garde les dates 15 minutes, encaisse sur le compte Stripe
de l'hôte et crée la réservation. Le site affiche, collecte et accompagne.

Argument : `recette` va directement à l'étape 9. Sinon : installation complète.

## Fichiers (à lire quand l'étape le demande)

- `references/croquis.html` : la référence visuelle et le parcours, cliquable.
- `references/api-par-etape.md` : quel appel BedLink à chaque étape, réponses, erreurs, sandbox.
- `references/design.md` : jetons de design, règles d'ergonomie, ce qui vient de quel site.
- `references/recette.md` : la recette finale, case par case.
- `templates/components/tunnel/` : les composants (`BookingTunnel.tsx` les assemble).
- `templates/styles/tunnel.css` : tout le style, jetons en tête.
- `templates/app/reserver/` : actions serveur, page d'exemple, page de retour.
- `templates/lib/bedlink/day-rental.ts` : formules et créneaux (location à la journée).
- `templates/lib/tunnel/` : table du tunnel, e-mails, statut, ce que le partenaire branche (`config.ts`).
- `templates/schema/tunnel.sql` : la table `tunnel_bookings`.

## Règles qui ne se discutent pas

1. **Le prix vient uniquement du devis BedLink** (`POST /quotes`, `POST /creneaux/quotes`).
   Jamais de prix par jour dans le calendrier, jamais de total calculé par le
   site, jamais de frais de ménage ou de taxe inventés. Le prix n'apparaît
   qu'une fois les dates posées (« Tarif vérifié en direct »).
2. **Rien n'est réservé depuis la copie locale.** Elle sert à griser le
   calendrier ; seule la réponse de BedLink dit « réservé ».
3. **Aucun appel BedLink depuis le navigateur.** Tout passe par les actions
   serveur de `app/reserver/actions.ts`. Le composant ne reçoit que des données.
4. **La carte ne passe jamais par le site.** Le paiement se fait dans la page
   BedLink intégrée (`PaymentFrame`, iframe `embedUrl`), sur le Stripe Connect
   de l'hôte. Ne charge pas Stripe.js, ne simule pas un formulaire de carte.
5. **Confirmé = BedLink l'a dit** (`GET /payment-sessions/{id}` ou webhook
   `reservation.confirmed`, `GET /creneaux/reservations/{id}` pour un créneau).
   Le message posté par la page de paiement n'est qu'un confort d'affichage.
6. **Conditions (CGV) obligatoires** : case à cocher avant que la page de
   paiement s'affiche, lien vers les conditions du partenaire et l'annulation
   de l'hôte (`cancellationPolicy.summary`).
7. **BedLink n'apparaît qu'à un endroit** : « Paiement sécurisé · Powered by
   BedLink » sous le paiement. Et le bouton « Ouvrir dans BedLink » de
   l'e-mail à l'hôte (validé).
8. **Ne jamais inventer une information du logement** (capacité, équipement,
   prix, horaires). Ce qui manque s'écrit « à confirmer » et se demande.
9. **Extras** : ils viennent du catalogue du partenaire. L'API BedLink ne les
   encaisse pas encore : ils s'affichent « à régler sur place », hors du total
   payé, et partent à l'hôte dans les `notes` de la réservation et dans son
   e-mail. Ne les ajoute jamais au montant payé en ligne.
10. Clé, secrets, `BEDLINK_FEATURES` : mêmes règles que la skill
    `bedlink-integration` (jamais dans la conversation, jamais `NEXT_PUBLIC_`).

## L'ordre du tunnel (une seule page, en étapes)

| # | Étape | Ce que voit le voyageur | Appel BedLink (côté serveur) |
|---|---|---|---|
| 1 | Dates + type | Fiche, type de séjour (Nuit par défaut, Journée, Soirée), calendrier, voyageurs | copie `bedlink_calendar_days` ; dès l'arrivée et le départ posés : `POST /quotes` |
| 1 bis | Jour (journée, soirée) | Calendrier à un jour : seuls les jours avec un créneau libre | `GET /properties/{id}/formules` + `GET /properties/{id}/creneaux` |
| 2 | Créneau (journée, soirée) | Formules du jour, créneaux libres | `POST /creneaux/quotes` |
| 3 | Extras | Grille de cartes photo, un toucher l'ajoute au récap | aucun (catalogue du partenaire) |
| 4 | Coordonnées | Prénom, nom, e-mail, téléphone, message à l'hôte | aucun |
| 5 | Paiement | Case CGV, puis minuteur 15 min et page de paiement intégrée | nuit : `POST /holds` puis `POST /payment-sessions` ; créneau : `POST /creneaux/reservations` avec `payment` |
| 6 | Confirmation | Référence, récap « Payé », la suite | `GET /payment-sessions/{id}` ou `GET /creneaux/reservations/{id}` ; e-mails |

L'étape Extras disparaît s'il n'y a aucun extra pour ce logement ; le choix du
type disparaît si le logement n'a aucune formule. Le détail des appels, des
réponses et des erreurs : `references/api-par-etape.md`.

## Les règles d'ergonomie (tirées de nos sites qui tournent)

- **Calendrier** (Chalet WHA, Parenthèse Normande) : deux mois côte à côte
  quand c'est large, un sur téléphone. Premier clic = arrivée, second = départ.
  **Demi-case** : le premier jour d'une période prise est à demi teinté et
  reste cliquable comme départ (on part le matin, le suivant arrive le soir).
  **Un départ est interdit s'il enjambe une nuit prise.** `minNights`,
  `minNightsThrough`, `maxNights`, `arrivalAllowed`, `departureAllowed` sont
  respectés avant le clic. Règles pures et testées : `calendar-rules.ts`.
- **Récapitulatif collant** à droite sur ordinateur (Alexian, Yenna) ; les
  extras ajoutés y clignotent brièvement.
- **Barre collante en bas sur téléphone** (Chalet WHA), pleine largeur : total,
  « Voir le détail » qui déplie le récap sur place, bouton. Elle reste au
  défilement ; la page garde la place en dessous (`--bt-bar-height`).
- **Champs à 16 px** minimum (sinon iOS zoome), libellé au-dessus, `autocomplete`.
- **Cibles de 44 px** (boutons, jours, compteurs, case CGV).
- **Erreurs en clair**, à côté de l'action, sans code technique (`MESSAGES` dans `BookingTunnel.tsx`).
- **Option de 15 minutes visible** : minuteur au-dessus du paiement, rouge sous
  2 minutes ; « Retour » libère les dates tout de suite.

## Les jetons de design

Toutes les couleurs, polices et l'arrondi sont en tête de
`templates/styles/tunnel.css`, en variables `--bt-*`, avec une version sombre.
Valeurs par défaut : l'identité relevée sur logement-atypique.fr le
30/10/2026 (bordeaux `#590B00`, fond crème `#FAF9F7`, Bodoni Moda, Syncopate,
Manrope, angles droits). **Remplace-les par celles que le partenaire te donne**
et ne mets aucune couleur ailleurs. Les e-mails ne lisent pas les variables
CSS : mêmes valeurs dans `THEME` (`lib/tunnel/emails/layout.ts`).
Détail et correspondance avec le croquis : `references/design.md`.

## 1. Vérifier les prérequis

- La skill `bedlink-integration` est installée dans le projet : `lib/bedlink/`,
  tables `bedlink_*`, webhook, cron, et `components/bedlink/PaymentFrame.tsx`.
  Sinon, lance-la d'abord (`/bedlink-partner:bedlink-integration`).
- Le logement de test a `listing_id` renseigné dans `bedlink_properties`
  (connexion par l'hôte, ou à la main sur le compte de test).
- Lis `.env.local` sans afficher de valeur : `BEDLINK_FEATURES` contient-il
  `payments` ? (sans lui, la sandbox confirme sans paiement). Les formules
  demandent l'ouverture `formules` par BedLink.

## 2. Demander au partenaire ce qui manque

Une seule question groupée, puis attends :

- ses **couleurs** (principale, fond, texte), son **logo** (SVG), ses **polices** ;
- l'**URL publique** du site (`NEXT_PUBLIC_SITE_URL`), qui sert d'URL de retour
  du paiement : la page `/reserver/merci` doit être sur la **même origine** que
  le tunnel (BedLink poste le résultat du paiement à l'origine de `returnUrl`) ;
- la page de ses **conditions de réservation** (CGV) ;
- l'**adresse d'envoi** des e-mails et son fournisseur (Resend, Postmark…) ;
- où vivent ses **annonces** (nom, photo, prénom et e-mail de l'hôte) et son
  **catalogue d'extras** s'il en a un.

Ouvre `references/croquis.html` (ou montre-le) pour s'accorder sur l'écran.

## 3. Copier le code

Dans `<codeRoot>` (avec ou sans `src/`, alias du projet) :

| Gabarit | Destination |
|---|---|
| `templates/components/tunnel/*` | `components/tunnel/` |
| `templates/styles/tunnel.css` | `styles/tunnel.css` (ou importé depuis le layout) |
| `templates/lib/bedlink/day-rental.ts` | `lib/bedlink/day-rental.ts` |
| `templates/lib/tunnel/**` | `lib/tunnel/` |
| `templates/app/reserver/**` | `app/reserver/` (renomme la route selon ses URL, ex. `/[slug]/reserver`) |

Dans `lib/tunnel/store.ts`, fais pointer l'import `@/lib/bedlink/db/neon` vers
l'adaptateur déjà choisi par l'intégration. Aucune dépendance à ajouter :
React, Next et le client BedLink suffisent.

## 4. Habiller

- Remplace les jetons `--bt-*` et `THEME` par ceux du partenaire.
- Charge ses polices avec `next/font` et passe les noms aux variables `--bt-font-*`.
- Dans la page, mets sa galerie, son titre et sa description dans `header` ;
  garde le tunnel en dessous. Logo et en-tête : ceux du site, pas de BedLink.
- Textes : ton du partenaire, vouvoiement, aucune information inventée.

## 5. Brancher ses données (`lib/tunnel/config.ts`)

- `getListing(listingId)` : nom, sous-titre, première photo, URL publique,
  prénom et e-mail de l'hôte, URL des CGV, extras (`Extra[]`, `[]` si aucun).
- `sendEmail()` : son fournisseur d'e-mails, `from` = `EMAIL_FROM`.
- `EMAIL_FROM`, `SUPPORT_EMAIL` : ses adresses (à confirmer avec lui).

## 6. La table

Montre `templates/schema/tunnel.sql`, puis applique-le après accord, sur une
branche Neon de développement d'abord (ou traduis-le en Drizzle / Prisma).

## 7. Les deux crochets dans l'intégration

- Webhook (`lib/bedlink/webhook.ts`, cas `reservation.confirmed`), après
  `confirmCheckoutByExternalId` :
  `if (await tunnelStore.get(r.externalId)) await confirmAndNotify(r.externalId);`
- Cron (`app/api/bedlink/cron/route.ts`), après `runCatchUp` :
  `await sweepPendingBookings();` (un créneau n'a pas de webhook de
  confirmation, et un voyageur peut fermer l'onglet juste après avoir payé).

Les e-mails partent **une seule fois** quel que soit le chemin (verrou
`claimEmails`) ; en cas d'échec d'envoi, le verrou est rendu et le cron réessaie.

## 8. Vérifier le code

`npx tsc --noEmit`, le lint du projet, puis `next build`. Corrige sans affaiblir
les règles : actions serveur qui valident tout, prix relus côté serveur,
origine vérifiée dans `PaymentFrame`.

## 9. La recette

Serveur de développement lancé, clé de **test** (`blp_test_…`), sandbox d'abord.
Déroule `references/recette.md` en entier : 375 px et 1440 px, nuit et
créneau, option expirée, paiement échoué, Retour qui libère, e-mails. Rends le
tableau des cases avec ce qui a passé et ce qui reste.

**Aucune réservation de test sans accord** : chaque passage crée une
réservation sur le compte de test BedLink (visible dans son journal).

## 10. Compte rendu

- fichiers installés, route de la page, table créée ;
- ce que le partenaire doit encore fournir ou brancher (`config.ts`, polices, CGV) ;
- la recette : cases passées, cases restantes ;
- ce qui dépend de BedLink (ci-dessous).

## Ce que l'API ne fait pas encore (ne pas contourner)

- **Extras payés en ligne** : pas d'endpoint ; ils restent « à régler sur place ».
- **Couleurs de la page de paiement** : la page BedLink intégrée garde son
  propre habillage (fond clair, bleu nuit) et affiche son propre récap et son
  minuteur. Ne tente pas de la restyler.
- **Lien direct vers la réservation dans BedLink** : l'identifiant partenaire
  n'est pas celui du tableau de bord ; « Ouvrir dans BedLink » mène à la liste
  des réservations.
- **Paiement réel et clé `blp_live_`** : pas encore ouverts ; en sandbox le
  paiement est simulé (« paiement réussi », aucune carte).
