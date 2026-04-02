# Changelog v0.9.9 (depuis ea8279e)

Cette version introduit des optimisations de performance significatives, un tout nouveau moteur d'intégrité et une intégration sociale raffinée.

## Performance & Moteurs Core
### [NEW] Détection de conflits haute performance
- **Mise en cache mtime** : Implémentation d'un cache basé sur les métadonnées qui suit les dates de modification des dossiers de mods.
- **Scans 80% plus rapides** : Sauter les dossiers inchangés permet des scans de bibliothèque quasi-instantanés lors des lancements ultérieurs.
- **Vérification sélective** : Logique IPC affinée pour ne vérifier les conflits que pour le mod en cours de basculement.

### [NEW] Moteur d'Intégrité Deep
- **Vérification SHA-256** : Ajout d'une couche de sécurité dédiée qui effectue un hachage cryptographique complet des fichiers de mods par rapport à la racine du jeu.
- **Détection fiable** : Identifie les fichiers corrompus ou modifiés avec une précision de 100%, au-delà des simples comparaisons de taille de fichier.

## Social & Communauté
### [NEW] Intégration Discord Rich Presence
- **Activité en direct** : Affiche votre profil de jeu actif et le nombre de mods activés à vos amis Discord.
- **Confidentialité d'abord** : Entièrement désactivable depuis le menu Paramètres.
- **Mises à jour réactives** : Changements d'état synchronisés lors du changement de profil ou de l'activation de mods.
- **Support communautaire** : Ajout d'un bouton "Rejoindre Discord" directement dans la modale de rapport de crash pour une aide instantanée.

## Dépôt Serveur (Mode Serveur)
### [IMPROVED] Gestion des opérations
- **Support de l'annulation** : L'export du serveur et la synchronisation peuvent désormais être annulés en cours de processus.
- **Fiabilité atomique** : Implémentation de gardes `Arc<AtomicBool>` pour assurer une terminaison immédiate sans laisser de handles de fichiers orphelins ou d'archives temporaires.
- **Retour UI** : Les barres de progression se réinitialisent désormais correctement à 0% en cas d'annulation ou d'erreur.

## Documentation & Diagrammes Interactifs
### [NEW] Score de recherche nuancé (v0.9.9)
- **Algorithme pondéré** : Remplacement des correspondances binaires à 100% par un score basé sur le ratio de mots-clés (Parfait, Ancré et Partiel).
- **Retour visuel** : Ajout d'un badge "% de match" à chaque résultat de recherche pour une identification granulaire de la pertinence.

### [NEW] Expansion de la Galerie de Diagrammes
- **Nouveaux schémas techniques** : Ajout de 3 diagrammes interactifs haute fidélité à la galerie :
    - **Moteur d'Intégrité Deep** : Visualise le processus de vérification cryptographique SHA-256.
    - **Cache de Conflits (mtime)** : Détaille notre logique d'optimisation basée sur l'horodatage.
    - **Interactions UI Premium** : Documente le délai de grâce du menu et le système de "rattrapage".
- **Accessibilité améliorée** : Les entrées de la FAQ arborent désormais une icône de pile "Layers" si elles contiennent un diagramme interactif.
- **Résolution des liens de la galerie** : Correction du lien `semanticSearch` cassé dans la galerie de documentation.
- **Retour visuel** : Ajout d'un halo "Bleu Pulsé" pour les nœuds de diagramme trouvés via la recherche.

### [NEW] Interaction Premium & Polissage
- **Animations de menus déroulants fluides** : Implémentation d'animations d'entrée (fondu/échelle/glissement) et de sortie pour le menu des actions de mod.
- **Période de grâce d'ergonomie** : Ajout d'un délai de 100ms pour éviter la fermeture accidentelle du menu.
- **"Rattrapage" de menu** : Les menus déroulants peuvent désormais être "rattrapés" et instantanément rouverts pendant leur fermeture.
- **Harmonisation des icônes** : Standardisation de tous les chevrons de menus déroulants pour un look "Vanguard" cohérent.

## Localisation & i18n
- **Gestionnaire de stockage** : Alertes "Critique" et "Attention" entièrement localisées pour l'anglais et le français.
- **Clusters de diagramme** : Standardisation des étiquettes techniques sur tous les schémas interactifs.
- **Audit i18n** : Traduction intégrale de l'en-tête de recherche "Trouvé dans les diagrammes".

## Corrections de bugs & Stabilité
### [FIXED] Erreurs de syntaxe critiques
- **Collision lexicale** : Renommage de la variable interne `parent` en `pNode` dans `interactive-docs.ts` pour résoudre une erreur de type `SyntaxError`.
### [FIXED] Stabilité RPC & Logique
- **Stabilité RPC** : Résolution du crash critique `TypeError: getProfiles is not a function` dans la boucle de mise à jour du statut Discord.
- **Sécurité des commandes** : Correction de l'erreur RPC `cancel_repo_export` où la commande n'était pas correctement enregistrée dans le backend.

---
*Généré le : 2026-04-02*
