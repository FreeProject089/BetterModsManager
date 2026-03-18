---
name: Docs Diagram Master
description: Expert in creating, maintaining, and integrating interactive Mermaid.js diagrams with Tasky mascots for BMM documentation.
---

# Docs Diagram Master

This skill enables the agent to design and implement premium, interactive documentation diagrams for Better Mods Manager (BMM).

## Core Principles
1. **Interactive Excellence**: Diagrams must be more than static images. They should support hover states, clicks for more info, and smooth transitions.
2. **Tasky Integration**: Use the Tasky mascot (@[frontend/assets/Tasky.png]) to guide the user through complex flows with helpful bubbles.
3. **Glassmorphism Design**: Align with BMM's premium aesthetic (translucent backgrounds, subtle borders, vibrant accents).
4. **Contextual Explanations**: Every node in a diagram should be linkable to a detailed explanation or a Tasky speech bubble.

## Technical Standards
- **Engine**: Mermaid.js for core logic, wrapped in a custom interactive layer.
- **Styling**: Vanilla CSS with HSL variables for dynamic theme adaptation.
- **Responsiveness**: Diagrams must scale to full app size without losing clarity.
- **Modularity**: Use the `interactive-docs.js` subsystem to register new diagrams.

## Key Visual Elements
- **Containers**: Group related steps into themed boxes (e.g., "PRE-PROCESSING", "PROCESSING").
- **Tasky Bubbles**: Floating tooltips or speech bubbles from Tasky describing the current node.
- **Highlighting**: Active steps should have a glow or pulse effect.

## Usage Scenarios
- **Resumable Downloads**: Explaining the chunking and verification flow.
- **Sync Logic**: Showing how files move from server to local.
- **Backup System**: Visualizing the safety net for game files.
