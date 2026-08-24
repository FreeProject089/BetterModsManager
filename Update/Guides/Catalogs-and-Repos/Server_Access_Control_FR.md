# Fermer un serveur que tu as généré

Chaque serveur généré par BMM lit un **`access.json`** dans le dossier qu'il sert. C'est ainsi
qu'on met un mot de passe sur un dépôt, ou qu'on le réserve aux détenteurs d'une clé autorisée.

Cela vaut pour tous :

| Ce que tu as généré | Où va le fichier |
|---|---|
| Serveur standalone (Express / Node) | À côté de `server.js` |
| Standalone léger, v1 ou v2, `.bat` ou `.sh` | À côté du script |
| Multi-Repo Hub | **Dans chaque dossier de dépôt**, un par dépôt |
| Export de hub statique | *Nulle part — voir la dernière section* |

---

## Le fichier

BMM en écrit un vide à la génération. Vide veut dire **ouvert**, le même sens qu'un mot de
passe vierge a partout ailleurs dans BMM.

```json
{
  "password": "",
  "pubkeys": [],
  "audience": ""
}
```

| Champ | Signification |
|---|---|
| `password` | Un mot de passe de téléchargement. Les abonnés l'envoient en `X-Repo-Password` — BMM le demande et le retient pour la session. Vide = pas de mot de passe. |
| `pubkeys` | Des clés **publiques** OpenSSH, une par ligne. Vide = aucune clé requise. |
| `audience` | L'adresse que tapent tes abonnés. Obligatoire dès que `pubkeys` n'est pas vide. |

Il est lu **à l'arrivée d'une requête**, pas au démarrage du serveur. Ajoute une clé,
enregistre, et le téléchargement suivant la voit déjà. Ni redémarrage, ni régénération, ni
réenvoi.

---

## Deux verrous, et à quoi sert chacun

Un **mot de passe** est un secret partagé. Tous ceux qui l'ont peuvent synchroniser — et tous
ceux qui l'ont peuvent le transmettre. C'est exactement ce qu'il faut pour ouvrir l'accès à un
groupe, et exactement ce qu'il ne faut pas pour l'ouvrir à une seule machine.

Une **clé** ne se transmet pas si facilement. Tu colles la moitié publique ; le détenteur doit
avoir la moitié privée et *signer* à chaque requête. Rien de ce qui passe sur le réseau ne
peut être rejoué ailleurs, et révoquer un accès revient à supprimer une ligne.

Les deux se combinent. Avec les deux réglés, une requête a besoin des deux.

---

## Ajouter une clé

Demande à la personne sa ligne de clé **publique** — le contenu de son fichier `.pub`, ou dans
BMM **Paramètres → Identité & API → Clés d'identité**, qui l'affiche prête à copier. Elle
ressemble à ceci :

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA… elle@machine
```

ed25519, RSA et ECDSA sont tous acceptés. Mets chacune sur sa propre ligne du tableau :

```json
{
  "password": "",
  "pubkeys": [
    "ssh-ed25519 AAAAC3Nza… moi@portable",
    "ssh-rsa AAAAB3NzaC1yc… elle@bureau"
  ],
  "audience": "http://depot.exemple.com:3000"
}
```

> **La première clé listée ferme le dépôt pour tout le monde.**
> Sans clé, la vérification ne s'applique pas. Dès qu'une clé est listée, une preuve valide
> devient une condition sur **chaque** requête — y compris les tiennes. Ajoute ta propre clé
> d'abord, vérifie que tu peux toujours synchroniser, puis ajoute celles des autres.

Ne colle **jamais** une clé privée ici. Rien dans BMM n'en demande une dans un fichier de
configuration.

---

## `audience` — celui qui enferme tout le monde dehors

BMM signe **l'adresse qu'il a composée**. Une preuve faite pour `http://1.2.3.4:3000` est
refusée par un serveur qui attend `https://depot.exemple.com`, et c'est le but : une preuve
captée sur un serveur ne peut pas être rejouée contre un autre.

`audience` doit donc être l'origine que tes abonnés tapent réellement — schéma, hôte et port,
exactement :

```
http://192.168.1.10:3000        ← une adresse LAN, avec son port
https://depot.exemple.com       ← derrière un reverse proxy en 443, sans port
http://depot.exemple.com:3000   ← une connexion directe sur 3000
```

Trompe-toi et toutes les preuves sont refusées, pour une raison que rien côté client
n'explique. Elle n'est volontairement **pas** déduite de l'en-tête `Host` de la requête : un
attaquant rejouant une preuve captée enverrait simplement le `Host` correspondant, ce qui
rendrait toute la vérification décorative.

Tu peux aussi la régler une fois pour tout le serveur avec la variable d'environnement
`BMM_PUBLIC_ORIGIN` ; un `access.json` par dépôt prend le dessus.

---

## À quoi ressemble un refus

| Réponse | Signification |
|---|---|
| **401** + `Wrong or missing repo password` | Le mot de passe est réglé et n'a pas été envoyé, ou était faux. |
| **401** + `A valid key proof is required (missing)` | Des clés sont listées et le client n'a envoyé aucune preuve. |
| **401** + `… (audience)` | La preuve a été faite pour une autre adresse — vérifie `audience`. |
| **401** + `… (not_authorised)` | Une preuve valide, d'une clé absente de ta liste. |
| **500** + `No audience configured` | Tu as listé des clés en laissant `audience` vide. |
| **500** + `Key checking is unavailable` | `keyauth.mjs` manque à côté du serveur. Régénère. |

401 et non 403 partout, délibérément : le client peut *faire* quelque chose d'un 401, et BMM
en lit un comme « il y a un identifiant à fournir » et le demande.

Le serveur affiche aussi au démarrage quels dépôts sont restreints — une porte que personne ne
voit est une porte qu'on oublie avoir posée, puis qu'on débogue comme « mon dépôt est cassé ».

---

## Ton propre tableau de bord continue de marcher

La vérification tourne **après** les bannissements et la liste blanche, et seulement pour les
requêtes de contenu. `/dashboard`, `/monitoring.json` et `/admin/*` sont servis avant, et les
connexions locales sont exemptées partout. Lister une clé ne t'enferme pas hors de ton propre
panneau d'administration.

---

## L'export statique ne peut pas faire ça

Un export de hub statique, ce sont des fichiers. Aucun processus BMM ne les sert, donc un mot
de passe et des clés autorisées **ne peuvent pas être appliqués** — c'est le serveur web que
tu places devant le dossier qui décide qui peut lire (`auth_basic` sous nginx, une directive
Caddy, les contrôles de ton hébergeur).

L'export embarque un `README-access.txt` qui le dit exactement. Si tu veux que BMM applique
l'accès, génère le hub avec le serveur Node.

---

## Voir aussi

- **Index de catalogues — une adresse pour plusieurs catalogues**
- **PRIVACY.md**, §3.1.b et §3.2.b — ce qui est conservé et ce qui n'est que lu
