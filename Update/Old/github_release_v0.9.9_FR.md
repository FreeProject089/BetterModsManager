# Better Mods Manager v0.9.9

Cette version introduit des optimisations de performance significatives, un tout nouveau moteur d'intégrité et une intégration sociale raffinée.

## Performance & Moteurs Core
### [NOUVEAU] Cœur de Performance Backend
- **Vérifications Disques Optimisées** : Le système de surveillance du stockage ne rafraîchit désormais la liste des disques qu'une seule fois par opération, accélérant considérablement l'activation de mods complexes avec de nombreuses dépendances.
- **Intégration du Cache de Fichiers** : Le moteur de copie empilée utilise désormais le cache centralisé au lieu d'effectuer des scans récursifs redondants, réduisant la charge I/O globale jusqu'à 60% lors du déploiement.
- **Renforcement du Code** : Résolution des avertissements du compilateur et optimisation de la manipulation des archives Zip pour une meilleure stabilité.
- **[IMPROVED] Gestionnaire de Stockage** : Détection automatique des lecteurs Cloud (Google Drive, OneDrive, Dropbox, MEGA) et des stockages réseau (NAS/UNC) pour des avertissements de performance plus précis.

## Social & Communauté
### [NEW] Intégration Discord Rich Presence
- **Activité en direct** : Affiche votre profil de jeu actif et le nombre de mods activés à vos amis Discord.
- **Confidentialité d'abord** : Entièrement désactivable depuis le menu Paramètres.
- **Mises à jour réactives** : Changements d'état synchronisés lors du changement de profil ou de l'activation de mods.
- **[NOUVEAU] Support des Deep Links (`bmm://`)** : Installation de mods en un clic directement depuis votre navigateur via le protocole `bmm://import?url=...`.
- **Suivi des Activations Partagées** : Visualisez instantanément quels autres profils utilisent et activent le même mod pour une gestion multi-instance facilitée.
- **Support communautaire** : Ajout d'un bouton "Rejoindre Discord" directement dans la modale de rapport de crash pour une aide instantanée.

## Dépôt Serveur (Mode Serveur)
### [NOUVEAU] Standalone Server (BMM_LW_V2)
- **Suite Administrative Complète** : Finalisation de l'interface de gestion autonome ultra-légère.
- **Sécurité Admin** : Ajout d'une authentification locale par mot de passe avec masquage dynamique (icône œil).
- **Inspecteur de Session** : Nouvelle interface responsive pour surveiller les téléchargements actifs et les métadonnées en temps réel.
- **Gestion des Bannissements** : Possibilité de bannir des IPs ou des IDs de créateurs directement depuis le dashboard.
- **Support Multilingue Intégral** : L'interface d'administration et les options de génération sont désormais disponibles en Français et Anglais.

### [IMPROVED] Gestion des opérations
- **Support de l'annulation** : L'export du serveur et la synchronisation peuvent désormais être annulés en cours de processus.
- **Fiabilité atomique** : Implémentation de gardes `Arc<AtomicBool>` pour assurer une terminaison immédiate sans laisser de handles de fichiers orphelins ou d'archives temporaires.
- **Retour UI** : Les barres de progression se réinitialisent désormais correctement à 0% en cas d'annulation ou d'erreur.

## Documentation & Diagrammes Interactifs
### [NEW] Score de recherche nuancé (v0.9.9)
- **Algorithme pondéré** : Remplacement des correspondances binaires à 100% par un score basé sur le ratio de mots-clés (Parfait, Ancré et Partiel).
- **Retour visuel** : Ajout d'un badge "% de match" à chaque résultat de recherche pour une identification granulaire de la pertinence.

- **Nouveaux schémas techniques** : Ajout de 4 diagrammes interactifs haute fidélité à la galerie :
    - **Moteur d'Intégrité Deep** : Visualise le processus de vérification cryptographique SHA-256.
    - **Cache de Conflits (mtime)** : Détaille notre logique d'optimisation basée sur l'horodatage.
    - **Interactions UI Premium** : Documente le délai de grâce du menu et le système de "rattrapage".
    - **Contrôle d'Accès Système** : Détaille le pont de sécurité entre l'interface et le backend Tauri.
- **Tasky Mascot (Assistance Interactive)** : Tasky fournit désormais des explications contextuelles lors du survol des nœuds et des liens dans les diagrammes.
- **Accessibilité améliorée** : Les entrées de la FAQ arborent désormais une icône de pile "Layers" si elles contiennent un diagramme interactif.
- **Résolution des liens de la galerie** : Correction du lien `semanticSearch` cassé dans la galerie de documentation.
- **Retour visuel** : Ajout d'un halo "Bleu Pulsé" pour les nœuds de diagramme trouvés via la recherche.

### [NEW] Premium Interaction & Polish
- **Animations fluides des menus déroulants** : Implémentation d'animations d'entrée (fade/scale/slide) et de sortie pour le menu d'actions des mods.
- **Période de grâce d'ergonomie** : Ajout d'un délai de 100ms pour éviter la fermeture accidentelle des menus.
- **"Rattrapage" des menus** : Les menus déroulants peuvent désormais être "rattrapés" et rouverts instantanément pendant leur fermeture.
- **Harmonisation des icônes** : Standardisation de toutes les flèches de menu déroulant et des icônes d'ouverture de dossiers (Actif, Backup, Source) pour une cohérence visuelle parfaite.
- **[NEW] Contrôle d'Accès Système (Modale de Sécurité)** : Nouveau système de sélection du mode de sécurité (Complet vs Limité) pour protéger votre système lors de l'utilisation de mods tiers.
- **Polissage du fond** : Correction du flou de fond de la modale de sécurité pour le confiner à la fenêtre de l'application sans masquer la mascotte Tasky.

## Localisation & i18n
- **Gestionnaire de Stockage** : Localisation complète des alertes "Critique" et "Avertissement" pour l'Anglais et le Français.
- **Clusters de diagrammes** : Standardisation des libellés techniques sur tous les schémas interactifs.
- **Audit i18n** : Traduction complète de l'en-tête de recherche "Trouvé dans les diagrammes" et du nouveau système de sécurité.
- **Moteur i18n robuste** : Mise à niveau du moteur de traduction pour prendre en charge les clés complexes imbriquées (ex: `docs.gallery.btn.*`) et les points dans les noms de propriétés.
- **Purge de secours** : Suppression systématique de toutes les chaînes de secours codées en dur dans `mods-details.ts`, `repo.ts`, `profiles.ts` et autres pour imposer une stricte parité i18n.
- **Arrière-plans de profils** : Ajout des clés de traduction complètement manquantes (et suppression des doublons) pour les états d'arrière-plan de profil personnalisés (`prof.bgPendingNotice`, etc.) dans `en.json`, `fr.json` et `template.json`.

## Support & Retours Utilisateurs (BetaHub)
### [NEW] Intégration avancée BetaHub
- **Système de feedback** : Refonte totale de la modale de rapport de suggestions. Les suggestions sont désormais postées proprement sans téléchargements d'images redondants, en tirant parti de la liaison utilisateur native via l'en-tête `FormUser`.
- **Rapports récents** :
    - **Gestion des onglets** : Séparation claire entre `Bugs` et `Suggestions` dans l'historique des paramètres de l'application.
    - **Pagination intelligente** : La vue est désormais limitée à la visualisation des 5 derniers rapports par défaut, associée à un bouton d'expansion dynamique "Voir les plus anciens".
    - **Gestion granulaire** : Ajout d'un bouton "Supprimer" individuel (icône de corbeille) pour oublier en toute sécurité un rapport spécifique de la mémoire locale, en plus de la configuration globale "CLEAR".

## Correctifs de bugs & Stabilité
### [FIXED] UI & Modales
- **Explorateur d'archives** : Correction d'un bug affectant le bon fonctionnement de l'Explorateur d'archives.
- **Modales EULA & Crash** : Correction des problèmes de visibilité des boutons lors de l'accès à l'EULA depuis la section Crédits, et résolution de bugs d'affichage mineurs dans la modale de rapport de crash.
- **Harmonisation des modales de mise à jour** : Unification visuelle des modales "Notes de mise à jour" et "Journal de mise à jour" en utilisant les classes CSS `.ptb-modal-*`.
- **Chargement automatique de la langue** : Les modales chargent désormais automatiquement le fichier `.md` avec le suffixe de langue approprié (`_FR.md` ou `_EN.md`) depuis le dossier racine `@Update`.
- **Padding du contenu** : Correction du padding du contenu des modales (40px 60px) pour empêcher le texte d'être collé aux bords.
- **Bouton de fermeture** : Correction du bouton de fermeture non fonctionnel (en utilisant `modal.remove()` au lieu de `modal.classList.remove('open')`).

### [FIXED] Erreurs de syntaxe critiques
- **Collision lexicale** : Renommage de la variable interne `parent` en `pNode` dans `interactive-docs.ts` pour résoudre une `SyntaxError` de masquage.

### [FIXED] Stabilité RPC & Logique
- **Filtrage de fichiers** : Correction d'un problème de filtrage de fichiers basé sur la langue pour gérer correctement les conventions de suffixe `_XX` (ex: `_EN`, `_FR`) pour la documentation.
- **Stabilité RPC** : Résolution du crash critique `TypeError: getProfiles is not a function` dans la boucle de mise à jour du statut Discord.
- **Sécurité des commandes** : Correction de l'erreur RPC `cancel_repo_export` où la commande n'était pas correctement enregistrée dans le backend.
- **Outil de développement BMM** : Résolution de problèmes fonctionnels mineurs dans l'outil de développement interne BMM.

### [FIXED] Sécurité & Anti-XSS
- **Politique de sécurité du contenu** : Résolution des violations CSP critiques pour durcir la sécurité de l'application et assurer que les ressources externes attendues sont correctement autorisées.
- **Notifications Toast** : Refactorisation de la fonction globale `toast()` dans `app.ts` pour utiliser des structures DOM stériles (`.textContent`), colmatant une vulnérabilité XSS potentielle.
- **Suppression de profil** : Sécurisation de la modale de suppression irréversible de profil dans `profiles.ts` en appliquant strictement les vérifications `escHtml` sur les noms de profil définis par l'utilisateur.
- **Modération BetaHub** : Ajout d'une vérification de texte `isGibberish` à la modale de feedback BetaHub pour empêcher les soumissions de spam dénuées de sens.

### [FIXED] Localisation
- **i18n du gestionnaire de stockage** : Résolution des clés de traduction en double et correction des placements de sections imbriquées dans les fichiers de langue locaux (`en.json`, `fr.json`).
- **Détection de clés de galerie** : Résolution d'un bug où les boutons de la galerie de diagrammes échouaient à détecter leurs traductions en raison de la structure JSON.

## Légal & Conformité
### [NEW] Contrat de licence utilisateur final (EULA)
- **EULA obligatoire de l'installeur** : Intégration d'une page d'accord de licence requise dans les deux installeurs NSIS (.exe) et WiX (.msi) pour assurer la conformité légale.
- **Visionneuse EULA dans l'application** : Ajout d'une section EULA dédiée et localisée dans la page Crédits avec un support complet de rendu Markdown.
- **Localisation communautaire** : Création d'un **Guide de traduction de l'EULA** complet (EN/FR) pour permettre aux membres de la communauté de regrouper facilement leurs propres traductions légales.
- **Clauses de modération** : Formalisation des directives concernant les dépôts de serveurs et la modération des utilisateurs pour un environnement de modding plus sûr.

### [FIXED] Serveur autonome & Dashboard
- **Erreurs de syntaxe JS** : Résolution de bugs critiques empêchant le fonctionnement de la connexion et des actions de bannissement sur le dashboard généré.
- **Dashboard responsive** : La modale de l'Inspecteur de Session s'adapte désormais correctement à toutes les tailles d'écran.
- **UI du dépôt serveur** : Correction de l'icône œil de mot de passe manquante et suppression des effets de survol trompeurs sur les badges statiques "Optionnel".
- **Nettoyage des avertissements Rust** : Élimination systématique de tous les avertissements de compilation et de la mutabilité inutile dans le cœur Rust pour assurer des performances et une stabilité maximales.

## Installation
1. Télécharger BetterModsManager_v0.9.9.exe ou .msi.
2. Lancer l'installeur et suivre les instructions.
3. Lancer l'application.

Liens :
- Site Web : https://freeproject089.github.io/BMM_Web/
- GitHub : https://github.com/FreeProject089/BetterModsManager
- Discord : https://discord.com/invite/CTaaEF9R75

Date de sortie : 1er mai 2026 - 19h00 (Heure de Zurich)
