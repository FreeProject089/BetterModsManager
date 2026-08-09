# Migrer depuis OvGME ou OMM

Écrite parce que les quatre questions ci-dessous sont celles qu'on pose réellement avant de
changer d'outil, et qu'elles n'étaient traitées nulle part. Chaque affirmation a été vérifiée
dans le code source, pas reprise d'une autre page.

En résumé : **vos mods et votre hébergement restent tels quels.** Le travail est de votre côté
une fois, pas du côté de vos utilisateurs à répétition.

---

## Dois-je réempaqueter mes mods ?

Non.

Un mod BMM est un **dossier ou une archive** (`.zip`, `.rar`, `.7z`, `.tar`…) dont l'arborescence
interne reflète la racine du jeu — exactement la convention d'OvGME et d'OMM. Un paquet existant
fonctionne tel quel.

Il existe un `bmm.json` optionnel portant un identifiant stable, et il l'est vraiment : sans lui,
BMM calcule une empreinte déterministe à partir des paires (chemin relatif, taille) triées, si
bien que les mêmes fichiers donnent le même identifiant sur toutes les machines. Rien n'a besoin
d'être ajouté à un mod pour que BMM le suive.

!!! tip "Les archives restent des archives"

    Un `.zip` n'est pas décompressé dans votre bibliothèque. BMM y lit ce dont il a besoin et
    n'extrait vers un cache temporaire que lorsque les fichiers sont réellement nécessaires —
    voir [Bibliothèque](doc-page:features/library).

---

## Dois-je maintenir un manifeste à la main ?

Non — et c'est en général la réponse décisive pour qui maintient un dépôt OMM.

BMM **génère** le manifeste. Pointez *Exporter un dépôt serveur* sur vos mods : il les parcourt,
calcule le SHA-256 de chaque fichier (plus des hashs par blocs pour les gros), enregistre les
tailles, et écrit `repo.json` lui-même. Ajoutez, retirez ou mettez à jour un mod, puis réexportez.

Il récupère aussi la graine du `repo.json` précédent, donc réexporter un dépôt mis à jour
n'invalide pas les clients qui l'utilisent déjà.

Vous n'ouvrez jamais ce fichier.

---

## J'héberge en HTTP. Est-ce que ça marche ?

Oui, sous deux formes — choisissez celle qui correspond à votre infrastructure.

| Vous avez | Utilisez |
|---|---|
| N'importe quel hébergeur servant un répertoire | Le générateur peut produire un répertoire **statique** (`index.html` + le manifeste) qu'il suffit de déposer. Aucun processus Node, rien à faire tourner. |
| Des URL de téléchargement par mod | Les **téléchargements directs** sont un type de source de premier rang, au même titre que GitHub, Drive ou MEGA. |

!!! warning "`ftp://` n'est pas un transport que BMM parle"

    Les téléchargements passent en http(s). Si vos fichiers sont sur un serveur FTP mais
    accessibles par un lien HTTP, c'est le cas pris en charge et tout va bien. Si le seul accès
    est le protocole FTP lui-même, BMM ne peut pas le récupérer.

---

## En quoi l'application d'un mod diffère-t-elle vraiment d'OMM ?

De façon moins magique qu'on a pu vous le dire, et la réponse honnête vaut mieux que l'argumentaire.

**BMM n'utilise ni système de fichiers virtuel, ni liens symboliques, ni jonctions.** Il copie de
vrais fichiers dans le dossier du jeu et sauvegarde le fichier de jeu remplacé dans le magasin
`_original/` du profil. C'est fondamentalement l'approche d'OMM.

La différence est dans tout ce qui entoure la copie :

- **La conscience des conflits.** BMM indexe quels mods livrent les mêmes fichiers — au sein d'un
  profil, et entre profils partageant un dossier de jeu — et sait montrer tous les recouvrements
  d'un coup au lieu d'un par un. Voir [Conflits](doc-page:how-it-works/conflicts).
- **Un ordre d'activation explicite.** L'ordre fait partie du profil : c'est quelque chose que
  vous définissez et partagez, pas le hasard de votre dernier clic.
- **Une restauration en couches.** Désactiver un mod ne remet pas aveuglément le fichier d'origine.
  BMM cherche d'abord un autre mod **encore actif** qui fournit ce même fichier et restaure
  celui-là ; il ne se rabat sur `_original/` que si aucun ne le fournit ; et si le fichier
  n'existait pas dans le jeu, il est supprimé. C'est ce qui fait que désactiver un mod au milieu
  d'une pile qui se recouvre se comporte correctement.

Si votre modèle mental est *« OMM, avec la gestion des conflits et sans manifeste à maintenir »*,
il est juste.

---

## Récupérer votre installation existante

BMM lit la configuration propre aux deux gestionnaires, donc les profils passent sans être
reconstruits à la main :

- **OMM** — lit `%APPDATA%\Open Mod Manager\config.xml` et importe les profils qui y figurent.
- **OvGME** — lit la configuration d'OvGME et importe de la même façon.

Les deux sont proposés sur l'écran de profil vide au premier lancement, et depuis la
[palette de commandes](doc-page:features/command-palette).

!!! note "Ce qui ne suit pas"

    Les décisions de conflit et l'ordre d'activation de l'autre gestionnaire. BMM reconstruit son
    propre index de conflits à partir des fichiers, et l'ordre d'activation part de la liste
    importée — un tour par la [vue globale des conflits](doc-page:features/library#conflicts) après
    l'import est conseillé.
