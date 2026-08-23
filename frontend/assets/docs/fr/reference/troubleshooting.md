# Dépannage

Commence ici avant de réinstaller quoi que ce soit. À peu près trié du « plus probable » au « là il y a
vraiment un problème ».

!!! tip "La seule habitude qui vaille"
    **Réglages → Données → Exporter** avant tout changement radical. Ça écrit un fichier, ça prend une
    seconde, et c'est la différence entre un mauvais après-midi et une installation perdue.

---

## Mods et profils

### Le jeu se comporte comme si le mod n'était pas là

Presque toujours l'empaquetage, pas BMM. L'archive a un dossier de trop, donc le jeu cherche `Data/` et
trouve `MonMod-v3/Data/`. Ouvre le [Mapper](doc-page:features/mapper), lance le **Diagnostic de
structure**, et vérifie le chemin final *avant* d'appliquer.

### Un mod que j'ai désactivé est toujours actif

Deux profils pointent sur le même dossier de destination. BMM prévient à la configuration — c'est *une source
majeure d'erreur humaine*. Note que les profils partageant **à la fois** le dossier de destination et le dossier
mods gardent leurs listes actives synchronisées, mais pas ceux qui ne partagent que le dossier de *jeu* :
chacun déploie au même endroit et aucun ne sait ce que l'autre a laissé. Donne à chaque profil son propre
dossier mods. Voir [Profils & activation](doc-page:how-it-works/profiles-activation).

### J'ai changé de profil et rien n'a changé

C'est le comportement correct. **Changer de profil ne déplace aucun fichier** — ça change la liste que tu
édites. Ce qui est déployé reste déployé jusqu'à ce que tu le désactives. C'est la surprise la plus
fréquente dans BMM.

### Deux mods se battent — l'un écrase l'autre

C'est un [conflit](doc-page:features/library#conflicts), et c'est attendu : ils livrent le même fichier. BMM
te montre exactement quels fichiers se recouvrent. Il n'y a pas de sélecteur par fichier ni de liste de
priorités — **le dernier mod activé gagne**, donc active en dernier celui qui doit gagner. Voir
[Conflits](doc-page:how-it-works/conflicts).

### Un mod affiche une icône d'avertissement dans la Bibliothèque

Son dernier contrôle d'intégrité a échoué, et BMM s'en souvient d'un redémarrage à l'autre. Relance le
contrôle pour voir quels fichiers sont `missing`, `modified` ou `added`. Note que le *premier* contrôle
d'un mod n'échoue jamais — il établit la baseline — donc un échec signifie que quelque chose a changé
depuis. Voir [Intégrité & hachage](doc-page:how-it-works/integrity-hashing).

### J'ai annulé une activation — mon dossier de destination est à moitié moddé ?

Non. Annuler tue le worker puis lance une passe d'annulation en opération inverse : les écritures
partielles sont reverties. Un **kill de force ou une coupure de courant**, c'est différent : il n'y a pas
de journal, donc un déploiement partiel peut survivre. C'est quand même sûr — les sauvegardes
`_original/` sont écrites *avant* qu'on écrase quoi que ce soit, les fichiers propres du jeu n'ont donc
jamais été en danger. Réactive le mod pour terminer la copie, ou désactive-le pour nettoyer entièrement.

---

## Disques et chemins

### Mes mods ont disparu après avoir débranché un disque

Non. BMM détecte une racine inaccessible et **garde** les entrées existantes au lieu de les purger — *« ne
pas brasser l'état hors ligne »*. Rebranche le disque et le scan suivant réconcilie. Le hachage est sauté
pendant l'absence, aucune donnée d'intégrité n'est donc corrompue non plus.

### La lettre du lecteur a changé et tout est cassé

Celui-là, BMM ne peut pas le corriger pour toi. Les profils stockent des **chemins absolus**, donc `E:\Mods`
devenu `F:\Mods` demande de corriger chaque chemin concerné dans le profil. Rien n'est perdu — les chemins
pointent juste vers une lettre qui n'existe plus.

### Un mod avec des accents, du chinois, ou des `#`/`@`/`-` dans le nom

Supporté. Les chemins sont manipulés comme des chaînes OS de bout en bout, pas comme des chaînes d'octets,
et les noms qui deviennent des noms de fichiers sont assainis à chaque frontière. Si un *jeu* gère mal un
tel nom, renomme le dossier du mod — BMM le ré-identifiera par son contenu, il garde donc son identité.

---

## Performances

### Mon PC rame pendant l'activation des mods

**Réglages → Stockage.** Active **Smart I/O** et lance l'**Auto-calibration** une fois — elle benchmarke
tes disques et cadence les copies. Si ça saccade encore, pose un **plafond Mo/s** explicite pour ce
disque.

À savoir : si le dossier de destination ou de sauvegarde est sur ton **disque système**, BMM réduit déjà les
copies à un seul thread quel que soit ton réglage, parce que Windows lui-même a besoin de la marge.
Déplacer le dossier mods hors de `C:` est le plus gros gain disponible.

### L'activation est plus lente qu'une simple copie de fichiers

Par conception. Le débit maximal est échangé contre une fenêtre réactive : pools de threads plafonnés,
budget de yield sur la boucle de copie, et un worker en priorité I/O de fond. Voir
[Performances](doc-page:how-it-works/performance), et lance le benchmark intégré pour voir les vrais chiffres
sur ton matériel.

### BMM consomme beaucoup de mémoire au bout d'un moment

Ouvre la fenêtre DevTools et referme-la — tant qu'elle est ouverte, c'est un processus séparé de *~480
Mo*.

L'**enregistreur de session** n'est plus un suspect : il écrit ses événements sur le disque au fur et
à mesure, donc une session de n'importe quelle durée coûte environ un demi-mégaoctet de mémoire à
l'app. Ce qu'il consomme, c'est du **disque** — une fenêtre glissante de 512 Mo sous `Spool/`, plus ce
que ta rétention de replays sauvegardés autorise (Réglages → Confidentialité). Le **Replay Studio** des
DevTools est celui qui bufferise encore en mémoire, délibérément, et il s'arrête à 64 Mo au lieu de
grossir.

---

## Mises à jour, dépôts et API

### BMM dit qu'un mod n'a pas de mise à jour, mais je sais que si

Si la source du mod est un **téléchargement direct**, BMM est honnête :

> Aucune mise à jour détectée. Un téléchargement direct n'a pas de version, donc BMM ne peut
> pas savoir s'il est plus récent que ce que vous avez — mais vous pouvez le re-télécharger à
> tout moment.

Il n'y a rien à comparer. Relie le mod à un [dépôt](doc-page:features/repo) qui publie des versions, ou
utilise le re-téléchargement direct.

### Une synchro de dépôt dit qu'un fichier a échoué

Le hash du fichier téléchargé ne correspondait pas à ce que le dépôt a publié, et BMM traite ça comme une
erreur, pas un avertissement. Réessaie — un transfert reprisé ne re-télécharge que les chunks qui
diffèrent, un réessai est donc bon marché. Si ça échoue de façon répétée, le hash publié et le fichier
hébergé sont réellement en désaccord ; c'est à l'hébergeur de corriger.

### Une synchro ne démarre pas — il dit qu'une autre tourne déjà

Une seule synchro à la fois (`409`). Annule celle en cours ; elle s'arrête à la prochaine frontière de
mod, pas au milieu d'un fichier.

### Un script ou un plugin n'arrive pas à joindre l'API locale

Vérifie `GET http://127.0.0.1:51274/api/health` d'abord. Si rien ne répond, la cause la plus probable est
que **le port était déjà pris au démarrage de BMM** — typiquement une instance zombie après un
redémarrage in-app. BMM ne **bascule pas** sur un autre port : l'API est désactivée pour toute la session
et une ligne part dans le journal de crash. Redémarre BMM. Voir la [référence API](doc-page:reference/api).

### Un plugin reçoit 403 sur quelque chose qu'il devrait pouvoir faire

L'erreur nomme la permission manquante et la route qui l'accorde. Note le piège inverse aussi : certaines
routes sont **token seul**, un plugin sans aucune permission peut donc les appeler — la référence liste
lesquelles.

---

## Un modpack ne s'applique pas entièrement

La carte dira que des mods sont manquants ou corrompus, et proposera **Réparer**. Lance-le. Un pack qui ne
peut pas s'appliquer entièrement explique bien plus de bugs que le jeu. Si un pack est *censé* sauter la
vérification, c'est l'option *ignorer le contrôle d'intégrité* par pack — pas une option globale.

---

## Quelque chose va vraiment mal

Dans l'ordre :

1. **Réglages → Données → Exporter.** Toujours en premier.
2. **Regarde le journal de crash.** Réglages → Débogage a le dossier. Un marqueur de sortie propre fait
   que BMM distingue un crash d'une fermeture normale : le journal te dit donc lequel c'était.
3. **Cherche un `.bak`.** `data.json` garde une sauvegarde tournante et BMM la récupère automatiquement si
   le fichier principal est illisible. Un fichier principal corrompu est conservé sous
   `data.corrupt-<horodatage>.json` plutôt que supprimé : rien n'est jeté en silence.
4. **Réinitialisation d'usine** — Réglages → Débogage. **Aucune annulation.** Exporte avant de t'en
   approcher.

!!! info "Toujours bloqué ?"
    Le hub **Aide & autres** dans l'app a les mêmes articles plus 41 diagrammes, et
    [BetterCommunity](doc-page:features/community) est l'endroit pour demander.
