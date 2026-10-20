# Les nouveautés de BMM 1.0

La 1.0 est la version qui a fait de Better Mods Manager plus qu'un simple interrupteur de mods : des profils qui survivent à une mise à jour du jeu, des mods reconnus par leur contenu, un ordre que vous maîtrisez, des plugins et des automatisations, des catalogues et des repos que l'on peut suivre, et un assistant facultatif qui ne quitte jamais votre PC. Cette page raconte la 1.0 dans son ensemble (1.0.0, 1.0.1 et 1.0.2). Les notes de correctifs qui suivent, la 1.0.3 et après, sont dans la liste à côté et comptent moins que cette page.

> Vous cherchez un correctif ou un chiffre précis ? Choisissez une version dans la liste à gauche. Vous voulez savoir ce que BMM sait faire aujourd'hui ? Lisez d'abord cette page, puis le **Guide d'utilisation** dans Help & other.

## [MAJOR] Votre installation vous appartient, pas au jeu
- Les **profils** gardent séparés les mods, les dossiers et les sauvegardes de chaque jeu. Une mise à jour du jeu ou une réinstallation n'efface plus ce que vous avez construit.
- **ContentID** : un mod est reconnu par ses fichiers, pas par le nom de son dossier. Les mêmes fichiers donnent la même identité sur n'importe quel PC, donc les listes `.MM`, les modpacks et les repos retrouvent les bons mods.
- **Intégrité** : empreintes SHA-256 et audit en profondeur. Un mod dont un fichier manque ou a changé affiche un bouclier rouge et ne peut pas être activé par erreur.
- **Ordre d'activation** : quand deux mods fournissent le même fichier, le dernier de l'ordre gagne. Voyez-le, faites-le glisser, partagez-le en code ou en lien, ré-appliquez-le. La **vue Conflits** (1.0.3) montre qui gagne chaque fichier partagé.
- **Mapper** : un arbre visuel de n'importe quel dossier de mod, pour comprendre pourquoi un jeu l'ignore.

## [MAJOR] Partager et suivre
- Les **modpacks** et les **listes `.MM`** transportent une installation chez un ami, avec l'ordre et ce dont les sources ont besoin.
- **Dépôt Serveur** : hébergez un repo depuis un profil, un modpack ou un dossier, en HTTP, en SSH ou en fichiers statiques. Un ami le **suit**, et BMM le vérifie au rythme choisi, puis prévient, télécharge ou applique la mise à jour (jamais pendant qu'un jeu tourne).
- Les **catalogues** (apps, plugins, thèmes, tutoriels, listes de mods) partagent un seul écran et un seul format. Des flux signés et des phrases secrètes protègent ceux que vous voulez protéger.
- **App Catalog** : installez et lancez des applications compagnes en un clic.

## [MAJOR] Lui faire faire plus
- **Plugins** : un manifeste, une liste de mods à appliquer, des scripts fournis derrière des permissions explicites, installés depuis un catalogue ou un fichier `.bmmplug`.
- **Planificateur et BMMScript** : des automatisations en blocs ou en texte, avec conditions, boucles et branches parallèles. Une automatisation partagée ne peut jamais s'accorder le droit de lancer des programmes.
- **API locale, CLI et serveur MCP** : pilotez BMM depuis un Stream Deck, un script ou un agent IA, avec un jeton et des permissions par plugin.
- **Launch packs** : démarrez un groupe de programmes en un clic, sans console qui clignote.

## [MAJOR] Apprendre, personnaliser, comprendre
- Des **tutoriels interactifs** qui pointent la vraie application, que vous pouvez aussi écrire, traduire et partager.
- **Help & other** : le Guide d'utilisation, des diagrammes interactifs, la documentation complète hors ligne, Ask Laya et la palette de commandes (Ctrl+K).
- **Thèmes** : un éditeur de thème complet, des thèmes intégrés, clair et sombre bien faits. Une barre de navigation personnalisable et vos propres pages.
- **Français et anglais**, complets, et un studio de traduction pour les autres langues.

## [MAJOR] Laya, facultative et locale
- Un classifieur intégré à BMM propose le nom, la version, l'auteur, la description et les étiquettes d'un mod à partir de ses propres fichiers. Rien n'est écrit tant que vous n'avez pas coché puis cliqué sur Appliquer.
- **Ask Laya** répond en langage simple avec les pages d'aide, réglages et actions qui existent.
- Pas de Python, pas de serveur, rien d'envoyé. Désactivée tant que vous ne l'activez pas.

## [MAJOR] Discret sur votre PC
- Un **gouverneur de ressources** : chaque tâche lourde passe par une seule file avec Pause, Reprise et Annuler, et une intensité de travail à votre choix.
- **Mode application** : BMM s'efface pendant que le jeu ou le programme que vous modifiez tourne.
- Un **gestionnaire de stockage** pour les disques, les limites de vitesse et l'activité en direct.

## [NEW] Mises à jour, confidentialité et confiance (1.0.2)
- **Mises à jour en un clic** : BMM télécharge, vérifie le manifeste signé et le SHA-256, puis lance l'installateur, ou vous dit en clair pourquoi il n'a pas pu.
- **Centre d'activité** pour chaque tâche en cours, **Outils BMM** pour des vérifications en lecture seule, **Mes consentements** pour un reçu infalsifiable de chaque réponse sur la confidentialité.
- La télémétrie reste désactivée tant que vous n'êtes pas d'accord, et la Politique de confidentialité liste chaque connexion que fait BMM.

## Pour la suite
- Les notes de chaque version sont dans la liste à gauche, de la plus récente à la plus ancienne.
- La 1.0.3 ajoute le centre de notifications, la vue Conflits, les panneaux dans leur propre fenêtre et des Paramètres plus calmes.
- Nouveau dans BMM ? Ouvrez **Help & other** et commencez par le **Guide d'utilisation** : chaque tâche a de courtes étapes, une image et un bouton **Montre-moi**.
