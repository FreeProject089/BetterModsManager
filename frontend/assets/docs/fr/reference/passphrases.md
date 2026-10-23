# Phrases secrètes, fichiers verrouillés et clés d'identité

!!! danger "Une phrase secrète ne se récupère pas"

    Ni par toi, ni par BMM, ni par personne. Pas de réinitialisation, pas d'indice, aucune
    adresse de support qui puisse ouvrir le fichier. Si tu la perds, la sauvegarde est perdue
    et la liste est illisible — pas *refusée*, **perdue** : ce qu'il y a dedans n'est pas du
    texte lisible derrière un verrou. Il n'est pas là.

    Note-la ailleurs que dans le fichier qu'elle ouvre.

Trois choses écrites par BMM peuvent contenir un secret : une **sauvegarde** (`.DATABMM`),
une **liste de mods partagée** (`.mm`), et tes **clés d'identité**. Les trois utilisent la
même enveloppe, et les règles sont identiques.

## L'enveloppe

Argon2id dérive une clé de la phrase ; AES-256-GCM scelle les octets.

| Choix | Pourquoi |
|---|---|
| **Argon2id** | L'attaquant a le fichier et un temps illimité. Un KDF gourmand en mémoire est la seule chose qui rende coûteux de deviner une phrase tapée à la main. |
| **AES-256-GCM** | Il authentifie. Une enveloppe altérée échoue à s'ouvrir au lieu de se déchiffrer en quelque chose de plausible qu'un lecteur essaierait ensuite de parser. |
| **Paramètres dans le fichier** | Relever le coût plus tard ne doit enfermer personne dehors de ce qu'il a déjà exporté. |

L'enveloppe est du JSON auto-descriptif, pas un blob opaque :

```json
{ "bmm_enc": 1, "kdf": "argon2id", "m": 19456, "t": 2, "p": 1,
  "salt": "…", "nonce": "…", "ct": "…" }
```

Ces fichiers sont inspectés — par les outils de modération de BetterCommunity et par des
humains. « Chiffré, et voici la recette » est un fait sur lequel on peut agir ; un mur de
base64 se fait signaler comme corruption.

## Ce qui est verrouillé, ce qui reste lisible

=== "Sauvegarde (`.DATABMM`)"

    **Toute l'archive.** Une sauvegarde verrouillée cesse d'être un zip : ouvre-la dans 7-Zip
    et il n'y a rien à lister.

    C'est le point. Une invite qui se contente de faire refuser l'écran d'import est un
    panneau sur une porte — le fichier est un zip, et quiconque a un outil d'archive le lit
    quand même. Ce serait un verrou pire qu'inutile ici, puisque son but est précisément de
    rendre raisonnable le fait d'y inclure tes clés privées.

=== "Liste de mods (`.mm`)"

    **Toute la liste**, mods compris — avec un en-tête lisible laissé dehors :

    ```json
    { "bmm_locked": true, "name": "…", "author": "…",
      "game_name": "…", "created_at": "…", "mods_count": 12, "sealed": { … } }
    ```

    L'en-tête est délibéré, et c'est le plus petit qui réponde encore à la question qu'on se
    pose *avant* de décider de demander la phrase à l'auteur. Un `.mm` est lu par BMM, par
    l'inspecteur de BetterCommunity et par quelqu'un qui décide s'il fait confiance : une
    liste que personne ne peut vérifier est pire qu'une liste au contenu privé.

    **La signature est appliquée avant le verrou.** Une signature sur l'enveloppe ne dirait
    que qui a chiffré — pas la question qu'on se pose en ouvrant la liste de quelqu'un.

## Quand BMM la demande

| Où | Quand |
|---|---|
| Export de données | Optionnel. **Obligatoire** si tu inclus des clés d'identité. |
| Restaurer une sauvegarde | Seulement si le fichier est verrouillé, et il le dit. |
| Exporter une liste de mods | **Obligatoire** si tu inclus des identifiants. |
| Importer une liste de mods | Seulement si elle est verrouillée. |
| Installer depuis un catalogue de listes | **À chaque fois**, pour chaque entrée verrouillée. |

!!! note "Pourquoi la dernière ligne n'est pas un oubli"

    Un catalogue est une liste d'adresses que **quelqu'un d'autre contrôle**. Si BMM retenait
    la phrase pour une source, une liste *remplacée à cette adresse* s'ouvrirait avec un
    secret que son nouvel auteur n'a jamais eu. Rien n'est retenu — ni pour la session, ni par
    source.

## Les clés d'identité

Une clé, c'est comment une source protégée sait que c'est toi. La ligne **publique** va à qui
gère la source ; la moitié **privée** ne quitte jamais ta machine et n'est jamais affichée —
seulement l'endroit où elle est allée.

**Paramètres → Identity & API → Clés d'identité → En créer une…**

| Type | Quand |
|---|---|
| `ed25519` | Le défaut, et le bon choix. Toutes les sources de ce protocole l'acceptent, et la clé tient dans un message. |
| `ECDSA` (nistp256) | Un hôte antérieur au support d'ed25519. |
| `RSA 4096` | Pareil, plus ancien. La génération prend quelques secondes — c'est de la recherche de nombres premiers, pas un blocage. |

Chaque type est testé pour **signer**, pas seulement pour se générer : un type produisant un
fichier inutilisable serait une promesse rompue au moment où quelqu'un cherche à joindre un
serveur.

### Une clé qui a sa propre phrase de passe

Une clé OpenSSH que vous possédez déjà peut être protégée par une phrase de passe —
`ssh-keygen` propose d'en mettre une. Ajoutez-la de la même façon : BMM demande la phrase
quand le fichier ne s'ouvre pas, et redemande en disant pourquoi si elle est fausse.

**Elle est gardée le temps de cette exécution, pas davantage.** Redémarrer BMM veut dire
déverrouiller à nouveau, et c'est voulu : le seul endroit où l'écrire serait à côté du chemin
de la clé dans `settings.json`, en clair, juste à côté de ce qu'elle protège.

Pour un script ou un lien, la phrase voyage avec la requête qui en a besoin :

```
bmm://catalog/follow?type=plugin&url=…&key=bmmkey-1a2b3c&passphrase=…
```

```json
POST /api/catalogs
{ "type": "plugin", "url": "…", "key": "bmmkey-1a2b3c", "passphrase": "…" }
```

Ni l'un ni l'autre n'est conservé. `key` accepte un id ou un nom ; la phrase est vérifiée
avant que la clé soit choisie, donc une phrase fausse est signalée comme telle et non comme un
serveur qui ne répond pas.

!!! warning "Un lien qui porte une phrase de passe est un secret"
    Il finit dans l'historique du shell, dans la barre d'adresse, et dans la conversation où
    vous le collez. Préférez laisser BMM demander. N'en envoyez un que là où vous enverriez le
    fichier de clé lui-même.

!!! note "Les clés que BMM fabrique ne sont pas protégées"
    Une phrase de passe inventée par BMM serait une phrase que personne ne peut taper, et en
    demander une au milieu de *fabrique-moi une clé*, c'est une seconde question sur une
    décision que personne n'est venu prendre. Protégez-la ensuite avec `ssh-keygen -p` si vous
    y tenez.

### Les sauvegarder

Une clé est la seule chose dans BMM que tu ne peux pas remplacer en la redemandant. Tout le
reste d'une sauvegarde te coûte un après-midi de configuration ; ça, ça te coûte ce qui prouve
que c'est toi.

**Export de données → Clés d'identité (privées)** les emporte, et BMM refuse de l'écrire sans
phrase secrète. C'est le seul export que supprimer le fichier ensuite ne rattrape pas — à ce
moment-là il est déjà là où vont tes sauvegardes.

## Les identifiants dans une liste partagée

Un `.mm` peut porter les mots de passe et les clés dont ses sources ont besoin. Décoché, les
deux types, demandés séparément.

!!! warning "Ça écrit ce que BMM refuse autrement d'écrire"

    Les mots de passe de téléchargement sont gardés **en mémoire seulement** et jamais
    stockés, parce que les réglages finissent dans les sauvegardes et les rapports de crash.
    Les mettre dans un fichier qu'on donne annule ça **exprès** — donc ça se demande exprès,
    et ce qui est écrit est illisible sans la phrase.

    Ça veut dire aussi que seuls les mots de passe tapés **depuis le lancement de BMM**
    peuvent voyager. Il n'y en a pas d'autres.

Seuls les hôtes *que cette liste vise* sont inclus, et l'écran les nomme avant que tu coches :
savoir si c'est prudent dépend entièrement desquels.

### De l'autre côté

Importer une telle liste pose **deux questions séparées**.

Les **mots de passe** sont proposés pour la session, exactement comme un que tu aurais tapé.

Les **clés** ont leur propre question et un avertissement direct. Une clé de signature, c'est
qui tu es pour toute source qui demande — en installer une depuis un fichier qu'on t'a envoyé
revient à signer sous l'identité de celui qui l'a faite. Un nom déjà présent sur ton trousseau
est **ignoré, jamais écrasé** : importer une liste ne peut pas remplacer la clé avec laquelle
tu signes.
