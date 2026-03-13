---
description: Workflow standard pour l'analyse, la résolution et la validation de bugs.
---

# /bug_resolve — Workflow de Résolution de Bugs BMM

Suivez ce processus pour chaque correction de bug afin de garantir une analyse rigoureuse et une validation sans régression.

## 0. Initialisation (PLANNING)
- **Traçabilité** : Créer `findings.md` et `progress.md` avant toute modification technique.

## 0. Initialisation (PLANNING)
- **Traçabilité** : Créer `findings.md` et `progress.md` dès l'identification du bug.

## 1. Analyse Initiale (PRE-FIX)
1. **Identification** : Décrire précisément le comportement anormal.
2. **Localisation** : Identifier les fichiers et les lignes de code responsables.
3. **Analyse de Cause** : Expliquer *pourquoi* le bug se produit (ex: condition manquante, effet de bord CSS, race condition JS).
4. **Code Review Pré-fix** : Utiliser la skill `@/code-review` ou faire une analyse manuelle pour identifier les failles liées à ce code.

## 2. Planification & Fix (EXECUTION)
1. **Plan d'Action** : Documenter la solution choisie dans `implementation_plan.md`.
2. **Implémentation** : Appliquer le correctif en respectant les standards `/bmm_standard`.
3. **Commentaires** : Documenter le correctif dans le code (en anglais pour le backend, clair pour le frontend).

## 3. Revue & Validation (POST-FIX)
1. **Code Review Post-fix** : Demander une nouvelle revue de code pour s'assurer que le correctif est propre et n'introduit pas de nouveaux problèmes.
2. **Test de Non-Régression** : Vérifier que les fonctionnalités liées fonctionnent toujours.
3. **Vérification Visuelle/Logique** : Confirmer que le bug a disparu.

## 4. Documentation & Clôture
1. **Explication du Fix** : Résumer le changement.
2. **Mise à jour du Walkthrough** : Ajouter les preuves.
3. **Notify User** : Informer l'utilisateur.
4. **Clôture IT** : Déclarer le bug résolu dans `progress.md`.
4. **Clôture IT** : Valider toutes les étapes dans `progress.md`.

---
// turbo
## 🔍 Utilisation
Lancez ce workflow en disant : "Applique /bug_resolve sur [nom du bug ou fichier]"
L'agent doit alors créer ou mettre à jour le plan d'implémentation avant toute modification.
