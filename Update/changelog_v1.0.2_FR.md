# Changelog v1.0.2 (depuis 60b5f6d, le build 1.0.1)

La 1.0.2 est la version qui remet les mises à jour en état de marche, et la première publiée sur le canal stable depuis la 1.0.0.

## [FIXED] Mettre BMM à jour
### L'installateur démarre, ou dit pourquoi il n'a pas démarré
- L'installateur téléchargé est lancé comme le fait l'Explorateur (ShellExecuteExW) au lieu de passer par un `Start-Process` PowerShell caché. Quand PowerShell échouait, BMM affichait seulement « Launcher "powershell.exe" ... failed with ExitStatus(1) » ; la vraie raison était perdue.
- Un lancement raté est maintenant expliqué en clair, avec l'erreur Windows : invite d'autorisation refusée, fichier encore tenu par un antivirus (plusieurs nouvelles tentatives d'abord), accès refusé par une stratégie de sécurité, ou installateur fermé aussitôt avec un code d'erreur.
- Un installateur qui demande les droits administrateur reçoit l'invite d'autorisation normale de Windows.
- Le programme de mise à jour de BetterInstaller (`uninstall.exe --update`) est lancé de la même façon : une installation sous Program Files ne retombe plus en silence sur le téléchargement complet.
- La vérification via BetterInstaller ne fige plus la fenêtre : elle tourne en arrière-plan et abandonne au bout de 45 secondes.

### Chaque version publie son manifeste de mise à jour signé
- « Update refused: this release publishes no signed update manifest » venait d'une version mise en ligne sans `update-manifest.json`. La chaîne de publication le génère désormais à chaque fois, y liste `BMM-Setup.exe` avec son SHA-256, le signe, le vérifie contre la clé épinglée dans BMM, et publie tous les fichiers en une seule étape.
- Le manifeste listait un ancien setup resté d'un build précédent (`Better Mod Manager_1.0.0_x64-setup.exe`). Il liste maintenant un seul installateur, nommé explicitement.
- BMM choisit lui-même l'installateur parmi les entrées signées ; le lien trouvé par la vérification ne sert qu'à choisir entre elles, donc une version dont le premier fichier n'est pas celui signé n'échoue plus pour rien.

### Une fenêtre de mise à jour plus simple
- Vérification, notes de version, téléchargement, contrôle, installation, redémarrage : un seul bouton (« Télécharger et installer »).
- Le téléchargement affiche sa progression en Mo et reprend là où il s'était arrêté si la connexion coupe ; un fichier repris qui échoue au contrôle est retéléchargé depuis le début.
- Signature et SHA-256 sont vérifiés avant que quoi que ce soit soit écrit ou lancé.
- Tout échec reste affiché dans la fenêtre avec son explication, un bouton « Télécharger depuis la page de la version » et « Réessayer ».

### Publication et versions
- Une seule version partout : `package.json`, `package-lock.json`, `tauri.conf.json`, `Cargo.toml`/`Cargo.lock` et la configuration de l'installateur indiquent 1.0.2. La « 1.0.1 » publiée s'annonçait en 1.0.0 (setup, paquet et update.json) : les copies 1.0.0 installées ne se la voyaient jamais proposer.
- Nouveau contrôle `check-release-versions` : il échoue sur toute version discordante et, en mode publication, vérifie que les deux manifestes sont signés pour cette version au moment de publier, qu'update.json désigne bien ce paquet, et que la version ne porte qu'un seul installateur.
- La version est publiée en « Latest », pas en préversion : le canal stable et BetterInstaller la voient.
- Les anciennes installations continuent de se mettre à jour : la 0.9.11 lance `BMM-Setup.exe` (le seul installateur de la version), les 1.0.x installées par BetterInstaller lisent `update.json` + `bmm.bpkg`, les autres 1.0.x lisent `update-manifest.json` signé.

## [IMPROVED] Sélection dans la bibliothèque
- Activer / Désactiver ne referment plus le mode sélection après le lancement de la tâche.
- Icônes plus parlantes : activer (coche), désactiver (croix), tout sélectionner (liste), ne rien sélectionner (effacer).
- Le filtre par tag n'affiche une pastille de couleur que si le tag n'a pas d'icône.
- Libellé « Multi-profil » raccourci.
