# Kit d'intégration partenaire BedLink

Ce kit branche votre site sur BedLink : vos logements, leurs prix et leurs
disponibilités arrivent dans votre base, et vos voyageurs réservent en direct,
sans passer par Airbnb ou Booking. Il s'installe dans Claude Code ou Cursor et fait le
travail à votre place, proprement et sans exposer vos secrets.

Pensé pour une stack **Next.js (App Router) + Postgres / Neon + Vercel**, avec
Drizzle, Prisma ou du SQL brut.

## Installation en trois commandes

Dans Claude Code, à la racine de votre projet :

```
/plugin marketplace add simon1938/bedlink-partner-kit
/plugin install bedlink-partner@bedlink-partner-kit
/bedlink-partner:bedlink-integration
```

## Avec Cursor

Cursor lit le même format de skill (`SKILL.md`). Depuis la racine de votre
projet, une fois pour toutes :

```
git clone https://github.com/simon1938/bedlink-partner-kit.git ../bedlink-partner-kit
mkdir -p .cursor/skills
cp -r ../bedlink-partner-kit/plugins/bedlink-partner/skills/bedlink-integration .cursor/skills/
cp -r ../bedlink-partner-kit/plugins/bedlink-partner/skills/bedlink-tunnel .cursor/skills/
```

Puis, dans le chat Agent de Cursor, tapez `/bedlink-integration` (ou
demandez simplement « installe l'intégration BedLink »). Pour mettre le kit à
jour plus tard : `git -C ../bedlink-partner-kit pull` et refaites la copie.
Vous pouvez commiter `.cursor/skills/bedlink-integration` dans votre projet :
il ne contient aucun secret.

Le dépôt est privé : votre compte GitHub doit y avoir accès, et git doit
pouvoir s'authentifier sans vous poser de question (`gh auth login` puis
`gh auth setup-git`, une fois pour toutes).

Ensuite, laissez-vous guider. La seule chose que la skill vous demandera de
faire vous-même : **coller votre clé BedLink dans `.env.local`**. Ne la collez
pas dans la conversation. La clé se crée dans votre espace partenaire :
https://app.bedlink.fr/fr/partenaire.

Pour l'instant, c'est une clé de test (`blp_test_…`) : utilisez-la pour tout le
développement, sur des comptes de test où vous pouvez réserver autant que vous
voulez. Une clé de production vous sera remise au passage en réel.

## Ce que la skill fait

1. Détecte votre stack (version de Next, ORM, pilote Postgres, `vercel.ts`
   ou `vercel.json`).
2. Prépare `.env.local` : clé BedLink à coller, secret webhook et secret du
   cron générés, `.env*.local` ignoré par git. Vous donne les commandes pour
   les mettre dans Vercel en *Sensitive*.
3. Écrit le client TypeScript typé (`lib/bedlink/`).
4. Crée les 7 tables `bedlink_*` (migration Drizzle, Prisma ou SQL), après
   vous avoir montré le SQL.
5. Écrit la route webhook (`/api/bedlink/webhook`) : signature vérifiée en
   temps constant, horodatages de plus de 5 minutes refusés, chaque événement
   traité une seule fois.
6. Écrit le cron de rattrapage (`/api/bedlink/cron`, toutes les 10 minutes) et
   la synchro initiale (`scripts/bedlink-sync.ts`).
7. Branche le parcours de réservation : devis → option de 15 minutes →
   paiement → réservation. **Jamais de réservation décidée sur votre copie** :
   elle sert à afficher et à chercher, BedLink seul confirme.
8. Prépare la page de paiement BedLink intégrée (« Powered by BedLink ») : la
   carte est saisie chez BedLink, sur le compte Stripe de l'hôte ; votre site
   ne la voit jamais.
9. Vérifie tout avec `check.mjs`, puis lance la première synchro.

## Vérifier à tout moment

```
/bedlink-partner:bedlink-integration check
```

(le serveur de développement doit tourner pour le test du webhook). Le rapport contrôle les variables (présentes, bien formées, jamais en
`NEXT_PUBLIC_`, jamais dans git ni dans un composant client), les fichiers, le
cron, les tables, la route webhook avec un faux événement signé localement
(et les refus attendus : mauvaise signature, horodatage trop vieux, corps
modifié) et deux appels de lecture sur l'API. `--offline` saute ces deux
appels, `--json` sort le rapport pour un outil.

## Fonctions déjà ouvertes et fonctions prévues

Ouvert aujourd'hui (sandbox) : logements, calendrier (90 jours par appel),
devis, options, réservations, annulation.

Prévu, déjà codé dans le kit et **dormant** derrière la variable
`BEDLINK_FEATURES` : calendrier de 366 jours en un appel (`calendar_366`), fil
des changements (`changes`), webhooks (`webhooks`), liste de vos réservations
(`reservations_list`), messages voyageurs dans les deux sens (`messages`),
paiement intégré (`payments`). BedLink vous dira quand les allumer ; d'ici là,
le code utilise ce que la sandbox offre déjà.

Le contrat complet : `plugins/bedlink-partner/skills/bedlink-integration/references/contract.md`.
Les tables, champ par champ : `references/data-model.md`.

## Mettre à jour

```
/plugin marketplace update bedlink-partner-kit
/bedlink-partner:bedlink-integration update
```

## Location à la journée (`formules`)

Formules et créneaux dans la journée (shooting, séminaire, mariage…) : lire les
formules, en créer et les modifier, lister les créneaux libres, devis,
réservation et paiement d'un créneau par la page BedLink intégrée, annulation.
Contrat : section « Location à la journée » de `references/contract.md` ;
parcours : § 13 de la skill.

## Tunnel de réservation (`bedlink-tunnel`)

La page où le voyageur réserve et paie, à vos couleurs : dates (ou jour et
créneau), extras en photos, coordonnées, paiement BedLink intégré avec option
de 15 minutes, confirmation, e-mails au voyageur et à l'hôte. Composants React
de référence, jetons de design en variables CSS, croquis validé et recette.
S'installe après `bedlink-integration` :

```
/bedlink-partner:bedlink-tunnel
```

Guide à envoyer au partenaire : [`GUIDE.md`](GUIDE.md). Skill :
`plugins/bedlink-partner/skills/bedlink-tunnel/SKILL.md`.

## Certification

Ouverte depuis le 23/10/2026 (24 tests, § 12 de la skill). Pour un partenaire
déjà certifié, un **module court « Location à la journée »** (7 tests) se
lance à part : espace partenaire → Certification → « Module Location à la
journée », ou `POST /api/partner/v1/certification` `{ "module": "day_rental" }`
(§ 13 de la skill).

## Pour l'équipe BedLink (maintenance du kit)

```bash
npm install
npm test        # types de tous les gabarits + tests de bout en bout
npm run validate
```

Les tests tournent sans réseau : une fausse API BedLink (`test/mock-bedlink.ts`)
et un Postgres en mémoire (PGlite). Ils couvrent la synchro (avec et sans fil
des changements), le budget du cron, le parcours de réservation, la route
webhook et `check.mjs`. Quand l'API change, mettre à jour dans le même commit
`references/contract.md`, `templates/lib/bedlink/types.ts` et la fausse API.
