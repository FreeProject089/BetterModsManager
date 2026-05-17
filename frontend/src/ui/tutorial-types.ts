// @ts-nocheck
/**
 * tutorial-types.ts — TypeScript interfaces for the BMM tutorial hub system.
 *
 * Tutorials are composed of Parts, which contain Steps.
 * Steps can be purely informational or require a specific user action inside BMM.
 *
 * Adding a tutorial:
 *   1. Create a TutorialDef object in tutorial-data.ts
 *   2. Add translation keys to en.json / fr.json
 *   3. Register the tutorial in the TUTORIALS array (tutorial-data.ts)
 */

export interface TutorialStepAction {
  /** Custom DOM event that signals the action was completed (dispatched via dispatchBmmAction) */
  event: string;
  /** i18n key for the instruction shown in the "action box" */
  desc_key: string;
}

export interface TutorialStep {
  /** Unique within the part, used for progress tracking (e.g. "create") */
  id: string;
  /** i18n key for the step title */
  title_key: string;
  /** i18n key for the step body text */
  text_key: string;
  /** Mascot image path (optional, defaults to Tasky.png) */
  img?: string;
  /** Navigate to this view when step is shown (e.g. "profiles", "library") */
  nav?: string;
  /** CSS selector or element ID to highlight */
  selector?: string;
  /** Multiple selectors to highlight simultaneously (all are shown, removed on action complete) */
  selectors?: string[];
  /** After the primary selector is interacted with (e.g. modal opens), highlight this element */
  modal_selector?: string;
  /** Inline SVG icon HTML to show next to the title */
  icon?: string;
  /** If set, the step waits for this BMM action before allowing Next */
  action?: TutorialStepAction;
  /** If true, the user can skip this step without completing the action */
  optional?: boolean;
}

export interface TutorialPart {
  /** Unique within the tutorial (e.g. "profiles", "scan") */
  id: string;
  /** i18n key for the part title shown in the breadcrumb */
  title_key: string;
  steps: TutorialStep[];
}

export interface TutorialAsset {
  id: string;
  name_key: string;
  desc_key: string;
  /** 'game' = playable sandbox, 'mod' = installable mod, 'modpack' = .MM file */
  type: 'game' | 'mod' | 'modpack';
  /** Description of where the file should go / how to use it (i18n key) */
  usage_key: string;
}

export interface TutorialDef {
  /** Unique across all tutorials (e.g. "basics", "advanced", "other") */
  id: string;
  title_key: string;
  desc_key: string;
  /** SVG icon HTML string */
  icon: string;
  /** CSS color for the card accent (e.g. "var(--accent)", "#f59e0b") */
  color: string;
  parts: TutorialPart[];
  assets?: TutorialAsset[];
}

// ── Progress store ──────────────────────────────────────────────────────────

export type StepState = 'pending' | 'complete' | 'partial' | 'error';

export interface StepStatus {
  state: StepState;
  /** Human-readable detail for partial / error states */
  details?: string;
}

export interface TutorialProgressRecord {
  last_part_id: string | null;
  last_step_id: string | null;
  /** Key: "{partId}:{stepId}" */
  steps: Record<string, StepStatus>;
}

export type TutorialProgressStore = Record<string, TutorialProgressRecord>;
