# 🔑 Phrases secrètes et clés d'identité

*🇬🇧 [English version](Passphrases_And_Keys_EN.md).*

Trois choses dans BMM peuvent contenir un secret : une **sauvegarde de données**, une **liste
de mods partagée**, et tes **clés d'identité**. Une seule page pour les trois, parce que les
règles sont les mêmes et que se tromper coûte la même chose.

---

## La phrase qui compte

**Une phrase secrète ne se récupère pas.** Ni par toi, ni par BMM, ni par personne. Pas de
réinitialisation, pas d'indice, aucune adresse de support qui puisse ouvrir le fichier. Si tu
la perds, la sauvegarde est perdue et la liste est illisible — pas *refusée*, **perdue** : ce
qu'il y a dedans n'est pas du texte lisible derrière un verrou. Il n'est pas là.

Note-la ailleurs que dans le fichier qu'elle ouvre.

---

## Ce que fait vraiment une phrase secrète

Elle **chiffre**. Il faut être précis là-dessus, parce qu'une invite de mot de passe qui se
contente de refuser d'ouvrir un fichier est un panneau sur une porte : le fichier est un zip,
et n'importe qui l'ouvrant avec un outil zip lit tout quand même.

| | Ce qui est chiffré | Ce qui reste lisible |
|---|---|---|
| **Sauvegarde** (`.DATABMM`) | Toute l'archive | Rien — ça cesse d'être un zip |
| **Liste de mods** (`.mm`) | Toute la liste, mods compris | Un en-tête : nom, auteur, jeu, nombre de mods |

La liste garde un en-tête **exprès**. Un `.mm` est lu par BMM, par l'inspecteur de
BetterCommunity et par quelqu'un qui décide s'il fait confiance : une liste que personne ne
peut vérifier est pire qu'une liste dont le contenu est privé. L'en-tête suffit à décider si
ça vaut la peine de demander la phrase à son auteur, et ne suffit pas à installer quoi que ce
soit.

**La signature est appliquée avant le verrou.** Une signature sur l'enveloppe ne dirait que
qui a chiffré — ce qui n'est pas la question qu'on se pose en ouvrant la liste de quelqu'un.

---

## Quand BMM la demande

| Où | Quand |
|---|---|
| **Export de données** | Optionnel. Obligatoire si tu inclus tes clés d'identité. |
| **Restaurer une sauvegarde** | Seulement si le fichier est verrouillé, et il le dit. |
| **Exporter une liste de mods** | Obligatoire si tu inclus des identifiants. |
| **Importer une liste de mods** | Seulement si elle est verrouillée. |
| **Installer depuis un catalogue de listes** | **À chaque fois**, pour chaque entrée verrouillée. |

Ce dernier point est délibéré, et c'est celui qui ressemble à un oubli. Un catalogue est une
liste d'adresses que **quelqu'un d'autre contrôle**. Si BMM retenait la phrase pour une
source, une liste *remplacée à cette adresse* s'ouvrirait avec un secret que son nouvel auteur
n'a jamais eu.

---

## Les clés d'identité

Une clé, c'est comment une source protégée sait que c'est toi. Deux moitiés :

- la ligne **publique**, que tu donnes à qui gère la source ;
- la moitié **privée**, qui ne quitte jamais ta machine et n'est jamais affichée — seulement
  l'endroit où elle est allée.

**Paramètres → Identity & API → Clés d'identité → En créer une…** en fabrique une. Prends
**ed25519** sauf si un serveur dit le contraire : toutes les sources de ce protocole
l'acceptent et la clé tient dans un message. ECDSA et RSA sont là pour un hôte plus ancien.

La clé que tu as déjà s'ajoute avec **Ajouter…**, et les deux vivent sur un seul trousseau.
Ce trousseau se modifie à **un seul endroit**, exprès : tout autre écran ayant besoin d'une
clé t'envoie ici plutôt que de te montrer une deuxième copie de la liste — parce que la copie
que tu aurais modifiée cesserait d'être celle qui signe.

### Les sauvegarder

Une clé est la seule chose dans BMM que tu ne peux pas remplacer en la redemandant. Tout le
reste d'une sauvegarde te coûte un après-midi de configuration ; ça, ça te coûte ce qui prouve
que c'est toi.

**Export de données → Clés d'identité (privées)** les emporte — et BMM **refuse** de l'écrire
sans phrase secrète. C'est le seul export que supprimer le fichier après coup ne rattrape pas :
à ce moment-là il est déjà là où vont tes sauvegardes.

---

## Les identifiants dans une liste partagée

Un `.mm` peut porter les mots de passe et les clés dont ses sources ont besoin. C'est
décoché, les deux types, séparément — et ça écrit sur disque quelque chose que BMM refuse
autrement d'y écrire : les mots de passe de téléchargement sont gardés **en mémoire seulement**
et jamais stockés, parce que les réglages finissent dans les sauvegardes et les rapports de
crash.

Donc :

- Seulement les hôtes **que cette liste vise**. Pas tous les mots de passe que la session
  détient.
- Seulement les mots de passe tapés **depuis le lancement de BMM** — il n'y en a pas d'autres,
  rien n'est stocké.
- L'écran nomme les hôtes **avant** que tu coches, parce que savoir si c'est prudent dépend
  entièrement desquels.

### De l'autre côté

Importer une telle liste pose **deux questions séparées**.

Les **mots de passe** sont proposés pour la session, exactement comme un que tu aurais tapé.

Les **clés** ont leur propre question et un avertissement direct. Une clé de signature, c'est
qui tu es pour toute source qui demande — en installer une depuis un fichier qu'on t'a envoyé
revient à signer sous l'identité de celui qui l'a faite. Dis non, sauf si tu sais exactement
pourquoi tu veux ça.

Un nom de clé déjà présent sur ton trousseau est **ignoré, jamais écrasé**. Importer une
liste ne peut pas remplacer la clé avec laquelle tu signes.

---

## Voir aussi

- [Contrôle d'accès serveur](Server_Access_Control_FR.md)
- [Emballer ou lier](Embed_Or_Link_FR.md)
