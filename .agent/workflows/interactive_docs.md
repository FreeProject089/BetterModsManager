---
description: Workflow for the creation and integration of interactive documentation with Mermaid diagrams and Tasky mascots.
---

# Interactive Documentation Workflow

Follow these steps to add a new interactive diagram to Better Mods Manager.

## 1. Planning the Flow
- Define the core logic steps to visualize.
- Identify "Tasky Moments" (where a mascot should explain a complex step).
- Decide on container groupings (PRE-PROCESSING, etc.).

## 2. Core Implementation
- Create the Mermaid.js definition for the diagram.
- Use `interactive-docs.js` to register the new diagram.
- Define the `data-explanation` attributes for each node.

## 3. UI Integration
- Add the trigger button to the relevant view (FAQ or specific feature page).
- Ensure the button has a recognizable icon (e.g., info-circle or flow-chart).
- Style the button to match the premium theme.

## 4. Tasky Setup
- Map specific nodes to Tasky expressions (Happy, Thinking, Concerned).
- Write concise, helpful explanations for the mascot to "speak".

## 5. Verification
- Open the modal and verify diagram scaling.
- Click/Hover each node to ensure Tasky bubbles appear correctly.
- Test closing the modal and returning to the previous state.
