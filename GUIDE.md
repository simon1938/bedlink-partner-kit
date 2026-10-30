# Guide : votre tunnel de réservation BedLink

Pour Logement Atypique (Corentin). Ce kit fait construire par votre IA, dans
votre projet Next.js, la page où le voyageur choisit ses dates, ses extras,
paie et reçoit sa confirmation, à vos couleurs. Le parcours est celui du
croquis validé le 30/10/2026
(`plugins/bedlink-partner/skills/bedlink-tunnel/references/croquis.html`,
à ouvrir dans un navigateur).

## 1. Installer (une fois)

Le dépôt est public : aucun compte GitHub n'est nécessaire.

**Claude Code**, à la racine de votre projet :

```
/plugin marketplace add simon1938/bedlink-partner-kit
/plugin install bedlink-partner@bedlink-partner-kit
```

Si le plugin est déjà installé : `/plugin marketplace update bedlink-partner-kit`.

**Cursor** :

```
git clone https://github.com/simon1938/bedlink-partner-kit.git ../bedlink-partner-kit
mkdir -p .cursor/skills
cp -r ../bedlink-partner-kit/plugins/bedlink-partner/skills/bedlink-integration .cursor/skills/
cp -r ../bedlink-partner-kit/plugins/bedlink-partner/skills/bedlink-tunnel .cursor/skills/
```

## 2. La commande à taper

```
/bedlink-partner:bedlink-tunnel
```

(sous Cursor : `/bedlink-tunnel`). Si l'intégration BedLink n'est pas encore
dans votre projet, l'IA vous fera d'abord lancer
`/bedlink-partner:bedlink-integration`. Pour rejouer la recette à la fin :
`/bedlink-partner:bedlink-tunnel recette`.

## 3. Ce que vous préparez

- **Couleurs** : principale, fond, texte (et version sombre si votre site en a une).
- **Logo** en SVG et **polices** (noms Google Fonts ou fichiers).
- **URL publique** du site, qui sert d'URL de retour après paiement
  (ex. `https://logement-atypique.fr`, et en développement `http://localhost:3000`).
- **La page de vos conditions de réservation** (CGV).
- **L'adresse d'envoi des e-mails** et votre fournisseur (Resend, Postmark…).
- **Où vivent vos annonces** : nom, photo, prénom et e-mail de l'hôte. Les
  extras, eux, viennent de BedLink (l'hôte les règle dans son compte).

L'IA vous pose ces questions en une fois. Votre clé BedLink, elle, se colle
dans `.env.local`, jamais dans la conversation.

## 4. Tester en sandbox

- Espace partenaire (clé de test, journal des appels) : https://app.bedlink.fr/fr/partenaire
- Documentation de l'API : https://app.bedlink.fr/fr/partner-api/docs
- Clé `blp_test_…` et `BEDLINK_FEATURES=…,payments` : le paiement est simulé
  (« paiement réussi », aucune carte). La location à la journée demande que
  BedLink vous ait ouvert `formules`.

La recette (téléphone 375 px, ordinateur 1440 px, option expirée, paiement
échoué, e-mails) est dans
`plugins/bedlink-partner/skills/bedlink-tunnel/references/recette.md`.

## Bon à savoir

- Le prix vient toujours du devis BedLink : le calendrier n'affiche pas de prix.
- Les extras se paient en ligne avec le séjour : le catalogue et les prix
  viennent de BedLink (`GET /properties/{id}/extras`), le tunnel n'envoie que
  l'identifiant et la quantité, et BedLink les ajoute au montant encaissé.
  En cas d'option échue, le voyageur est remboursé de tout, extras compris.
- La carte est saisie dans la page BedLink intégrée, sur le compte Stripe de
  l'hôte : votre site ne la voit jamais. C'est le seul endroit marqué BedLink.

Une question : simon@bedlink.fr.
