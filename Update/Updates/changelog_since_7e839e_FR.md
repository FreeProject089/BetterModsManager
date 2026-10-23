# Résumé du Changelog (depuis 7e839e6e)

Ce document résume les changements techniques et fonctionnels majeurs introduits dans Better Mod Manager depuis le commit `7e839e6e` jusqu'à la version actuelle.

## Dépôt Serveur & Administration
### [NOUVEAU] Gestion de la Whitelist & des Bans
- Implémentation de `whitelist_manager.rs` et `ban_manager.rs` dans le backend Rust.
- Ajout d'une interface pour la saisie manuelle des adresses IP et des clés créateurs.
- Capacité d'autoriser ou de bloquer des utilisateurs en temps réel.

### [RAFFINEMENT] Refonte de l'interface d'administration
- **Design Premium** : Refonte glassmorphic complète pour les modales de Surveillance, Whitelist et Bans.
- **Améliorations UX** : Ajout de filtres de recherche intégrés et de boutons de copie rapide pour les ID et IP.
- **Interface Unifiée** : Standardisation des mises en page et des en-têtes thématiques pour toute l'administration serveur.

### [NOUVEAU] Surveillance en Direct
- Suivi en temps réel des clients connectés.
- Barres de progression visuelles pour les téléchargements actifs par client.
- Identification de l'IP et du fichier cible pour les hôtes.

### [AMÉLIORÉ] Mini-Serveur
- Raffinement de `server.ps1` pour de meilleures performances en mode standalone.
- Ajout de `launcher.bat` pour une gestion facilitée des privilèges administrateur.

## Moteur de Gestion des Mods & Bibliothèque
### [RAFFINÉ] Système de Dépendances
- **Priorité de l'ordre de chargement** : Le mod parent priorise désormais ses propres fichiers avant ses dépendances.
- **Désactivation en Cascade** : La désactivation d'un mod déclenche désormais une invite pour désactiver optionnellement ses dépendants et prérequis.
- **Interface Améliorée** : Menu déroulant avec recherche dans la modale "Ajouter un mod", affichant tous les mods de la bibliothèque dès le focus.

### [FIXÉ] Navigation & Stabilité de la Bibliothèque
- **Corrections Fonctionnelles** : Résolution du plantage `window.openDocs` pour le bouton "Comment ça marche".
- **Expérience État Vide** : Le bouton "Créer un profil" bascule désormais correctement vers l'onglet Profils et ouvre automatiquement la modale de création.
- **Sécurité RPC** : Ajout de gardes pour `scan_mods_folder` afin d'éviter les erreurs lorsqu'aucun profil n'est actif.

### [FIXÉ] Réactivité de l'UI
- Les badges d'ordre d'activation (`#N`) se rafraîchissent désormais immédiatement lors du basculement des mods sans rechargement manuel.
- Synchronisation des conventions de nommage entre le frontend et le backend (ex: `mod_id`, `mod_folder_path`).

## Localisation & UX
### [AMÉLIORÉ] Internationalisation (i18n)
- **Audit Complet** : Correction de toutes les clés de traduction manquantes en anglais et français.
- **Retours Utilisateur** : Localisation de tous les toasts et messages d'état pour les opérations du dépôt serveur.
- **Cohérence** : Unification des clés de traduction entre `repo.js` et les fichiers dictionnaires JSON.

### [NOUVEAU] Diagrammes Interactifs
- **Architecture Légère** : Nouveau diagramme expliquant la philosophie de "Copie Physique Intelligente" vs liens virtuels.
- **Info-bulles Améliorées** : Tasky fournit désormais des explications plus granulaires sur les étapes logiques du backend.

### [VISUEL] Page des Crédits
- Ajout d'un fond vidéo en boucle pour un aspect premium.
- Synchronisation du numéro de version (v0.9.8) sur toute l'interface.

## Dette Technique & Performance
- Optimisation des appels IPC entre JS et Rust pour une interface plus fluide lors des opérations de masse.
- Correction de plusieurs erreurs de compilation Rust liées à des délimiteurs déséquilibrés.
- Regroupement des sauvegardes d'état de profil pour réduire la charge d'E/S disque.

---
*Généré le : 24 mars 2026*
