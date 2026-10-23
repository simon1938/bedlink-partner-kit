---
name: bedlink-integration
description: Installe et configure l'intégration BedLink (API partenaire) dans un projet Next.js + Postgres/Neon déployé sur Vercel. Détecte la stack, prépare les variables d'environnement serveur, crée les tables, écrit le client TypeScript, la route webhook signée, le cron de rattrapage, la synchro initiale, le parcours devis → option → paiement → réservation et la page de paiement intégrée, puis lance la vérification. À utiliser quand on demande d'installer, configurer, mettre à jour, réparer ou vérifier l'intégration BedLink, ou de brancher les logements BedLink sur le site.
argument-hint: "[install | check | update]"
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/detect-stack.mjs *) Bash(node ${CLAUDE_SKILL_DIR}/scripts/init-env.mjs *) Bash(node ${CLAUDE_SKILL_DIR}/scripts/check.mjs *)
---

# Intégration BedLink

> **Dossier de la skill.** Sous Claude Code, `${CLAUDE_SKILL_DIR}` est remplacé
> automatiquement. Sous Cursor (ou tout autre outil), lis chaque
> `${CLAUDE_SKILL_DIR}` comme le chemin du dossier qui contient ce fichier :
> par défaut `.cursor/skills/bedlink-integration` à la racine du projet.
> Lance les scripts avec ce chemin (ex. `node .cursor/skills/bedlink-integration/scripts/detect-stack.mjs`).

Tu installes l'intégration de l'API partenaire BedLink dans le projet courant.
BedLink est un PMS / channel manager : **BedLink est la source de vérité, ce
site est un canal de vente**, comme Airbnb. Le site garde une copie (logements,
calendrier) pour afficher et chercher, mais **toute réservation passe par
BedLink** (devis → option 15 min → paiement → réservation), jamais par la copie.

Fichiers du kit (lis-les quand l'étape le demande, pas avant) :

- `${CLAUDE_SKILL_DIR}/references/contract.md` : l'API, disponible et prévue.
- `${CLAUDE_SKILL_DIR}/references/data-model.md` : les tables, champ par champ.
- `${CLAUDE_SKILL_DIR}/references/webhooks.md` : signature, événements.
- `${CLAUDE_SKILL_DIR}/references/security.md` : secrets, Vercel, routes.
- `${CLAUDE_SKILL_DIR}/templates/` : le code à copier.
- `${CLAUDE_SKILL_DIR}/scripts/` : `detect-stack.mjs`, `init-env.mjs`, `check.mjs`.

Argument : `check` → va directement à l'étape 9. `update` → compare les
fichiers de `lib/bedlink/` du projet aux gabarits, montre les différences,
applique après accord. Sinon : installation complète.

## Règles qui ne se discutent pas

1. **Ne demande jamais la clé ni un secret dans la conversation.** Fais
   coller la clé par l'utilisateur dans `.env.local`. Si elle est collée dans
   la conversation quand même, écris-la dans `.env.local` sans la répéter, et
   conseille d'en créer une autre dans l'espace partenaire puis de révoquer
   celle-ci.
2. **Jamais de `NEXT_PUBLIC_`** pour une variable BedLink, jamais de secret
   dans le code, jamais `.env.local` dans git, jamais d'import de
   `lib/bedlink/*` (hors `types.ts`) dans un fichier `"use client"`.
3. **N'appelle pas l'API BedLink pendant l'installation**, à une exception :
   les appels de LECTURE de `check.mjs` (étape 9), après accord, parce qu'ils
   apparaissent dans le journal du partenaire chez BedLink. Ne crée **aucun**
   devis, option ni réservation de test sans demande explicite.
4. **Base de données** : montre la migration avant de l'appliquer et demande.
   Conseille une branche Neon de développement d'abord, jamais la production
   en premier.
5. **Fonctions pas encore ouvertes par BedLink** (fil des changements,
   webhooks, liste des réservations, messages, paiement, calendrier 366 jours) :
   le code est installé mais dormant derrière `BEDLINK_FEATURES`. Ne les
   allume pas ; c'est BedLink qui annonce leur ouverture.
6. Adapte le code au projet (alias d'import, dossier `src/`, conventions),
   sans changer la logique de sécurité : corps brut, comparaison en temps
   constant, tolérance de 5 minutes, idempotence, budget du cron.

## 1. Détecter la stack

```bash
node ${CLAUDE_SKILL_DIR}/scripts/detect-stack.mjs
```

Résume en quelques lignes : version de Next, App Router ou non, dossier `src/`,
alias (`@/`), ORM (`drizzle`, `prisma`, `sql`), pilote (`neon`, `pg`), fichier
Vercel (`vercel.ts` ou `vercel.json`), gestionnaire de paquets.

- Pas d'App Router ou pas de Postgres : arrête-toi et explique ce qui manque.
- `existing.bedlinkLib: true` : une intégration existe, propose `update`.

Choix de l'adaptateur de base (`templates/lib/bedlink/db/`) :

| Projet | Adaptateur |
|---|---|
| Prisma (avec ou sans Neon) | `prisma.ts` (réutilise le `PrismaClient` du projet : corrige l'import) |
| Drizzle ou SQL avec `@neondatabase/serverless` | `neon.ts` |
| Drizzle ou SQL avec `pg` | `pg.ts` |
| Autre pilote (`postgres`…) | écris un adaptateur de 10 lignes sur le modèle de `db/types.ts` |

## 2. Variables d'environnement

```bash
node ${CLAUDE_SKILL_DIR}/scripts/init-env.mjs
```

Le script ajoute à `.env.local` (sans rien afficher) : `BEDLINK_API_KEY` vide,
un `BEDLINK_WEBHOOK_SECRET` **local** généré (en attendant celui de BedLink),
un `CRON_SECRET` généré, `BEDLINK_FEATURES` vide ; il vérifie `.gitignore`.

Puis dis à l'utilisateur, mot pour mot ou presque :

> Ouvrez `.env.local` et collez votre clé après `BEDLINK_API_KEY=` (elle se
> crée dans votre espace partenaire : https://app.bedlink.fr/fr/partenaire).
> Ne la collez pas ici.

Ajoute au `.env.example` du projet (en le créant si besoin) les noms sans
valeurs, depuis `templates/env.example`. Donne les commandes Vercel de
`references/security.md` (`vercel env add … --sensitive`), à taper par
l'utilisateur dans son terminal.

## 3. Le code

Copie dans `<codeRoot>/lib/bedlink/` : `types.ts`, `config.ts`, `dates.ts`,
`client.ts`, `store.ts`, `sync.ts`, `booking.ts`, `messages.ts`, `webhook.ts`,
`webhook-signature.ts`, `db/types.ts` et **le seul** adaptateur choisi. Dans
`store.ts`, fais pointer l'import `./db/neon` vers l'adaptateur choisi.

Copie `templates/app/api/bedlink/webhook/route.ts` et
`templates/app/api/bedlink/cron/route.ts` sous `<codeRoot>/app/api/bedlink/`.
Remplace `@/lib/bedlink/…` si l'alias du projet est différent.

Dépendances : `@neondatabase/serverless` (si adaptateur neon et absent),
`tsx` en dépendance de développement (synchro initiale). Rien d'autre.

## 4. Le schéma

Lis `references/data-model.md`, puis selon l'ORM :

- **Drizzle** : `templates/schema/drizzle.ts` → un fichier `bedlink.ts` à côté
  du schéma (`drizzleSchema`), exporté par le schéma principal ;
  `npx drizzle-kit generate`, montre le SQL, puis `npx drizzle-kit migrate`
  après accord.
- **Prisma** : ajoute les modèles de `templates/schema/prisma.prisma` à
  `schema.prisma` ; `npx prisma migrate dev --name bedlink_integration` après
  accord.
- **SQL** : `templates/schema/bedlink.sql` (idempotent) dans le dossier de
  migrations du projet, ou `db/migrations/<date>_bedlink.sql` ;
  `psql "$DATABASE_URL" -f …` après accord.

Les noms de tables et de colonnes ne changent pas : `store.ts` écrit en SQL.

## 5. Le cron de rattrapage

Ajoute `/api/bedlink/cron` toutes les 10 minutes :

- `vercel.ts` existe : fusionne `templates/vercel/vercel.ts` dans `crons`.
- sinon `vercel.json` (fusionne avec l'existant, ne l'écrase pas).

Préviens : selon l'offre Vercel, la fréquence minimale des crons peut être
limitée (une fois par jour sur certaines offres). Dans ce cas les webhooks et
le fil des changements portent le temps réel, le cron ne fait que rattraper.
Le cron est borné (90 appels, 45 s) : ce qui ne tient pas reprend au suivant.

## 6. La synchro initiale

Copie `templates/scripts/bedlink-sync.ts` dans `scripts/` (corrige l'import
relatif vers `lib/bedlink/sync`). Elle se lance plus tard, à l'étape 10.

## 7. Le parcours de réservation

Lis la section « Devis et options » et « Paiement » de `references/contract.md`.
`lib/bedlink/booking.ts` porte tout le parcours ; `templates/examples/checkout-actions.ts`
montre des Server Actions qui l'appellent. Demande où se trouve la page de
réservation (ou le bouton qui redirige aujourd'hui vers Airbnb, Booking ou
WhatsApp) et branche :

1. recherche et affichage : lecture de `bedlink_calendar_days` (le prix est
   « à partir de ») ;
2. bouton Réserver : `quoteStay` puis `holdStay` (prix exact du devis à
   afficher) ;
3. coordonnées du voyageur : `payStay` ;
   - `mode: "payment"` → `components/bedlink/PaymentFrame.tsx` avec
     `embedUrl` (repli `url`) ;
   - `mode: "confirmed"` → page de confirmation (sandbox aujourd'hui) ;
4. page de confirmation : `stayStatus`, jamais le message du navigateur.

Copie `templates/components/bedlink/PaymentFrame.tsx` seulement si le site a
un tunnel de réservation à brancher maintenant ; il ne s'affiche que quand
BedLink renvoie une session de paiement.

## 8. Vérifier le code

`npx tsc --noEmit`, puis le lint du projet, puis `next build` si le projet le
supporte en local. Corrige ce qui casse sans affaiblir la sécurité.

## 9. Tester

Lance le serveur de développement en arrière-plan (`npm run dev`), puis :

```bash
node ${CLAUDE_SKILL_DIR}/scripts/check.mjs --url http://localhost:3000 --offline
```

Ensuite, **après accord** (appels de lecture visibles dans le journal BedLink) :

```bash
node ${CLAUDE_SKILL_DIR}/scripts/check.mjs --url http://localhost:3000
```

Le rapport vérifie : variables présentes et bien formées ; aucune variable
BedLink en `NEXT_PUBLIC_`, aucun secret dans git ni dans un composant client ;
fichiers en place et cron déclaré ; les 7 tables en base ; la route webhook
avec un faux événement `ping` signé localement (accepté, rejeu reconnu,
mauvaise signature, horodatage trop vieux, corps modifié et absence de
signature refusés) ; `GET /properties` et un calendrier de 7 jours.
`--json` sort le même rapport pour un outil.

Tout `ECHEC` se corrige avant de continuer.

## 10. Première synchro

Après accord (elle lit BedLink et écrit dans la base) :

```bash
npx tsx --env-file=.env.local scripts/bedlink-sync.ts
```

Montre le rapport (logements, appels, erreurs) et une requête de contrôle sur
`bedlink_calendar_days`.

## 11. Compte rendu

Termine par :

- ce qui a été installé (fichiers, tables, cron) ;
- ce qui reste à faire par l'utilisateur : clé dans `.env.local` si absente,
  variables dans Vercel, migration en production, relier `listing_id` aux
  fiches du site ;
- l'URL du webhook à transmettre à BedLink quand les webhooks ouvriront :
  `https://<domaine>/api/bedlink/webhook` ;
- les fonctions dormantes et leur drapeau (`references/contract.md`) ;
- la suite : la certification BedLink (§ 12), à passer avant le pilote réel.

## 12. La certification BedLink [DISPO, 23/10/2026]

À la manière d'un channel manager : BedLink joue l'hôte sur VOS logements de
test pendant un passage (2 h au plus, un test attend 15 min au plus), votre
intégration réelle fait les appels, et chaque test passe au vert. Un passage
tout vert donne un code `BLC-XXXXX-XXXXX-XXXXX-XXXXX`, que BedLink valide.

**Avant de lancer** : clé de TEST (`blp_test_…`) dans `.env.local`, URL et
secret du webhook réglés dans l'espace partenaire, signature vérifiée (un
webhook mal signé doit recevoir un 4xx), copie du calendrier sur 365 jours,
fil `/changes`, et vos deux logements de test reliés (le passage en
déconnecte un puis le fait reconnecter ; à la fin tout est remis comme avant).

**Lancer** : espace partenaire → Certification → « Lancer » (case « sauter le
paiement » possible : le test est alors « sauté », pas « réussi »), ou
`POST /api/partner/v1/certification` `{ "skipPayment": false }`.

**Pendant** : `GET /certification/{cert_…}` donne le test courant, sa consigne,
ses paramètres tirés au hasard et le champ à répondre ; répondre par
`POST /certification/{cert_…}/answers` `{ "test": "<id>", "answer": {…} }`.
TOUS les appels du parcours portent l'en-tête `BedLink-Certification: cert_…`.
Répondez depuis VOTRE copie (calendrier, webhooks reçus), jamais depuis une
valeur fixe : les prix, dates et jetons changent à chaque passage.

**Les 24 tests** : logements · fiche · calendrier 365 j · prix changé par
l'hôte (webhook `availability.changed` + `/changes`) · date bloquée · devis
cohérent · refus séjour trop court (409) · refus dates indisponibles (409) ·
option 15 min · paiement simulé (page `/pay/…`, « paiement réussi », aucune
carte) · réservation confirmée · idempotence (rejeu → 200, pas de doublon) ·
webhook `reservation.confirmed` · `GET /reservations?since=` · message du
voyageur (vous → BedLink) · réponse de l'hôte (webhook `message.created`, puis
le fil) · modification des dates (`PATCH /reservations/{id}`) · refus de
modifier une réservation d'un autre canal (404) · annulation par vous (dates
rouvertes) · annulation par l'hôte (`cancelledBy: host`) · déconnexion
(`DELETE /properties/{id}/connection`, webhook `property.disconnected`) ·
connexion par l'hôte (`POST /connect-sessions` avec une annonce ; BedLink,
dans le rôle de l'hôte, relie votre PREMIÈRE annonce au logement ; attendez
`completed` sur `GET /connect-sessions/{id}` et `property.connected`) ·
import (`/properties/{id}/reservations/import`, rejeu `unchanged`, puis un
message voyageur et un message hôte avec `sentAt` passé) · webhook mal signé
refusé.

Liste blanche requise : `certification`, `calendar_366`, `changes`,
`webhooks`, `reservations_list`, `messages`, `reservations_modify`, `connect`
(+ `payments` si le paiement n'est pas sauté). Abandon :
`DELETE /certification/{cert_…}`. Tout ce que le passage crée sur le compte de
test est supprimé à la fin.

