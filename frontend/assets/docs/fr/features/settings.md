# Paramètres

Les Paramètres forment une longue page, mais la plupart se règlent une fois pour toutes. Ce
tour commence par la poignée qui change la *sensation* de BMM, puis parcourt le reste section
par section pour que rien ne reste un mystère.

<div class="bmm-replay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/settings.bmmreplay" data-page="features/settings" data-title="Un tour des Paramètres (clip placeholder)"></div>

*Enregistrement placeholder — un clip ciblé de cet écran le remplacera.*

## Les quatre qui comptent le plus

### Thèmes & Apparence

> Personnalise chaque couleur, police et élément de BMM. Partage tes thèmes en un clic.

Ce n'est pas un interrupteur clair/sombre — c'est un éditeur de thèmes. Tu peux remplacer les
images intégrées de BMM (logo, fond d'écran, même la mascotte Tasky), et *ajouter tes propres
boutons, bannières, badges ou widgets n'importe où dans BMM*. Un thème s'exporte et s'importe
en fichier, et un catalogue de thèmes fonctionne comme l'[App Catalog](doc-page:features/apps). Vois
[Thèmes](doc-page:features/themes) pour tout le moteur.

Pars d'un des préréglages intégrés et ajuste. Le conseil de l'éditeur lui-même : survole un
libellé pour l'aide, clique sur **?** pour la doc MDN de la propriété CSS.

### Stockage & Smart I/O

Le réglage à connaître si BMM rend ton PC poussif pendant l'activation des mods :

> Limite la vitesse de lecture/écriture sur tes disques pendant l'activation des mods pour
> éviter les ralentissements. (0 = illimité)

L'**auto-calibration** teste tes disques et suggère une limite d'E/S pour chacun. Lance-la une
fois ; c'est la différence entre « les mods s'activent en arrière-plan » et « ma machine a
gelé trente secondes ». Les limites sont par disque : un NVMe rapide et un disque externe lent
ont chacun leur plafond.

### Mises à jour

Vérifie une nouvelle version de BMM, opte pour les **pré-versions**, ou coupe la **mise à jour
automatique**. Les pré-versions reçoivent les correctifs en premier et les bugs en premier —
l'interrupteur existe pour que ce soit ton choix, pas une surprise. Un contrôle distinct
vérifie tes *mods* (voir [Dépôt Serveur](doc-page:features/repo)), à ne pas confondre avec la mise
à jour de l'app elle-même.

### Données

Exporte tout, réimporte. Fais un export avant toute manip dont tu n'es pas sûr : c'est
l'assurance la moins chère de l'app.

!!! danger "Réinitialisation d'usine"

    La section Debug peut remettre BMM à zéro. Elle demande confirmation. Il n'y a pas de
    retour en arrière — exporte tes données avant de t'en approcher.

## Tout le reste, section par section

### Langue

Change la langue de l'interface. Les langues sont de simples fichiers JSON dans le dossier
`Lang/` de l'app — en ajouter une ne demande **aucune recompilation**. La carte fournit tout :
un **Guide**, un **modèle** téléchargeable, un bouton **Importer**, et le **Bac à sable de
traduction**.

La voie confortable pour traduire, c'est le **Bac à sable** :

- **Créer une nouvelle langue** — donne-lui un code (`de`, `pt-br`…), amorcée au besoin depuis
  une langue existante.
- Traduis clé par clé avec recherche, **barre de progression**, saut « **prochaine
  manquante** », et la référence des autres langues côte à côte.
- Prévisualise chaque texte **en direct** (toast / infobulle / substitué dans la vraie UI), et
  **choisis à l'écran** : clique n'importe quel texte de BMM pour sauter à sa clé.
- Les éditions s'enregistrent dans le bac à sable (jamais l'app en direct) ; **Exporter**
  télécharge le JSON fini — importe-le pour l'activer.

Conserve le bloc `_info` (nom + drapeau affichés dans le sélecteur) et les groupes `_synonyms`
(ils alimentent la recherche sémantique dans ta langue). **Le français est la base** : une clé
non traduite retombe sur le FR ; une clé absente partout affiche son id brut. `en`, `fr` et le
modèle ne peuvent pas être supprimés.

### Identité & API

> Tous tes identifiants importants au même endroit. Clique sur l'icône œil pour révéler une
> valeur.

Ton **creator ID**, le **token API** local, l'**URL et le port** de l'API, et la version de
l'app. L'[API locale](doc-page:reference/api) se lie à `127.0.0.1` sur le port **51274** par
défaut ; tu peux changer le port ici (effet après redémarrage). C'est aussi là que tu révèles
ou réinitialises le token API avec lequel les plugins et scripts s'authentifient.

### Confidentialité & Télémétrie

Accepte ou refuse les données d'usage anonymes, et gère les sous-options (rejeux de session,
capture complète, partage de benchmark) indépendamment. Tout est coupé sauf si tu l'actives, et
la page détaille exactement ce que chaque interrupteur envoie.

### Sécurité (confiance des plugins)

Choisis la liberté accordée aux plugins : **accès complet** ou mode **limité/en bac à sable**.
C'est le garde-fou global des permissions par plugin que tu accordes dans
[Plugins & API](doc-page:features/plugins) — resserre-le si tu exécutes des plugins que tu ne connais pas.

### Discord Rich Presence

Affiche ce que tu fais dans BMM sur ton profil Discord, ou coupe-le. Purement cosmétique.

### Launch Packs

Un Launch Pack est une **liste nommée d'exécutables qui démarrent ensemble**. Donne-lui un nom,
ajoute les chemins `.exe` (un jeu, un outil de reconnaissance vocale, une app de carte…),
choisis une icône, et un clic — ou un [deeplink](doc-page:reference/api), ou une [tâche
planifiée](doc-page:features/scheduler) — les lance tous.

!!! tip "Construis ta routine « je m'installe pour jouer »"

    Le but n'est pas de lancer des apps ; c'est de lancer *ta config* dans le bon ordre sans
    chercher cinq raccourcis. Fais un pack par jeu. Couple-le au [Planificateur](doc-page:features/scheduler)
    (un Launch Pack est une action planifiable) et « 18h : active mon modpack multi, puis lance
    tout » devient une seule automatisation.

### Planification & automatisation

Enregistre des tâches — appliquer un modpack, lancer un launch pack, exporter tes données — et
déclenche-les sur planning ou à la demande. Ça va bien au-delà d'une minuterie : conditions,
boucles et étapes « attendre que » permettent de vrais workflows. Voir
[Planificateur](doc-page:features/scheduler) pour le tableau complet.

### Storage Manager & benchmark

Deux outils liés vivent ici, tous deux sur la façon dont BMM déplace les fichiers.

Les **limites Smart I/O** (ci-dessus) rythment l'activation des mods pour ne pas monopoliser ton
disque. Le **Storage Manager** est là où tu fixes les plafonds par disque, et le **recalcul
SHA** reconstruit les hachages par fichier que compare la vérification d'[intégrité](doc-page:features/library)
— lance-le si tu as édité les fichiers d'un mod hors de BMM et veux que ses hachages collent à
nouveau à la réalité.

Le **benchmark** est l'outil qui vaut le coup d'être compris. Il ne lance pas un test de vitesse
disque générique — il exécute les **vraies opérations d'activation, désactivation et annulation**
de BMM contre un espace de travail contrôlé et rapporte le débit réel. C'est pourquoi
l'**auto-calibration** l'utilise pour fixer tes limites d'E/S : il mesure exactement le travail
que fait l'activation, sur ton matériel exact.

!!! tip "Sandbox vs réel, et quand le lancer"

    Lance le benchmark sur le jeu de données **sandbox** (synthétique, sûr, reproductible) pour
    comparer du matériel ou des réglages ; lance-le sur **réel** (les mods de ton profil actif)
    pour voir ce qu'une grosse activation te coûte vraiment. Les tailles vont de **S → XL**, ou
    **Custom** pour une taille de données exacte. Lance-le une fois après un changement de
    matériel, laisse l'auto-calibration fixer tes limites, et oublie-le.

### Tags

Gère tes tags de mods personnalisés — les libellés par lesquels tu filtres la
[Bibliothèque](doc-page:features/library). Renomme-les ou supprime-les ici, au même endroit.

### Son & raccourcis clavier

Active/coupe les sons de l'interface, et consulte les raccourcis clavier auxquels BMM répond.

### Token GitHub

Un token d'accès personnel optionnel, utilisé quand BMM parle à GitHub (vérifs de release,
téléchargements bruts) pour éviter la limite de débit anonyme plus stricte. Optionnel — n'en
ajoute un que si tu atteins les limites.

### Tutoriel

Rejoue les tutoriels interactifs de l'app à tout moment. Nouveau sur BMM ? Commence ici.

### Debug & outils développeur

Diagnostics, outils de rapports de crash, et la **réinitialisation d'usine** notée plus haut.
Pratique quand quelque chose cloche ; la réinit est le seul contrôle de toute l'app sans retour
en arrière, donc protégé par une confirmation.
