# Recette finale du tunnel

Clé de **test** (`blp_test_…`), sandbox, `BEDLINK_FEATURES` avec `payments`.
Chaque passage crée une réservation sur le compte de test BedLink : annule-la
ensuite (`DELETE /reservations/{id}` ou `DELETE /creneaux/reservations/{id}`).
Coche chaque case, note ce qui échoue avec une capture.

## Téléphone, 375 × 667 (puis 390 × 844)

- [ ] Aucun défilement horizontal, sur toutes les étapes.
- [ ] La barre du bas reste visible au défilement, ne cache aucun bouton ni champ, respecte la zone du bas de l'iPhone.
- [ ] « Voir le détail » déplie le récap dans la barre, « Masquer le détail » le replie.
- [ ] Un seul mois dans le calendrier, jours de 40 px au moins, navigation au pouce.
- [ ] Toucher un champ ne zoome pas (16 px).
- [ ] Extras en liste avec vignette ; le compteur « Pour X personnes » est utilisable.
- [ ] La page de paiement intégrée tient dans la largeur, sans double défilement gênant.

## Ordinateur, 1440 × 900

- [ ] Deux mois côte à côte, récap collant à droite qui suit le défilement.
- [ ] Plus de barre du bas ; boutons Retour / Continuer sous le contenu.
- [ ] Extras en grille de grandes photos ; un clic les ajoute au récap (bref surlignage).

## Calendrier et devis (nuit)

- [ ] Les jours passés et les nuits prises sont barrés.
- [ ] Le premier jour d'une période prise est à demi teinté et accepté comme départ.
- [ ] Un départ qui enjambe une nuit prise est impossible.
- [ ] Le séjour minimum est annoncé après l'arrivée (« minimum 2 nuits » sur le Chalet des Dunes) et respecté.
- [ ] Aucun prix dans le calendrier ; le total apparaît après le départ, identique au `totalCents` du devis.
- [ ] Changer le nombre de voyageurs refait le devis.
- [ ] Au-delà de la capacité, le bouton « plus » est désactivé.

## Journée et soirée (si `formules` est ouvert)

- [ ] Le choix Nuit / Journée / Soirée n'apparaît que si le logement a des formules.
- [ ] Seuls les jours avec un créneau libre sont cliquables.
- [ ] Les formules du jour et leurs créneaux libres s'affichent ; le prix = celui du devis de créneau.
- [ ] Trop de personnes pour une formule : créneaux désactivés, message clair.
- [ ] Les extras « nuit seulement » (petit-déjeuner, départ tardif) ne sont pas proposés.

## Paiement et option

- [ ] La page de paiement n'apparaît qu'après la case des conditions ; le lien des conditions s'ouvre.
- [ ] Le minuteur part de 15:00, passe en rouge sous 2:00.
- [ ] Pendant l'option, les dates sont fermées : un second onglet ne peut pas les réserver (devis refusé `dates_unavailable`).
- [ ] « Paiement réussi » (sandbox) : écran de confirmation avec la référence, récap « Payé ».
- [ ] La confirmation n'arrive qu'après la réponse du serveur (`bookingStatus`), pas sur le seul message de la page.
- [ ] **Paiement échoué** : message « rien n'a été débité, vous pouvez réessayer », la page de paiement reste utilisable.
- [ ] **Option expirée** : laisser le minuteur à zéro sans payer : « Votre option a expiré », « Reprendre ma réservation » refait un devis et repart proprement.
- [ ] **Retour** depuis le paiement : les dates se rouvrent tout de suite (le calendrier d'un autre onglet les montre libres après synchro).
- [ ] Repli : ouvrir `url` en plein écran, payer, « Continuer » mène à `/reserver/merci?ref=…` qui affiche « confirmée ».
- [ ] « Paiement sécurisé · Powered by BedLink » est la seule mention de BedLink à l'écran.

## Données et e-mails

- [ ] La réservation apparaît dans BedLink (compte de test) avec le canal du partenaire, le voyageur, les notes (message + extras « à régler sur place »).
- [ ] Une ligne `tunnel_bookings` en `confirmed`, `emails_sent_at` rempli.
- [ ] E-mail au voyageur reçu une seule fois : couleurs du partenaire, dates, total payé, extras à part, conditions d'annulation.
- [ ] E-mail à l'hôte reçu une seule fois : voyageur et contact, message, extras, « Ouvrir dans BedLink » ; répondre écrit au voyageur.
- [ ] Les deux e-mails sont lisibles sur téléphone et en texte brut.
- [ ] Fermer l'onglet juste après « paiement réussi » : les e-mails partent quand même (webhook ou cron).

## Sécurité

- [ ] Aucune variable BedLink en `NEXT_PUBLIC_`, aucun import de `lib/bedlink/*` (hors types) dans un composant client.
- [ ] Modifier dans le navigateur le prix d'un extra ou le total ne change rien côté serveur.
- [ ] `check.mjs` de la skill `bedlink-integration` reste au vert.
- [ ] `next build` passe.
