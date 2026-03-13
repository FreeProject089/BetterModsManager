---
name: Security Hardener
description: Expertise en sécurisation des applications Tauri et audit d'intégrité des données.
---
# Security Hardener v2

Expertise de haut niveau en sécurisation de runtime Tauri et cryptographie appliquée.

## 🎯 Objectifs Critiques
- **Isolation du Bridge** : Empêcher toute exécution de code arbitraire via les `invoke` Tauri.
- **Data Authenticity** : Garantie totale de l'intégrité des dépôts via signatures Ed25519.
- **Local Secret Safety** : Protection des tokens PAT et IDs créateurs en stockage local.

## 🛠️ Capacités Avancées (v2)
1. **Audit de Signature** : Revue des flux de signature `repo.json` (usage de `ed25519_dalek`).
2. **Sanity Check des Chemins** : Prévention des attaques de type *Path Traversal* (vérification que les chemins de mods restent dans le `ModsFolder`).
3. **IPC Hardening** : Analyser `tauri.conf.json` pour limiter les `allowlist` au strict nécessaire.

## 📋 Protocole d'Audit (v2)
1. **Analyse de Surface** : Identifier les points d'entrée (inputs utilisateur, URLs de repo, fichiers ZIP).
2. **Vérification des Gardes-fous** :
    - Validation Regex des entrées.
    - Checksum obligatoire avant extraction.
    - Sandboxing des actions disque.
3. **Threat Modeling** : Simuler un dépôt malveillant (repo.json corrompu) pour tester la résistance du système.

---
*Skill activé via `@security-hardener`*
*Version: 2.0.0 (Evolution Architect optimized)*
