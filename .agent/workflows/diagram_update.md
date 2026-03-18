---
description: Workflow for auditing and updating existing technical diagrams to maintain coherence with the codebase.
---

# Diagram Update Workflow

This workflow is used when the application's internal logic changes (e.g., switching from symlinks to physical copies) to ensure documentation remains accurate.

## 1. Trigger Audit
- Identify the features that have been modified in the backend (`src-tauri/src`).
- Select the relevant diagrams from `frontend/js/diagrams/`.

## 2. Technical Cross-Referencing
- **Icon Check**: Ensure all icons used are still present in `main.css`. Replace any `icon-help` or placeholder icons with premium ones.
- **Logic Sync**: Verify if the node connections (`-->`) still represent the actual code flow.
- **Terminology Update**: Scan for obsolete terms (like "symlink" if replaced by "Smart Copy") and update them in the diagram JS and JSON lang files.

## 3. Cluster & Label Refinement
- Ensure `group-label` elements have the correct `foreignObject` coordinates in `interactive-docs.js` if global logic has changed.
- Verify that cluster IDs and titles reflect the current system modularity.

## 4. Localization Sync
- Update `fr.json` and `en.json` to reflect the technical changes.
- Ensure 100% translation coverage for any new nodes or clusters.

## 5. Validation
- Run the app and iterate through the updated diagrams.
- Check Tasky mascot explanations for coherence with the new logic.
