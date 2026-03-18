---
description: Workflow for creating new interactive technical diagrams for BMM documentation.
---

# Diagram Creation Workflow

This workflow ensures that every new diagram added to Better Mods Manager is technically accurate, visually premium, and properly integrated.

## 1. Feature Analysis
- **Code Audit**: Analyze the relevant Rust commands in `src-tauri/src/` and frontend logic in `frontend/js/`.
- **Logic Mapping**: Identify the key stages (Analysis, Execution, Finalization) and nodes.
- **Icon Selection**: Choose premium icons from `frontend/css/main.css` (e.g., `icon-build`, `icon-save`, `icon-alert`).

## 2. Mermaid Definition
- **File Creation**: Create `frontend/js/diagrams/[name].js`.
- **Structure**:
    - Use `graph TD`.
    - Group nodes into `subgraph` clusters with premium labels: `"<div class='group-label'><i class='icon-xxx'></i> {{docs.diagram.cluster.XXX}}</div>"`.
    - Use `node-content` for nodes: `NODE_ID["<div class='node-content'><i class='icon-yyy'></i> {{docs.diagram.node.ID}}</div>"]`.
- **Styling**: Ensure all clusters use the standard BMM coloring.

## 3. Localization
- **Keys**: Add the corresponding keys to `frontend/Lang/fr.json` and `en.json`.
- **Consistency**: Ensure technical terms match the codebase (e.g., "Smart Copy", "Stacked Mods", "Chunked Sync").

## 4. Integration
- **Registry**: Register the new diagram in `frontend/js/interactive-docs.js` inside the `DocumentationRegistry` object.
- **Explanations**: Define Tasky mascot explanations for the diagram nodes in the registry.

## 5. Verification
- **Rendering**: Open the app and check for overlaps or label issues.
- **Interactivity**: Verify that hovering over nodes displays the correct Tasky explanations.
