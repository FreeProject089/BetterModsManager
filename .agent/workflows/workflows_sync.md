---
description: Met à jour automatiquement la liste des workflows et skills après analyse du dossier .agent.
---

# 🔄 Workflow /workflows_sync

Ce workflow permet de maintenir le guide [workflows_help.md](file:///e:/Travaille/CodageAutres/Better Project/BetterModsManager/.agent/workflows/workflows_help.md) à jour en analysant physiquement les fichiers présents sur le disque.

## ⚙️ Protocole de Synchronisation

1. **Audit des Fichiers** :
   - Scan de `.agent/workflows/*.md` pour extraire les descriptions des frontmatters.
   - Scan de `.agent/skills/*/SKILL.md` pour extraire les expertises décrites.
2. **Génération du Guide** :
   - Reconstruction de la section "Workflows" avec les nouvelles commandes détectées.
   - Reconstruction de la section "Skills" avec les expertises à jour.
3. **Mise à Jour** :
   - Écrasement (Overwrite) de `workflows_help.md` avec le nouveau contenu structuré.
4. **Notification** :
   - Informe l'utilisateur des nouveaux outils détectés ou des descriptions mises à jour.

---
// turbo
### 🛠️ Commande de synchronisation (audit rapide)
`dir .agent\workflows\*.md` | `dir .agent\skills\`
