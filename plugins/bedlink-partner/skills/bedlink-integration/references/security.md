# Sécurité

## Les secrets

| Variable | Rôle | Où |
|---|---|---|
| `BEDLINK_API_KEY` | ouvre vos logements chez BedLink (lecture, devis, options, réservations) | serveur |
| `BEDLINK_WEBHOOK_SECRET` | prouve qu'un webhook vient de BedLink | serveur |
| `CRON_SECRET` | protège la route du cron | serveur |
| `DATABASE_URL` | votre base | serveur |

Règles, toutes vérifiées par `check.mjs` :

- **Jamais `NEXT_PUBLIC_`** : ce préfixe copie la valeur dans le JavaScript
  envoyé au navigateur, lisible par n'importe qui.
- **Jamais dans le code ni dans git** : `.env.local` (ignoré par git) en local,
  variables d'environnement Vercel marquées *Sensitive* en ligne.
- **Jamais dans un composant client** (`"use client"`) : seuls `types.ts` et
  `components/bedlink/PaymentFrame.tsx` peuvent y être importés.
- **Ne collez pas la clé dans la conversation avec Claude** : ouvrez
  `.env.local` et collez-la vous-même. La skill n'en a pas besoin.
- Clé compromise : révoquez-la dans votre espace partenaire et créez-en une
  autre ; les appels suivants avec l'ancienne échouent immédiatement.

## Mettre les variables dans Vercel

Dans votre terminal (pas dans Claude) :

```bash
vercel env add BEDLINK_API_KEY production --sensitive
vercel env add BEDLINK_WEBHOOK_SECRET production --sensitive
vercel env add CRON_SECRET production --sensitive
vercel env add BEDLINK_FEATURES production
```

Répétez pour `preview` si vos préversions doivent parler à BedLink (avec la
clé sandbox seulement). Ou par le tableau de bord : Project → Settings →
Environment Variables, case *Sensitive*.

## Les routes

- **Webhook** : pas de session ni de CSRF, la signature HMAC est
  l'authentification. Corps brut, comparaison en temps constant, horodatage à
  5 minutes, idempotence sur l'id d'événement, corps limité à 256 Ko.
- **Cron** : `Authorization: Bearer $CRON_SECRET` comparé en temps constant ;
  Vercel l'envoie seul quand `CRON_SECRET` existe.
- **Réservation** : jamais décidée sur la copie locale. Devis, option et
  réservation passent par BedLink ; le prix affiché au moment de payer est
  celui du devis, pas celui de la copie.
- **Page de paiement** : n'écoutez `postMessage` que depuis
  `https://app.bedlink.fr`, et confirmez toujours côté serveur
  (`getCheckoutStatus`) avant d'afficher « réservé ».

## Données voyageur

`bedlink_reservations`, `bedlink_messages` et le `payload` de
`bedlink_webhook_events` contiennent des données personnelles. Le cron purge
les webhooks de plus de 30 jours. Les réservations relèvent de votre propre
politique de conservation (RGPD).
