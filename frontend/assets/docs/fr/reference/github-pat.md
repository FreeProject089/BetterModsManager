# Limites GitHub et le jeton d'accès personnel

BMM lit pas mal de choses sur GitHub : les flux de releases pour les contrôles de mise à jour, des
fichiers de catalogue, et les téléchargements de mods vers lesquels pointe une `.mmlist`. GitHub
limite le débit des requêtes qui arrivent sans identifiants — un gros import peut donc heurter un mur
qui n'a rien à voir avec BMM.

Un **jeton d'accès personnel** (PAT) relève ce plafond. C'est optionnel, et la plupart des gens n'en
ont jamais besoin.

---

## Quand tu en as réellement besoin

| | |
|---|---|
| **Sans authentification** | ~60 requêtes par heure, comptées **par adresse IP** |
| **Avec un jeton** | 5 000 requêtes par heure, comptées par compte |

Soixante par heure suffisent largement en usage normal. Tu heurtes la limite quand une seule action
enchaîne beaucoup de requêtes — importer une `.mmlist` avec des dizaines de mods hébergés sur GitHub
est le cas typique. Le symptôme : une série de téléchargements qui se met soudain à échouer en
**403**, souvent après une rafale qui, elle, avait marché.

!!! note "Par IP, pas par machine"

    Sur une connexion partagée — un foyer, une résidence étudiante, un bureau — les soixante sont
    partagées avec tous les autres. C'est pour ça que la limite peut tomber sans que tu aies rien
    fait d'inhabituel.

---

## Où BMM l'envoie, et où il ne l'envoie pas

Ça mérite d'être précis, parce que c'est un identifiant.

- Le jeton n'est joint **que si l'hôte de l'URL est `github.com` ou `raw.githubusercontent.com`**.
  Un mod hébergé ailleurs — un serveur perso, un miroir, un hébergeur de fichiers — est récupéré
  sans lui. Il ne peut pas fuiter vers un tiers via un lien que quelqu'un a mis dans une liste de
  mods.
- Il part dans un en-tête `Authorization: Bearer` standard, avec l'en-tête de version d'API GitHub.
- Il est stocké dans `data.json` sur ta machine, et n'est jamais envoyé ailleurs.

!!! warning "Il n'est pas appliqué partout où GitHub est utilisé"

    Le chemin de téléchargement des mods l'applique. D'autres échanges avec GitHub — le contrôle de
    mise à jour de l'app, par exemple — non : un jeton ne fera donc pas taire tous les messages de
    limite possibles. Si tu heurtes la limite précisément sur les contrôles de mise à jour, la
    solution est d'attendre.

---

## En créer un

Tu veux **le jeton le moins privilégié qui existe**. BMM ne fait jamais que *lire* des fichiers
publics, il n'a donc besoin d'aucune portée.

1. GitHub → **Settings → Developer settings → Personal access tokens**.
2. Les deux types conviennent. Pour un jeton **fine-grained** : aucune permission de compte, dépôts
   publics uniquement. Pour un jeton **classic** : ne coche **rien** — un jeton classique sans
   portée relève quand même la limite, et c'est tout ce que BMM lui demande.
3. Mets-lui une expiration. Aucune raison que celui-ci vive éternellement.
4. Copie-le — GitHub ne l'affiche qu'une fois.
5. Dans BMM : **Réglages → Identité & API**, colle, enregistre.

!!! danger "Ne lui donne jamais de portée en écriture"

    Un jeton avec `repo` ou un accès en écriture peut modifier tes dépôts. Rien de ce que fait BMM
    ne l'exige : un jeton qui l'a est un risque pur. Si tu as déjà collé un jeton large, révoque-le
    sur GitHub et émets-en un en lecture seule — révoquer est immédiat et gratuit.

---

## Vérifier que ça a marché

Relance ce qui échouait. Si ça échoue toujours au même endroit, le jeton n'est pas appliqué :

- Vérifie qu'il a bien été enregistré (rouvre les Réglages — le champ doit montrer une valeur).
- Vérifie que l'URL qui échoue est réellement sur GitHub. Un mod hébergé ailleurs n'est pas affecté
  par un jeton, par conception.
- Si GitHub dit que le jeton est invalide, il a probablement expiré. Ça arrive, en silence.

---

## Voir aussi

- [Installer BMM](doc-page:getting-started/install) — là où les contrôles de mise à jour et cette
  limite apparaissent en premier.
- [Sécurité](doc-page:how-it-works/security) — comment BMM traite les identifiants en général.
- [.MM Lists](doc-page:features/modlist) — l'import qui heurte le plus souvent la limite.
