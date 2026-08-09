# Premier lancement

Trois étapes. Dans l'ordre — la deuxième est celle qu'on saute, et c'est celle qui compte.

## 1. Créer un profil

BMM s'ouvre sur un écran [Profils](doc-page:features/profiles) vide et annonce :

> Aucun profil actif — créez votre premier profil pour qu'une mise à jour ou une
> réinstallation du jeu n'efface plus jamais votre setup — ou importez vos configs OvGME
> existantes en un clic.

Le formulaire demande un nom et **trois dossiers**, tous obligatoires : le **dossier du
jeu** (là où BMM déploie), un **dossier mods** (où les mods de ce profil sont stockés) et un
**dossier backup** (les originaux et le journal d'activité). En option : un nom de jeu, une
couleur, une icône.

Un dossier mods distinct par profil — BMM te prévient si deux profils en partagent un, parce
que c'est comme ça qu'on finit par déboguer un mod qu'on croyait désactivé.

## 2. Comprendre ce qui vient de se passer

> Ton premier profil est prêt ! Tout ce que tu actives désormais est enregistré ici — à
> l'abri des mises à jour et des réinstallations.

Le contrat tient en une phrase. Tes mods vivent dans BMM, pas dans le jeu. Le dossier du jeu
devient une cible d'écriture pour BMM, pas quelque chose que tu maintiens à la main.

## 3. Ajouter un mod et l'activer

La [Bibliothèque](doc-page:features/library) ouverte, glisse un `.zip` ou un dossier de mod
sur la fenêtre : la boîte **Ajouter un mod** s'ouvre pré-remplie, et confirmer range le mod
dans ce profil. Puis active-le — un simple clic sur l'interrupteur de
la carte, ou un **double-clic n'importe où sur la carte**, c'est ça qui le met dans le jeu,
pour *ce* profil.

Sélectionne une carte (clic simple) et le **panneau détail** s'ouvre : version, auteur,
description, son identité cross-machine, ses conflits éventuels avec d'autres mods, ses
dépendances, ses tags, et une vérification d'intégrité. Rien de tout ça n'est nécessaire le
premier jour — mais c'est là quand tu en as besoin.

Si le jeu fait comme si le mod n'existait pas, c'est presque toujours l'empaquetage, pas BMM :
voir le [Mapper](doc-page:features/mapper).

## Tu viens d'un autre gestionnaire ?

Ne reconstruis pas une configuration à la main si tu peux l'éviter. BMM importe les profils
existants depuis :

- **OvGME** — il scanne ton dossier de données OvGME et rapatrie les profils.
- **OMM / Open Mod Manager** — importe un profil `.omm` ou `.omx` directement.

Fais-le d'abord ; tu peaufineras ensuite dans BMM.

!!! tip "S'entraîner sans risque"

    **Help & other → Interactive Tutorial Hub** te guide dans la vraie app avec un bac à sable
    intégré : il crée un profil « 🎓 Tutorial Example » avec des mods d'exemple (dont un conflit
    volontaire) et un modpack d'exemple — tu apprends tout le flux — profils, activation,
    conflits, partage — sans toucher à une vraie installation. Le bac à sable se nettoie tout
    seul.
