# Design du tunnel : jetons, règles, origines

## Les jetons (`templates/styles/tunnel.css`, en tête)

| Jeton | Rôle | Défaut (Logement Atypique, clair) | Sombre |
|---|---|---|---|
| `--bt-primary` | boutons, sélection, accents | `#590B00` | `#E05248` |
| `--bt-primary-hover` | survol | `#4A0900` | `#E86A61` |
| `--bt-on-primary` | texte sur la couleur principale | `#FFFFFF` | `#220907` |
| `--bt-bg` | fond de page | `#FAF9F7` | `#220907` |
| `--bt-surface` | cartes, champs | `#FFFFFF` | `#2B0E0B` |
| `--bt-muted` | bouton désactivé, notes | `#F4F3F0` | `#331310` |
| `--bt-ink`, `--bt-ink-2`, `--bt-ink-3` | texte, texte secondaire, discret | `#1A1412` et transparences | `#FFFCF0` et transparences |
| `--bt-border`, `--bt-border-strong` | traits | `#E5E2DD`, encre à 22 % | |
| `--bt-tint`, `--bt-tint-2` | fond de sélection, plage de dates | primaire à 7 % et 14 % | |
| `--bt-ok`, `--bt-danger` | « disponible », erreurs, minuteur tardif | `#2F6B45`, `#A3261A` | |
| `--bt-radius` | arrondi | `0px` (LA : `--radius: 0`) | |
| `--bt-font-display` | titres, mois, prix | Bodoni Moda | |
| `--bt-font-label` | petites capitales, boutons | Syncopate | |
| `--bt-font-body` | texte | Manrope | |
| `--bt-bar-height` | place gardée sous la page pour la barre du bas | `72px` | |

Valeurs relevées sur logement-atypique.fr le 30/10/2026, **à confirmer** par
le partenaire. Les e-mails reprennent les mêmes valeurs en dur (`THEME`).

Mode sombre : suit le système, sauf `data-theme="light"` sur `<html>` ; forcé
par `data-theme="dark"`. Si le site n'a pas de mode sombre, supprime les deux
blocs sombres.

## Les points de rupture

Ils suivent la **largeur du tunnel** (`container: tunnel`), pas celle de l'écran :

- moins de 560 px : un mois, extras en liste avec vignette, champs sur une colonne,
  seule l'étape en cours est nommée ;
- 560 px et plus : deux mois, extras en grille de grandes photos, champs sur deux colonnes ;
- 880 px et plus : récap collant à droite (340 px), boutons Retour / Continuer
  sous le contenu, plus de barre du bas.

## Les règles d'ergonomie, et d'où elles viennent

| Règle | Où elle tourne déjà |
|---|---|
| Calendrier de période, deux mois, demi-case de départ, départ interdit s'il enjambe une nuit prise | Chalet WHA (`booking-calendar.tsx`), Parenthèse Normande |
| Pas de prix par jour, prix après les dates (« Tarif vérifié en direct ») | décision du 30/10/2026 : seul le devis fait foi |
| Extras en cartes photo, un toucher les ajoute au récap | Les Cocons d'Alex (Alexian), La Parenthèse Normande |
| Récap collant à droite | Alexian, Villa Yenna |
| Barre « Réserver » collée en bas qui reste au défilement, pleine largeur, qui déplie le récap | Chalet WHA (en pastille), validée en barre le 30/10/2026 |
| Formulaire prénom, nom, e-mail, téléphone, message, deux colonnes | Villa Yenna, Alexian |
| Étapes en pastilles carrées reliées par un trait | Alexian, Villa Yenna |
| Option visible avec minuteur, libérée au Retour | parcours BedLink (`/holds`, 15 min) |

Constantes à garder quel que soit l'habillage :

- champs à **16 px** minimum, cibles de **44 px**, focus visible ;
- `min-width: 0` sur les enfants de grille qui contiennent du texte ;
- pas de hauteur d'écran fixe (`100vh`) : la feuille du récap utilise `60dvh` ;
- un seul bouton principal par écran ;
- une erreur s'affiche à côté de l'action, en phrase simple.

## La page de paiement BedLink

Elle est intégrée dans un cadre (`PaymentFrame`, hauteur 560 px par défaut).
Elle garde **son** habillage (fond clair, bleu nuit BedLink), son récap et son
minuteur : le cadre est posé dans une carte `.bt-pay` neutre pour qu'elle s'y
lise comme un bloc tiers, à la manière d'un bloc Stripe. La ligne
« Paiement sécurisé · Powered by BedLink » est dessous, discrète.
