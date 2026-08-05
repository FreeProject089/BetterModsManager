# Plan d'enregistrements — les clips restant à faire

Chaque clip dont la doc a besoin, ce qu'il doit montrer, et où il atterrit. Deux formats :

| Format | À utiliser pour | Pourquoi |
|---|---|---|
| **`.bmmreplay`** (rrweb) | Tout ce qui se passe *dans BMM* | Il rejoue le **DOM** : le texte reste sélectionnable, ça s'adapte à n'importe quel écran, ça pèse une fraction d'une vidéo, et le même fichier se lit dans BMM Docs, dans Aide & autres, et sur BCWEB |
| **`.mp4`** | Tout ce que rrweb ne peut pas capturer | Boîtes natives, installeur, lancement du jeu, sélecteur de fichiers de l'OS, page UPnP du routeur — rien de tout ça n'est dans le DOM de BMM |

> [!IMPORTANT]
> **Enregistre depuis le profil de démo 🎓, en démasqué.** C'est l'inverse de la règle pour un rapport
> de bug, et la raison compte : le masquage remplace chaque nom de mod et de profil par `••••`, ce qui
> est exactement ce qu'il faut quand tu envoies un enregistrement à quelqu'un, et inutile dans un clip
> pédagogique où tout l'intérêt est de voir *quel* mod tu as activé. Le profil de démo ne contient
> aucune donnée réelle : le démasquer ne fuite rien.
>
> Deux exceptions, qui doivent rester **masquées** parce que c'est le masquage qu'elles démontrent :
> `bmm-demo.bmmreplay` sur la page confidentialité, et tout clip portant sur l'interrupteur *Complet*.
>
> Le masquage est appliqué à la capture — un enregistrement démasqué ne peut pas être masqué après
> coup, et un masqué ne peut pas être démasqué. Décide avant d'appuyer sur enregistrer.

---

## État actuel

Treize fichiers `.bmmreplay` existent et **les treize sont identiques octet pour octet** — un seul
enregistrement générique de 25,3 Mo copié sous treize noms (~330 Mo de git-lfs pour un clip). Chaque
page de fonctionnalité affiche donc les mêmes images, quel que soit ce qu'elle documente.

L'objectif ci-dessous est de les remplacer par des clips ciblés. **Faire pointer plusieurs pages sur un
même fichier ne coûte rien** — ce qui n'est pas acceptable, c'est treize copies des mêmes octets.

> [!TIP]
> Quand un vrai clip remplace un placeholder, supprime l'ancien fichier dans le même commit et vérifie
> `git lfs ls-files` — un `.bmmreplay` commité avant que `.gitattributes` ne le couvre entre comme blob
> normal.

---

## A. `.bmmreplay` — clips in-app

Chaque ligne : le fichier, la ou les pages qui l'intègrent, et ce que le clip doit réellement montrer.
Vise **40 à 90 secondes**. Bouge posément : un replay se rejoue à vitesse réelle et l'hésitation se lit
comme de la confusion.

### Priorité 1 — les pages qu'un nouvel utilisateur voit en premier

| Fichier | Pages | Ce qu'il faut montrer |
|---|---|---|
| `profiles.bmmreplay` | `features/profiles`, `how-it-works/profiles-activation` | Créer un profil (les trois dossiers), puis **changer de profil et montrer que rien n'a bougé dans le dossier du jeu** — c'est le comportement le plus mal compris de BMM. Puis activer un mod pour que le contraste soit visible |
| `library.bmmreplay` | `features/library` | Importer un mod, l'activer, montrer le nombre de fichiers et le badge d'intégrité. Puis activer un second mod **en conflit**, et ouvrir la vue des conflits |
| `mapper.bmmreplay` | `features/mapper`, `how-it-works/mapper` | Une archive mal empaquetée (un dossier trop bas). Lancer le **Diagnostic de structure**, sélectionner la racine du mod, la déposer dans le bon dossier du jeu, montrer **l'arbre virtuel qui se met à jour sans que rien ne bouge encore**, puis Enregistrer |
| `settings.bmmreplay` | `features/settings` | Une visite : changement de thème, de langue, la carte stockage, la liste des raccourcis. Un clip d'orientation, pas un approfondissement |

### Priorité 2 — les fonctionnalités qui vendent l'app

| Fichier | Pages | Ce qu'il faut montrer |
|---|---|---|
| `modpacks.bmmreplay` | `features/modpacks` | Construire un modpack depuis les mods actifs d'un profil, tout désactiver, puis appliquer le pack et voir la liste revenir |
| `repo.bmmreplay` | `features/repo`, `how-it-works/sync-repos` | Connecter un dépôt, synchroniser, et — l'intérêt du clip — **re-synchroniser après une petite modification** pour que le transfert fasse quelques Mo et pas toute la collection |
| `scheduler.bmmreplay` | `features/scheduler`, `reference/actions` | Construire une tâche avec une **condition et une branche** : benchmarker un disque, et s'il est sous un seuil, afficher une notification. C'est ce qui distingue le planificateur d'un cron |
| `storage.bmmreplay` | `features/storage` | **Actuellement manquant** — la page pointe provisoirement sur `bmm-demo`. Montrer Smart I/O, lancer l'Auto-calibration, appliquer un plafond Mo/s par disque, et l'espace libre par profil |
| `themes.bmmreplay` | `features/themes` | Appliquer deux thèmes intégrés, puis ouvrir l'éditeur et changer un token pour que le re-rendu live soit visible |

### Priorité 3 — le reste

| Fichier | Pages | Ce qu'il faut montrer |
|---|---|---|
| `plugins.bmmreplay` | `features/plugins` | Installer un plugin, lui accorder une permission, lancer un test d'API rapide, puis montrer le journal API qui réagit |
| `apps.bmmreplay` | `features/apps` | Parcourir le catalogue, installer une app, la lancer. Inclure la **demande de checksum** si tu arrives à la déclencher — c'est le passage intéressant |
| `community.bmmreplay` | `features/community` | Parcourir BetterCommunity, utiliser un lien d'installation en un clic, et montrer la confirmation que BMM affiche |
| `modlist.bmmreplay` | `features/modlist` | Exporter un `.mmlist`, vider un profil, le réimporter |
| `bmm-demo.bmmreplay` | `features/privacy-telemetry`, `reference/tips` | La visite générale. **Garde celui-ci masqué et générique** — c'est le clip qui sert à montrer à quoi ressemble le masquage, il faut donc que les `••••` soient visibles à l'écran |

### Optionnels, mais ils documentent des choses qu'aucun texte ne rend

| Fichier | Où | Ce qu'il faut montrer |
|---|---|---|
| `conflicts.bmmreplay` | `how-it-works/conflicts` | Deux mods partageant un fichier. Activer A, activer B, montrer que B gagne. Désactiver B, montrer le fichier de A **qui revient** — la restauration à trois voies est impossible à faire passer en prose |
| `integrity.bmmreplay` | `how-it-works/integrity-hashing` | Lancer un contrôle (il passe), modifier un fichier du dossier du mod hors de BMM, relancer, et montrer `modified` plus le badge d'avertissement persistant |

---

## B. `.mp4` — ce que rrweb ne peut pas capturer

rrweb enregistre le DOM de BMM. Tout ce qui est dessiné par Windows ou par un autre programme lui est
**invisible** : un replay de ces moments montre une fenêtre BMM figée et rien d'autre.

| Clip | Durée | Ce qu'il faut montrer |
|---|---|---|
| `install-windows.mp4` | ~60 s | Téléchargement → l'avertissement SmartScreen et comment le passer → installation → premier lancement. C'est l'étape SmartScreen qui bloque les gens |
| `first-profile.mp4` | ~90 s | Tout le premier parcours, y compris les **sélecteurs de dossiers natifs** qu'un replay ne peut pas montrer. Se termine sur un mod activé et le jeu lancé |
| `game-launch.mp4` | ~20 s | Un launch pack qui démarre le jeu et ses outils compagnons — l'intérêt, ce sont les apps qui apparaissent, donc hors de BMM |
| `repo-host.mp4` | ~90 s | Générer un serveur autonome, le lancer sur une seconde machine, et y connecter un client. Implique un terminal et éventuellement une page de routeur |
| `crash-report.mp4` | ~45 s | Provoquer un crash, montrer le rapport et le replay de session attaché. La fenêtre de rapport et les boîtes de fichiers sont natives |

> [!NOTE]
> Enregistre en **1920×1080**, garde BMM à sa taille de fenêtre par défaut, et le thème sombre par
> défaut sauf si le clip porte sur le thème. Coupe les sons système. Pas de traînée de curseur ni de
> surbrillance de clic — ça date très vite les images.

---

## C. Le harnais — `scripts/record-take.mjs`

Mettre l'app dans un état identique avant chaque prise, c'est la moitié pénible du travail — et
c'est celle qui fait qu'on ne refait pas une prise ratée. Elle est donc scriptée :

```bash
node scripts/record-take.mjs --list
node scripts/record-take.mjs conflicts            # état → armer l'enregistreur → attendre → exporter
node scripts/record-take.mjs conflicts --dry-run  # affiche le plan, ne change rien
node scripts/record-take.mjs themes --no-record   # met juste l'état en place
```

Il active le bon profil, désactive les mods, déclenche le deeplink dont le clip a besoin, allume
l'enregistreur avec le bon masquage pour ce clip, puis **s'arrête et affiche ce que tu dois
jouer**. Tu appuies sur Entrée quand c'est fait, il exporte et coupe l'enregistreur.

> [!NOTE]
> **Pourquoi il ne scripte pas aussi les clics.** rrweb enregistre de vrais événements pointeur et
> clavier. Une action déclenchée par l'API n'en produit aucun : une prise entièrement scriptée se
> rejoue avec l'interface qui change et aucun curseur nulle part — ça se lit comme un bug, pas
> comme un tutoriel. Le harnais automatise ce qui peut l'être sans ce coût.

Points pratiques :

- **BMM doit tourner.** Si rien ne répond, le harnais te le dit et te rappelle qu'un port occupé
  désactive l'API pour toute la session au lieu d'en prendre un autre — redémarre BMM.
- Le token d'API est lu directement dans `data.json` : tu ne le colles jamais, et il n'est jamais
  affiché.
- Les noms de mods et de profils sont matchés de façon floue, mais un nom **ambigu** est une erreur
  qui liste les candidats plutôt qu'une devinette — `HD Texture Pack` se résout, `HD` non.
- Le masquage par scénario est déjà réglé dans le bon sens (voir la note en haut de ce fichier) ;
  `privacy-masked` est celui qui enregistre masqué exprès.

Ajouter un clip = un bloc dans la map `SCENARIOS` en haut du fichier : la page concernée, s'il est
masqué, les étapes de préparation, et les lignes `perform` que tu veux voir réaffichées.

## D. Checklist par clip

- [ ] Enregistré **masqué** (sauf si le clip porte sur le démasquage).
- [ ] Rien de personnel à l'écran : vrais chemins, noms de comptes, pseudos Discord, e-mail.
- [ ] Moins de 90 secondes, et il fait **une** chose.
- [ ] Se termine sur un écran stabilisé — pas en pleine animation, pas sur un toast qui va disparaître.
- [ ] `.bmmreplay` : se rejoue dans l'app (importe-le) **et** sur le site de doc avant de commiter.
- [ ] `.bmmreplay` : commité via **git-lfs** ; `git lfs ls-files` le liste.
- [ ] `.mp4` : H.264, sans piste audio sauf si elle porte de l'information.
- [ ] La légende de la page ne dit plus « placeholder ».
- [ ] `python -m mkdocs build --strict` passe toujours, et la garde replay de la CI est verte.

---

## Voir aussi

- *Intégrer replays & vidéo* — la directive `:::replay`, le div `bmm-replay`, la config git-lfs.
- *Compiler BMM Docs — le site et le PDF* — la compilation, et les deux défaillances silencieuses que
  les gardes CI attrapent désormais.
