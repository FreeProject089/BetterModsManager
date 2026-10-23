# Repo : uploader des mods et les faire détecter, sans accès local au repo

Proposition de conception. **Rien de ce qui existe n'est modifié** : `repo.json`, les
checksums, la signature, la synchro client restent exactement ce qu'ils sont. Ce document
ajoute un chemin à côté.

## Le problème, tel que tu l'as posé

Aujourd'hui, mettre à jour un repo suppose que **BMM voie le dossier du repo**. Si le serveur
est distant, chaque ajout de mod devient : télécharger le repo, régénérer, tout re-uploader.
Long et pénible, donc les repos ne sont pas maintenus.

Ce qu'on veut : quelqu'un dépose des mods sur son FTP avec son client habituel, et le
`repo.json` se met à jour sans rapatrier le dossier.

## La vraie question : qui calcule les hashes

Tout le reste en découle. Trois réponses possibles, avec leur coût réel.

**① BMM télécharge tout et hashe.** Correct, aucune confiance accordée au serveur, mais
re-télécharge chaque mod à chaque génération. Inutilisable au-delà de quelques Go.

**② Le serveur calcule.** Il faudrait exécuter quelque chose côté serveur — exactement ce
qu'on a promis d'éviter (« un simple nginx suffit »). Écarté.

**③ Détection par métadonnées, hash à la demande.** Le listing (FTP `MLSD` ou l'autoindex
HTTP) donne **taille + date** par fichier. On les compare au `repo.json` précédent : tout ce
qui n'a pas changé garde son hash existant, **déjà vérifié**. Seuls les fichiers nouveaux ou
modifiés sont téléchargés une fois pour être hashés.

**Recommandation : ③.** Premier passage = coût d'un téléchargement complet. Ensuite, ajouter
un mod de 200 Mo coûte 200 Mo, pas la taille du repo.

### Ce que ③ change pour la sécurité — à ne pas éluder

Taille + date sont des **indices**, pas des preuves. Un serveur compromis peut remplacer un
fichier en conservant taille et date, et BMM recopierait l'ancien hash sur un contenu neuf.

C'est acceptable **uniquement parce que le hash n'est pas le garant de la confiance ici** :
le `repo.json` est signé (ed25519), et la signature est produite **sur ta machine**, pas sur
le serveur. Un attaquant qui modifie un fichier sans toucher au manifeste sera détecté par
le client au téléchargement — le hash ne correspondra pas. Le risque réel se limite à :
tu re-signes un manifeste décrivant un fichier que tu n'as pas revérifié.

Deux garde-fous, tous deux à implémenter :

- **Re-hash complet à la demande** (« Tout revérifier »), et automatiquement si le
  `repo.json` précédent n'est pas signé par ta clé.
- **Le rapport dit toujours ce qui a été supposé** : « 3 mods re-hashés, 148 repris du
  manifeste précédent ». Silencieux, ce serait un raccourci que personne ne peut auditer.

## Découverte des mods

Deux sources, selon ce que le serveur expose :

| Source | Prérequis | Donne |
|---|---|---|
| **FTP/SFTP** `MLSD` | identifiants déjà utilisés pour uploader | noms, tailles, dates — fiable |
| **Autoindex HTTP** | `autoindex on` sur nginx | idem, mais parsing HTML fragile |

**Recommandation : FTP/SFTP en principal.** L'utilisateur a déjà ces identifiants — c'est
avec eux qu'il a uploadé. Et ça permet la pièce qui manque vraiment : **ré-uploader le
`repo.json` automatiquement**. Sans ça on résout la détection et pas la publication.

L'autoindex HTTP reste un mode dégradé pour un serveur en lecture seule.

Note : ça ne contredit pas « BMM ne parle pas `ftp://` ». Les **téléchargements clients**
restent en http(s). Le FTP ne sert qu'à l'auteur, pour la maintenance.

## Le flux proposé

```
[auteur dépose ses mods par FTP, comme d'habitude]
                 │
   BMM « Vérifier le repo distant »
                 │
   listing FTP ──┴── comparaison avec le repo.json distant
                 │
      ┌──────────┴───────────┐
   inchangé              nouveau/modifié
      │                       │
 hash repris            téléchargé + hashé
      └──────────┬───────────┘
                 │
        repo.json régénéré + resigné (localement)
                 │
        uploadé par FTP — un seul fichier
```

Un mod supprimé du serveur sort du manifeste, et le rapport le nomme : un chemin mal tapé
produit sinon un manifeste valide décrivant un serveur vide.

## Validation — ce qu'il faut ajouter

Le système actuel valide un `repo.json` **qu'on vient d'écrire**. Ici il faut valider un
manifeste **qu'on relit depuis un serveur**, ce qui est un cas différent :

1. **Signature** : si le manifeste distant n'est pas signé par ta clé, ne jamais reprendre
   ses hashes — quelqu'un d'autre l'a écrit. Re-hash complet.
2. **Cohérence listing/manifeste** : un fichier présent dans le manifeste et absent du
   listing est signalé, pas ignoré silencieusement.
3. **Dérive de disposition** : les mods doivent rester sous `files_layout`. Un dossier
   déposé ailleurs doit produire un avertissement, pas une entrée invisible.

## Découpage proposé

| Étape | Contenu | Risque |
|---|---|---|
| 1 | Client FTP/SFTP : connexion, `MLSD`, `RETR`, `STOR` | faible, isolé |
| 2 | Comparateur listing ⇄ manifeste (pur, testable sans réseau) | faible |
| 3 | Génération incrémentale : reprise des hashes + téléchargement ciblé | moyen |
| 4 | Upload du `repo.json` + rapport | faible |
| 5 | UI dans l'onglet Host, à côté de « Manifeste seul » | faible |

Les étapes 2 et 3 sont là où les bugs coûteront cher, et ce sont les seules entièrement
testables hors ligne. À couvrir en premier.

## Ce que je te demande de trancher

1. **FTP/SFTP en principal** — d'accord, ou tu préfères l'autoindex HTTP d'abord ?
2. **Où vivent les identifiants ?** Le trousseau de l'OS, ou le fichier de config chiffré
   déjà utilisé pour les autres secrets ?
3. **Re-hash complet** : sur demande uniquement, ou aussi automatique tous les N passages ?

Tant que ce n'est pas tranché, l'étape 1 peut être écrite : elle ne dépend d'aucune des
trois réponses.

---

# État au 11 août 2026

## Décision prise : pas de dépendance FTP

Le plan ci-dessus proposait FTP/SFTP pour **lister** le serveur et **y renvoyer** le
manifeste. À l'implémentation, ces deux moitiés se sont révélées très inégales.

Le listing est la moitié qui compte — c'est elle qui transforme « retélécharger tout le
repo » en « hasher le mod qui a changé ». Et nginx la publie déjà avec `autoindex on`, sur
le même http(s) que les téléchargements. Donc **aucune dépendance, aucun mot de passe
stocké, aucun FTP en clair**.

Le renvoi du `repo.json` est un petit fichier, uploadé avec le client FTP dont l'auteur se
sert déjà pour les mods. Ajouter `ssh2`/`suppaftp` et stocker un mot de passe serveur pour
automatiser *ça* était disproportionné.

`repo_credentials.rs` garde la forme d'un transport si on veut l'automatisation plus tard.

## Fait et testé (69/69)

| Couche | Fichier | Tests |
|---|---|---|
| Listing HTTP + crawl borné | `commands/repo_autoindex.rs` | 7 |
| Plan de rafraîchissement | `commands/repo_remote.rs` | 8 |
| Identifiants (session seule) | `commands/repo_credentials.rs` | 5 |
| `RepoFile.mtime` | `models/repo.rs` | via les précédents |

Commande exposée : `plan_remote_repo_refresh(baseUrl, manifestPath, forceFull)` — **lecture
seule**, dit ce qui serait hashé, réutilisé, retiré, et combien d'octets à télécharger.

## Reste à faire

**L'exécution** — `refresh_repo_from_server()` : télécharger les fichiers du plan, les
hasher via `compute_file_hash_and_chunks`, fusionner avec les entrées reprises, regrouper
par premier segment de chemin, resigner, écrire.

Points à ne pas rater en l'écrivant :

- Une entrée reprise doit garder ses **chunk hashes**, pas seulement son sha256 — les
  perdre désactiverait la reprise par plages pour des fichiers que personne n'a touchés.
- Le `mtime` écrit doit être **celui du listing**, pas `now()` : le rafraîchissement suivant
  compare à ce que le serveur rapporte, et notre horloge ferait paraître tout modifié.
- Les **métadonnées du mod** (nom, tags, changelog, update sources) viennent du manifeste
  précédent. Un rafraîchissement porte sur le contenu des fichiers ; réinitialiser le nom
  d'un mod à son nom de dossier annulerait une curation que personne n'a demandé d'annuler.
- Resigner avec `author_id`/`signature` remis à `None` d'abord, comme partout ailleurs.

**L'UI** — une carte dans l'onglet Host, à côté de « Manifeste seul ».
