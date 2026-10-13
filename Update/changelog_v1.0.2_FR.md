# Changelog v1.0.2 (depuis 60b5f6d, le build 1.0.1)

La 1.0.2 est la version qui remet les mises à jour en état de marche, la première publiée sur le canal stable depuis la 1.0.0, et celle qui garde une preuve de chaque réponse que vous donnez sur la confidentialité.

## [FIXED] Mettre BMM à jour
### L'installateur démarre, ou dit pourquoi il n'a pas démarré
- L'installateur téléchargé est lancé comme le fait l'Explorateur (ShellExecuteExW) au lieu de passer par un `Start-Process` PowerShell caché. Quand PowerShell échouait, BMM affichait seulement « Launcher "powershell.exe" ... failed with ExitStatus(1) » ; la vraie raison était perdue.
- Un lancement raté est maintenant expliqué en clair, avec l'erreur Windows : invite d'autorisation refusée, fichier encore tenu par un antivirus (plusieurs nouvelles tentatives d'abord), accès refusé par une stratégie de sécurité, ou installateur fermé aussitôt avec un code d'erreur.
- Un installateur qui demande les droits administrateur reçoit l'invite d'autorisation normale de Windows.
- Le programme de mise à jour de BetterInstaller (`uninstall.exe --update`) est lancé de la même façon : une installation sous Program Files ne retombe plus en silence sur le téléchargement complet.
- La vérification via BetterInstaller ne fige plus la fenêtre : elle tourne en arrière-plan et abandonne au bout de 45 secondes.

### Chaque release porte son manifeste de mise à jour signé
- « Update refused: this release publishes no signed update manifest » venait d'une release publiée sans `update-manifest.json`. Toutes les façons de publier le construisent maintenant, y listent `BMM-Setup.exe` avec son SHA-256, le signent, le vérifient contre la clé que BMM épingle, et publient tous les fichiers en une fois : le workflow de release, le `release.ps1` de BetterInstaller et `npm run release:assets`.
- Le manifeste listait un installateur périmé, resté d'un ancien build. Il en liste désormais exactement un, nommé explicitement, et une release ne porte qu'un seul installateur.
- Les deux manifestes signés expirent 7 jours après la signature : ils sont donc signés au moment de publier, puis renouvelés deux fois par semaine par la tâche de re-signature.
- BMM choisit lui-même l'installateur parmi les entrées signées : une release dont le premier fichier n'est pas celui qui est signé n'échoue plus pour rien.

### Une fenêtre de mise à jour plus simple
- Vérification, notes de version, téléchargement, contrôle, installation, redémarrage : un seul bouton (« Télécharger et installer »).
- Le téléchargement affiche sa progression en Mo et reprend où il s'était arrêté si la connexion tombe ; un fichier repris qui échoue au contrôle est retéléchargé depuis le début.
- Signature et SHA-256 sont vérifiés avant que quoi que ce soit soit écrit ou lancé.
- Tout échec reste dans la fenêtre avec son explication, un bouton « Télécharger depuis la page de la version » et « Réessayer ».

### Release et versions
- Une seule version partout : `package.json`, `package-lock.json`, `tauri.conf.json`, `Cargo.toml`/`Cargo.lock` et la configuration de l'installateur disent tous 1.0.2. La « 1.0.1 » publiée s'annonçait comme 1.0.0 : les copies 1.0.0 installées ne se la voyaient jamais proposer.
- Nouveau contrôle `check-release-versions` : il échoue sur tout écart de version et, en mode release, vérifie que les deux manifestes sont signés pour cette version au moment de publier, que update.json nomme ce paquet, et que la release ne porte qu'un installateur.
- La release est publiée comme « Latest », pas comme pré-version : le canal stable et BetterInstaller la voient.
- Les anciennes installations continuent de se mettre à jour : la 0.9.11 lance `BMM-Setup.exe` (le seul installateur de la release), les 1.0.x installées par BetterInstaller lisent `update.json` + `bmm.bpkg`, les autres 1.0.x lisent le `update-manifest.json` signé.

## [NEW] Preuve du consentement : « Mes consentements »
- Chaque réponse sur les Conditions d'utilisation, la Politique de confidentialité et la télémétrie laisse une preuve : le document, sa version, le SHA-256 du texte exact affiché, la langue, votre réponse (et chaque catégorie), l'heure, l'endroit où vous avez répondu (installateur, premier lancement, Paramètres, un lien `bmm://`, l'API locale, la ligne de commande, le serveur MCP, un import) et la version de BMM.
- Les preuves sont rattachées à un identifiant d'installation aléatoire, jamais à votre Creator ID ni à votre matériel.
- Elles sont conservées sur votre PC dans une chaîne en ajout seul qui révèle toute modification : une preuve modifiée, retirée ou insérée est détectée.
- Paramètres → Confidentialité → **Mes consentements** les liste, indique si la chaîne est intacte, les exporte en JSON et peut les envoyer au serveur.
- L'installateur transmet à BMM une preuve pour chaque texte légal accepté ; BMM n'y voit une preuve que si le texte correspond à l'un de ceux qu'il livre.
- Une réponse sans preuve est redemandée : après une mise à jour depuis 1.0.x, après l'import d'anciens réglages, ou quand un document change.
- Avec la télémétrie activée, les preuves sont copiées sur le serveur de télémétrie, où elles sont stockées en ajout seul, sans adresse IP ni texte, et peuvent être exportées ou effacées par identifiant d'installation.

## [IMPROVED] Politique de confidentialité et Conditions d'utilisation, réécrites
- La Politique de confidentialité s'ouvre maintenant sur l'inventaire de toutes les connexions de BMM et de son installateur : quoi, quand, à qui, pourquoi, base légale, conservation, comment le désactiver, et le réglage par défaut.
- Corrigé : l'étape de confidentialité de l'installateur (*Tout accepter* vaut consentement, *L'essentiel uniquement* un refus), *Tout accepter* qui active Discord Rich Presence, et le modèle Laya hors ligne téléchargé par défaut pendant l'installation.
- Nouvelles sections : qui est responsable, les preuves de consentement, ce qui est stocké sur votre PC, vos droits et comment les exercer.
- La version anglaise prévaut si les textes anglais et français divergent. Les deux documents portent une version, et BMM vous demande d'accepter les nouvelles.

## [NEW] Server Repo : versions de format
- Un manifeste de dépôt indique maintenant le format dans lequel il est écrit (`format_version`), signé avec le reste.
- La page Server Repo affiche le format de chaque dépôt, et convertit un ancien manifeste après avoir montré ce qui va changer, en gardant une sauvegarde.
- Un dépôt écrit dans un format plus récent que celui que lit ce BMM est refusé avec un message clair au lieu de se charger à moitié.

## [IMPROVED] Laya
- Analysez les mods de ce profil, de plusieurs profils ou de tous à la fois ; le même mod installé dans plusieurs profils n'est analysé qu'une fois et ses suggestions s'appliquent à chaque copie.
- « Tout appliquer » montre ce qui va changer, champ par champ, avant d'écrire quoi que ce soit, et le dernier lot peut être annulé.

## [IMPROVED] Tutoriels
- Le guide amène à l'écran le contrôle dont il parle : il ouvre l'onglet ou la section où il se trouve et ferme une fenêtre qui le cache quand elle ne contient pas de modification.
- Quand un contrôle ne peut pas être montré, le guide dit où il se trouve, avec « Montre-moi » pour réessayer.
- Les traducteurs ont une référence de toutes les variables qu'un texte peut utiliser.

## [NEW] Crédits
- Les contributeurs au code de BMM, BetterCommunity, BMM Docs et BetterInstaller.
- Chaque paquet intégré avec son lien et sa licence, lisible dans l'application.

## [VISUAL] Démarrage et thèmes
- Une animation de démarrage plus courte et plus calme, centrée sur le logo ; rien ne bouge avec « moins d'animations ».
- Nouveau thème intégré : BMM Logo.

## [IMPROVED] Planificateur
- Les permissions d'une tâche se replient sur une ligne (« 2 sur 9 accordées · Modifier »), pour que les options restent visibles.

## [IMPROVED] Sélection dans la bibliothèque
- Activer / Désactiver ne referment plus le mode sélection après avoir lancé l'opération.
- Des icônes plus claires : activer (coche), désactiver (croix), tout sélectionner (liste), ne rien sélectionner (effacer).
- Le filtre par tag n'affiche une pastille de couleur que si le tag n'a pas d'icône.
- Libellé « Multi-profil » raccourci.

## [IMPROVED] Installateur
- L'étape de confidentialité ne pose qu'une question, comme un bandeau cookies, sans rien de présélectionné : *L'essentiel uniquement*, *Tout accepter* ou *Personnaliser*.
- *Tout accepter* n'active jamais le rapport matériel hebdomadaire (numéros de série, UUID de la machine, adresses MAC) : seul *Personnaliser* le peut, et la carte le dit.
