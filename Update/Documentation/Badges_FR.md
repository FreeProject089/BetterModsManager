# Référence des Badges de Documentation BMM

Ce document sert de référence visuelle et technique pour tous les badges standard pris en charge par le moteur de rendu Markdown du Better Mods Manager (BMM).

## 🎨 Aperçu Visuel

| Type | Aperçu du Badge | Syntaxe | Cas d'utilisation |
|:---|:---|:---|:---|
| **Nouveauté** | <span style="background:rgba(16,185,129,0.15);color:#10b981;border:1px solid rgba(16,185,129,0.3);padding:2px 10px;border-radius:6px;font-size:11px;font-weight:800;text-transform:uppercase;">NOUVEAU</span> | `[NOUVEAU]` | Nouvelles fonctionnalités ou composants. |
| **Polissage** | <span style="background:rgba(59,130,246,0.15);color:#3b82f6;border:1px solid rgba(59,130,246,0.3);padding:2px 10px;border-radius:6px;font-size:11px;font-weight:800;text-transform:uppercase;">RAFFINEMENT</span> | `[RAFFINEMENT]` | Petites améliorations ou ajustements. |
| **Logique** | <span style="background:rgba(245,158,11,0.15);color:#f59e0b;border:1px solid rgba(245,158,11,0.3);padding:2px 10px;border-radius:6px;font-size:11px;font-weight:800;text-transform:uppercase;">AMÉLIORÉ</span> | `[AMÉLIORÉ]` | Améliorations de la logique ou des performances. |
| **Correction** | <span style="background:rgba(239,68,68,0.15);color:#ef4444;border:1px solid rgba(239,68,68,0.3);padding:2px 10px;border-radius:6px;font-size:11px;font-weight:800;text-transform:uppercase;">FIXÉ</span> | `[FIXÉ]` | Résolutions de bugs et corrections de stabilité. |
| **Interface** | <span style="background:rgba(168,85,247,0.15);color:#a855f7;border:1px solid rgba(168,85,247,0.3);padding:2px 10px;border-radius:6px;font-size:11px;font-weight:800;text-transform:uppercase;">VISUEL</span> | `[VISUEL]` | Changements graphiques, styles ou animations. |
| **Système** | <span style="background:rgba(156,163,175,0.15);color:#9ca3af;border:1px solid rgba(156,163,175,0.3);padding:2px 10px;border-radius:6px;font-size:11px;font-weight:800;text-transform:uppercase;">SYSTÈME</span> | `[SYSTÈME]` | Changements du moteur principal ou du backend. |

## 🛠️ Détails d'Implémentation

Les badges sont automatiquement rendus à l'aide d'un analyseur regex personnalisé dans la fonction `renderMarkdown` de l'interface BMM.

- **Fichiers Anglais** : Utilisez la syntaxe anglaise (ex: `[NEW]`).
- **Fichiers Français** : Utilisez les équivalents de syntaxe française (ex: `[NOUVEAU]`).

> [!TIP]
> Placez toujours les badges au début d'une ligne ou après une puce pour un meilleur alignement visuel.

---
*Généré pour le Standard de Documentation du Better Mods Manager.*
