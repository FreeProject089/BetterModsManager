# Notes de Version - Better Mods Manager v0.9.10

## Améliorations Majeures

### Améliorations du Tunnel Cloudflare
- **Correction des problèmes de résolution DNS** - Le tunnel s'initialise maintenant correctement avec timeout étendu (45s + 5s d'attente)
- **Fenêtre CMD masquée** - Le processus cloudflared s'exécute maintenant complètement en arrière-plan
- **Fiabilité améliorée** - Meilleure gestion des erreurs et stabilité de connexion

### Persistance du Statut du Serveur
- **Correction de la détection du serveur au rafraîchissement** - Le statut du serveur persiste maintenant correctement entre les redémarrages de l'application
- **Vérification intelligente des ports** - Détecte les serveurs en cours d'exécution même si l'état interne est perdu
- **Affichage de statut précis** - L'interface affiche maintenant correctement l'état du serveur après rafraîchissement

### Améliorations du Système de Notifications
- **Notifications de téléchargement par session** - "Téléchargement commencé" s'affiche une fois par session, "Téléchargement terminé" s'affiche quand tout est fini
- **Protection anti-spam** - Empêche l'inondation de notifications pendant les téléchargements multiples
- **Flux de notifications propre** - Meilleure expérience utilisateur avec moins de clutter

### Améliorations du Monitoring de Serveur
- **Affichage unifié des clients** - Affiche tous les clients connectés (inactifs et en téléchargement) sans doublons
- **Affichage propre des creator ID** - Supprime les wrappers Rust Option pour une meilleure lisibilité
- **Suivi des clients en temps réel** - Monitoring précis de tous les utilisateurs connectés

### Améliorations de l'Interface Utilisateur
- **Correction du style de la barre de recherche** - Résolu les problèmes de chevauchement d'icônes dans les modaux Ban/Whitelist
- **Barres de recherche arrondies** - Amélioration de la cohérence visuelle avec design moderne
- **Améliorations des en-têtes de modaux** - Meilleur alignement et design responsive pour les modaux de gestion

### Corrections de Traduction
- **Correction des traductions manquantes** - Ajouté i18n approprié pour "Exporter la liste actuelle" et éléments connexes
- **Localisation complète** - Tous les éléments UI traduisent maintenant correctement entre les langues
- **Traductions des placeholders** - Les champs de formulaire ont maintenant des textes placeholder localisés

### Corrections de Bugs
- **Correction du scan du dossier mods** - Gestion gracieuse quand le dossier mods n'existe pas
- **Résolution des erreurs de notifications toast** - Correction de la fonction toast non définie dans le monitoring de repo
- **Correction des warnings de compilation** - Codebase propre sans warnings cargo
- **Amélioration de la gestion d'erreurs** - Meilleure résilience pour les cas limites et états invalides

## Améliorations Techniques
- **Intégration Windows API** - Ajout du crate Windows approprié pour la gestion des processus en arrière-plan
- **Gestion d'état améliorée** - Meilleurs mécanismes de persistance et récupération
- **Performance optimisée** - Réduction de l'utilisation des ressources et temps de réponse améliorés
- **Qualité du code** - Suppression de tous les warnings de compilation et amélioration de la maintenabilité


---

**Problèmes précédents résolus :**
- Erreurs DNS du tunnel Cloudflare
- Persistance du statut du serveur au rafraîchissement
- Spam de notifications pendant les téléchargements
- Bugs visuels dans les modaux de gestion
- Lacunes de traduction
- Visibilité de la fenêtre CMD
- Warnings de compilation

