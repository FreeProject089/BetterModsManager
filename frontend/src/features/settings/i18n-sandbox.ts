// The translation sandbox is now the translation studio (translation-studio.ts). This module
// stays as the old entry point: settings.ts and anything else that wires « the sandbox » keeps
// working and opens the studio.
export { initTranslationStudio as initI18nSandbox, openTranslationStudio as openI18nSandbox } from './translation-studio.js';
