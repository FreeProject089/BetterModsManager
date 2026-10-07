# Conflits

Deux mods sont en **conflit** quand ils livrent le même fichier. Certains gestionnaires laissent l'un
écraser l'autre en silence. BMM détecte le recouvrement *avant* d'écrire quoi que ce soit et te
prévient — mais la résolution elle-même est délibérément simple, et l'ingénierie intéressante est
ailleurs : rendre la détection gratuite et la désactivation sûre.

---

## La détection est une consultation d'index, jamais une lecture disque

BMM garde **deux maps en mémoire**, et aucune n'est jamais écrite dans `data.json` :

> *« Cache pour la détection de conflits en O(1) (en mémoire uniquement, pas sauvegardé dans le
> JSON) »*

| Map | Forme | Répond à |
|---|---|---|
| Cache de fichiers | mod → son ensemble de fichiers | « que livre ce mod ? » |
| Index de conflits | fichier → les mods qui le réclament | « qui d'autre réclame ce chemin ? » |

La seconde est juste l'inverse de la première, et elle couvre tous les mods de la bibliothèque,
activés ou non. Tout chemin réclamé par plus d'un mod est un conflit : **actif** quand les deux sont
activés dans le profil, **potentiel** sinon, signalé pour le même profil (*Intra*) ou pour un autre
profil qui déploie dans le même dossier de jeu (*Inter*). Trouver les conflits est donc un
regroupement sur des données déjà en RAM — aucun accès au système de fichiers.

```mermaid
flowchart TD
    subgraph LIB["Cache de fichiers (tous les mods)"]
        A["Mod A : data/file.x"]
        B["Mod B : data/file.x"]
        C["Mod C : sound.ogg"]
    end
    A --> IDX[("Index de conflits<br/>fichier → mods")]
    B --> IDX
    C --> IDX
    IDX --> SHARED{"Chemin réclamé par<br/>2 mods ou plus ?"}
    SHARED -- "non" --> OK["Pas de conflit"]
    SHARED -- "oui" --> BOTH{"Les deux activés ?"}
    BOTH -- "oui" --> ACT["Conflit actif"]
    BOTH -- "non" --> POT["Conflit potentiel"]
```

Être en mémoire seulement est une décision de conception, pas un oubli : l'index est reconstruit depuis
le cache de fichiers dès qu'il pourrait être périmé, il ne peut donc jamais diverger du dossier mods
d'une façon qui survivrait à un redémarrage.

!!! note "C'était la plus grosse source de lag de l'app"

    L'UI demandait autrefois les conflits **un mod à la fois**, ce qui *« sur une grosse bibliothèque
    signifiait des centaines d'aller-retours IPC + acquisitions de verrou à chaque
    rafraîchissement/import — la principale source de lag de l'UI »*. C'est maintenant un seul appel
    groupé, et le rapport porte des **compteurs**, pas des listes de fichiers. La liste complète d'un
    conflit est un appel séparé, et elle est **plafonnée à 2000 entrées** avec un drapeau `truncated`
    — une paire de mods pathologique se recouvrant sur 200 000 fichiers ne peut plus construire un
    payload assez gros pour faire mal à la fenêtre.

---

## Qui gagne : le dernier mod de l'ordre d'activation

Il n'y a **aucun sélecteur de gagnant par fichier**. La règle est : **le mod appliqué en dernier
gagne.** La liste `active_mods` d'un profil est *ordonnée* — l'[ordre d'activation](doc-page:how-it-works/load-order) —,
le déploiement la parcourt dans l'ordre, et un mod plus tardif écrase un plus ancien sur tout chemin
partagé. Un mod nouvellement activé va à la fin, donc par défaut c'est le dernier activé qui gagne ;
la vue de l'ordre permet de monter ou descendre n'importe quel mod, et ne recopie que les fichiers qui
changent de main.

```mermaid
flowchart LR
    E1["Activer Mod A"] --> E2["Activer Mod B<br/>(va à la fin)"]
    E2 --> DEPLOY["Déployer dans<br/>l'ordre d'activation"]
    DEPLOY --> WIN[("Dossier du jeu :<br/>le data/file.x de B")]
```

C'est une vraie simplification par rapport aux gestionnaires à arbre de priorités. Elle t'achète une
chose : il n'y a jamais de règle cachée à reconstituer. Ce qui est sur le disque est le dernier mod
d'une seule liste visible.

---

## Rien n'est perdu — la règle de sauvegarde

Avant qu'un mod écrase un fichier, BMM copie le **fichier de jeu d'origine** dans `_original/` à
l'intérieur du dossier de sauvegarde du profil. Le détail important est la garde qui décide de ce qui
compte comme « original » :

> *« CRITIQUE : vérifier si le fichier actuellement dans le dossier de destination vient en fait d'un autre
> mod … C'est un fichier de mod, PAS un original du jeu. Ne pas sauvegarder. »*

Un fichier n'est donc sauvegardé **que la première fois où BMM remplace un véritable fichier de jeu**
dans ce profil. Les fichiers de mod qui écrasent d'autres fichiers de mod n'entrent jamais dans la
sauvegarde — c'est ce qui évite que le dossier de sauvegarde se remplisse de copies de mods que tu as
déjà, et ce qui évite qu'une « restauration » remette un jour le fichier d'un autre mod à la place du
fichier du jeu.

```mermaid
flowchart TD
    APPLY(["Activer un mod"]) --> EACH["Pour chaque fichier livré"]
    EACH --> HAVE{"Déjà dans<br/>_original/ ?"}
    HAVE -- "non" --> THERE{"Fichier présent dans<br/>le dossier du jeu ?"}
    THERE -- "oui" --> WHOSE{"Fichier d'un autre<br/>mod activé ?"}
    WHOSE -- "non" --> BK["Le sauvegarder<br/>dans _original/"]
    HAVE -- "oui" --> COPY["Copier le fichier du mod<br/>(écrasement)"]
    THERE -- "non" --> COPY
    WHOSE -- "oui" --> COPY
    BK --> COPY
    COPY --> GAME[("Dossier de destination")]
```

*Fichier d'un autre mod activé* veut dire un fichier livré par un mod activé sur ce dossier de jeu,
dans le profil actif **ou dans tout autre profil qui y déploie** (changer de profil ne déplace aucun
fichier, les leurs sont donc aussi sur le disque), ou posé juste avant par la même activation (une
chaîne de dépendances). La copie du mod écrase toujours.

---

## Désactiver : la restauration à trois voies

La désactivation est l'endroit où le « dernier gagne » cesse d'être un problème. Pour chaque fichier
que le mod retire, BMM pose trois questions dans l'ordre :

```mermaid
flowchart TD
    REM(["Fichier à retirer"]) --> OTHER{"Un autre mod activé<br/>le livre ?"}
    OTHER -- "oui" --> FROMMOD["Le copier depuis le dernier<br/>de l'ordre qui l'a"]
    OTHER -- "non" --> ORIG{"Dans _original/ ?"}
    ORIG -- "oui" --> FROMORIG["Restaurer le fichier du jeu,<br/>supprimer la sauvegarde"]
    ORIG -- "non" --> DEL["Le supprimer<br/>(le mod l'a ajouté)"]
```

1. **Un autre mod activé le livre** → restaurer depuis ce mod : le **dernier** de l'ordre
   d'activation qui a le fichier — la même règle que le déploiement. Un mod qu'un autre profil a
   activé sur le même dossier de jeu compte aussi, sous ceux de ce profil. Désactiver le mod du dessus
   révèle celui juste en dessous, mods archivés (zippés) compris : leur copie est lue depuis le cache
   extrait. (Il restaurait la copie *la plus ancienne*, et ignorait les mods archivés ; les deux sont
   corrigés et testés — voir [Ordre d'activation](doc-page:how-it-works/load-order).)
2. **Sinon, `_original/` l'a** (celui de ce profil, ou le dossier de sauvegarde d'un autre profil
   sur le même dossier de jeu, qui le détient quand ce profil a remplacé le fichier en premier) →
   restaurer le fichier du jeu, puis **supprimer la copie de sauvegarde** : *« Optimisation d'espace : retirer le fichier de sauvegarde puisqu'il a été
   restauré en sécurité. »* Le dossier de sauvegarde rétrécit à mesure que tu désactives, au lieu de
   grossir indéfiniment.
3. **Sinon** → le mod a ajouté un fichier que le jeu n'a jamais eu, il est donc supprimé.

Deux détails de sûreté dans ce nettoyage :

- La liste des fichiers à retirer est une **union de ce que BMM avait enregistré à l'activation et
  d'un scan frais du dossier du mod** (le code parle de *« Nettoyage hybride : fichiers suivis +
  fichiers physiques actuels »*), donc un fichier ajouté au dossier du mod après l'activation est
  quand même nettoyé.
- Les dossiers vidés sont retirés du plus profond au plus superficiel avec `fs::remove_dir`, qui *« ne
  retire que les dossiers VIDES (erreur → sans effet si non vide), donc ça ne peut jamais supprimer de
  données »*, et les chemins sont relatifs au dossier de destination *« donc ils ne peuvent jamais en
  sortir »*.

---

## Ce que ça veut dire en pratique

| Tu veux | Fais ça |
|---|---|
| La version du fichier partagé de Mod B | Mets B **sous** A dans l'[ordre d'activation](doc-page:how-it-works/load-order) (ou active-le après A) |
| Voir ce qui se recouvre réellement | Ouvre la vue des conflits — la liste est exacte, et gratuite à calculer |
| Tout annuler | Désactive dans n'importe quel ordre ; chaque fichier retombe sur le mod du dessous qui l'a, puis sur l'original du jeu |
| Choisir fichier par fichier | Non supporté — utilise le [Mapper](doc-page:how-it-works/mapper) pour changer ce qu'un mod livre, ou édite le dossier du mod |

!!! info "À voir dans l'app"
    Aide & autres → Développeur → **Gestion des conflits** ; le tutoriel **Conflits**.
