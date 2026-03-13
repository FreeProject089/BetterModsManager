---
description: Workflow pour garantir une traduction intégrale et sans erreur (i18n)
---
# BMM Agent Workflow : Standard de Traduction (i18n)

Ce workflow doit être suivi pour toute modification d'interface ou ajout de texte afin de garantir que l'application reste **100% bilingue (EN/FR)** et techniquement propre.

## 1. Extraction Systématique (Zéro Hardcoding)
- **Règle d'or** : JAMAIS de texte en clair dans le HTML ou le JS.
- **Frontend (HTML)** : Utiliser l'attribut `data-i18n="cle.maCle"`.
- **Frontend (JS)** : Utiliser la fonction `t('cle.maCle')`.
- **Backend (Rust)** : Passer les clés de traduction ou utiliser des enums traduisibles côté frontend si possible.

## 2. Synchronisation des Fichiers JSON
Après chaque ajout de clé :
1.  **Référencer `i18n_reference.md`** : Consulter [.Assets/i18n_reference.md](file:///e:/Travaille/CodageAutres/Better%20Project/BetterModsManager/.Assets/i18n_reference.md) pour comprendre la structure et l'emplacement des clés.
2.  **Règle de Structure** : Les fichiers JSON sont divisés en sections commençant par `__SECTION_...__`. Chaque section doit rester triée par ordre alphabétique.
3.  **Vérifier `frontend/Lang/en.json`** : Ajouter la nouvelle clé dans la section appropriée.
4.  **Mettre à jour `frontend/Lang/fr.json`** : La clé DOIT exister dans les deux fichiers avec la même structure.
5.  **Mettre à jour `frontend/Lang/template.json`** : Mettre à jour systématiquement le template et sa documentation associée.

## 3. Qualité et Style
- **Documentation** : Chaque nouvelle clé majeure ou changement de structure doit être reporté dans le guide `i18n_reference.md`.
- **Commentaires de Code** : Toujours en **Anglais** pour maintenir un standard de développement international.
- **Ton** : Professionnel, clair et concis. Éviter le jargon trop technique pour l'utilisateur final.
- **Mentions Spéciales** : Les `@beautifulMention` dans les JSON doivent être conservées. Le mode "Server Repo" est un mode serveur pur (pas de P2P).

## 4. Validation (MANDATORY)
- **Check des Missing Keys** : Faire un `grep` rapide pour vérifier si une clé appelée dans le code n'est pas absente d'un des deux JSON.
- **Vérification visuelle** : Lancer l'app et switcher de langue (EN -> FR) pour vérifier l'overflow (le texte français est souvent plus long) et s'assurer que les micro-animations i18n fonctionnent.
- **Bug Bizarre** : Vérifier qu'il n'y a pas de caractères spéciaux mal échappés (ex: `&`, `"`, `'`) qui pourraient faire crash le parseur JSON.

---
// turbo
5. Scan final pour vérifier les fichiers :
`dir frontend/Lang/*.json`
