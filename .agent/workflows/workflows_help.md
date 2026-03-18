---
description: Guide global sur l'utilisation des workflows et skills de l'agent.
---

# 📖 Guide des Capacités de l'Assistant BMM

Ce guide récapitule toutes les commandes (Workflows) et expertises (Skills) disponibles pour propulser le développement de **Better Mods Manager**.

---

## 🚀 Workflows (Slash Commands `/`)
Les workflows sont des procédures structurées pour accomplir des tâches complexes.

### 🏗️ Développement & Features
- **`/bmm_standard`** : Le standard pour toute modification de code (Rust/JS/CSS).
- **`/feature_delivery`** : Cycle complet pour une nouvelle fonctionnalité (Plan -> Code -> Test -> Doc).
- **`/test_factory`** : Génération automatique de tests unitaires pour sécuriser tes fonctions.
- **`/ui_premium_polish`** : Audit visuel pour garantir le Glassmorphism et les animations "Wow".

### 🐛 Maintenance & Qualité
- **`/bug_resolve`** : Analyse, résolution et validation rigoureuse des bugs.
- **`/review_resolution`** : Application des correctifs suite à une revue de code.
- **`/tech_debt_cleanup`** : Identification et suppression du code mort/warnings.
- **`/translation_quality`** : Synchronisation EN/FR et qualité des fichiers de langue.

### 📝 Documentation & Release
- **`/docs_maintenance`** : Mise à jour automatique de la doc technique et de la FAQ.
- **`/documentation_standards`** : Règles de rédaction pour les fichiers `.md`.
- **`/release_gen`** : Compilation des changements et création de notes de version.

### 🧠 Évolution de l'Agent
- **`/skill_evolve`** : Audit et amélioration continue de mes propres Skills.
- **`/workflows_help`** : Affiche ce guide récapitulatif.
- **`/workflows_router`** : Analyse ta demande pour te suggérer le bon workflow/skill.
- **`/workflows_sync`** : Met à jour ce guide automatiquement en analysant le dossier `.agent`.

---

## 🛠️ Skills (Mentions `@`)
Les skills sont des expertises activables pour des analyses pointues.

- **`@code-review`** : Analyse de code pour détecter bugs, failles et optimisations.
- **`@performance-analyst`** : Profilage et optimisation de la vitesse (JS/Rust).
- **`@security-hardener`** : Audit de sécurité Tauri et intégrité des données.
- **`@i18n-master`** : Maîtrise avancée de l'internationalisation et du ton Tasky.
- **`@evolution-architect`** : Expert en efficacité opérationnelle de l'agent.

---

## 💡 Comment utiliser ?
Invoque simplement une commande au début de ton message pour activer le protocole associé :
> *"Utilise le workflow /ui_premium_polish sur la nouvelle modale."*
> *"Fais une @code-review sur mon dernier commit."*

---
// turbo
### 🔍 Scan système des outils
`dir .agent\workflows\*.md` | `dir C:\Users\FreeProject\.gemini\antigravity\skills\`
