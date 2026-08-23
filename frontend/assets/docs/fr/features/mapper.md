# Mapper


Certains mods sont mal empaquetés. Les fichiers sont bons ; les dossiers autour, non. Le
Mapper corrige ça sans que tu dézippes quoi que ce soit à la main.

> Réorganise la structure de ton mod pour correspondre au répertoire du jeu.

![Le Mod Mapper](assets/docs/media/screens/mapper.annotated.png)

| | | |
|---|---|---|
| **1** | **Arbre source** | Ce que le mod contient réellement. |
| **2** | **Cible** | Où ces fichiers doivent atterrir pour que le jeu les voie. |
| **3** | **Diagnostic** | Montre l'emplacement final *avant* de valider. |

<div class="bmm-replay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/mapper.bmmreplay" data-page="features/mapper" data-title="Recartographier un mod mal packagé"></div>


## Quand en as-tu besoin

Le symptôme est toujours le même : **tu installes un mod, et le jeu fait comme s'il n'existait
pas.** Neuf fois sur dix, l'archive a un dossier de trop — l'auteur a zippé le dossier
contenant au lieu de son contenu — donc le jeu cherche `Data/textures/` et trouve
`MonMod-v3/Data/textures/`.

Le Mapper sert aussi dans l'autre sens : un mod qui pose ses fichiers à sa racine alors que le
jeu les attend sous `Mods/aircraft/…`, ou un mod qui mélange les dossiers de deux jeux dans
une seule archive.

## Ce qu'il change réellement

C'est la chose à comprendre avant de toucher à quoi que ce soit : **le Mapper édite le mod,
pas le jeu.** Quand tu remappes un élément, BMM le déplace *à l'intérieur du dossier du mod*
pour que la structure du mod reflète l'endroit attendu par le jeu. Le répertoire du jeu est
seulement *lu* ici — affiché à droite pour te donner une cible. Rien n'est écrit dans le jeu
tant que tu ne [synchronises](doc-page:features/library) pas le profil ensuite, exactement comme d'habitude.

C'est pour ça que le Mapper est sûr pour expérimenter : le pire des cas est un mod mal formé,
que tu peux reformer à nouveau — jamais un dossier de destination rempli de fichiers perdus.

Une chose à savoir sur les collisions, parce que le Mapper ne s'arrête pas pour demander.
Déplace un dossier là où un dossier du même nom existe déjà et les deux sont **fusionnés**,
comme le fait l'explorateur Windows — ce qui s'y trouvait déjà reste. Déplace un *fichier* sur
un fichier du même nom et il le remplace, ce qui est précisément ce que le dépôt demandait. Un
glisser malheureux peut donc te coûter un fichier, jamais une arborescence entière.

## Les deux arbres

L'écran est divisé. À gauche, l'**arbre de fichiers du mod** — chaque dossier et fichier que
le mod livre réellement. À droite, l'**arbre du répertoire du jeu**, la structure que le jeu
lit. Ton travail est de faire ressembler la gauche à la droite.

Des filtres en haut te laissent restreindre les grands arbres, pour trouver le dossier mal
placé sans faire défiler des centaines de textures.

## Remapper

Choisis un élément dans l'arbre du mod et pointe-le vers le dossier de destination auquel il
appartient. BMM l'y déplace *dans le mod*, en créant au passage les dossiers parents
manquants. Quelques opérations complémentaires complètent le tout :

| Action | Rôle |
|---|---|
| **Remapper / déplacer** | Déplacer un fichier ou dossier vers un autre chemin dans le mod (le correctif central). |
| **Nouveau dossier** | Créer un dossier dans le mod — utile pour introduire le niveau `Mods/…` qui manque à un mod mal zippé. |
| **Renommer** | Renommer un fichier ou dossier sur place. |
| **Supprimer** | Retirer un élément du mod (ex. un readme perdu ou un dossier laissé par un installeur). |
| **Ouvrir dans l'Explorateur** | Sauter à l'élément sur le disque — côté mod ou côté jeu — pour l'inspecter directement. |

Après un remap, BMM re-scanne le mod pour que l'arbre reflète immédiatement la nouvelle
structure.

## Vérifie avant de valider

Le **Diagnostic de structure** du Mapper existe pour une seule raison :

> Vérifie l'emplacement final de tes fichiers avant d'appliquer les changements.

Sers-t'en. Il montre où chaque fichier va atterrir **avant** de déplacer quoi que ce soit, pour
que tu confirmes que `skin.dds` va bien tomber dans `Mods/aircraft/F-16C/textures/` et pas un
niveau à côté. Deviner un chemin puis appliquer, c'est comme ça qu'on obtient un mod qui ne se
charge toujours pas — le Diagnostic est là pour ne jamais avoir à deviner.

!!! tip "Corrige le paquet une fois, profite partout"

    Comme le Mapper reforme le mod lui-même, le correctif est permanent : chaque profil qui
    utilise ce mod, et chaque future synchro, obtient la structure corrigée. Tu remappes une
    fois, pas à chaque activation.
