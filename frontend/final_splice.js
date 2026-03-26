const fs = require('fs');

let appCode = fs.readFileSync('js/app.js', 'utf8');

// 1. Export initNavbarLangDropdown
appCode = appCode.replace(/function initNavbarLangDropdown\(\)/, 'export function initNavbarLangDropdown()');

// 2. Remove initShortcuts() call at old position
appCode = appCode.replace(/\n\s*initShortcuts\(\);/g, '');

// 3. Remove Storage Settings block
// From L1077 (ish) "// ── Storage Performance Settings ──" to JUST BEFORE "// ── Language Settings ──"
appCode = appCode.replace(/\/\/ ── Storage Performance Settings ──[\s\S]*?(?=\/\/ ── Language Settings ──)/g, '');

// 4. Remove Language Settings block
// From L1385 (ish) "// ── Language Settings ──" to JUST BEFORE "// Interaction log"
appCode = appCode.replace(/\/\/ ── Language Settings ──[\s\S]*?(?=\/\/ Interaction log)/g, '');

// 5. Remove runAutoBenchmarks helper
// From L1576 (ish) "async function runAutoBenchmarks" to JUST BEFORE "// ── Profile selector in Library ───────────────────────────"
appCode = appCode.replace(/\/\*\* Run benchmarks for all disks currently in use by profiles \*\/[\s\S]*?(?=\/\/ ── Profile selector in Library ───────────────────────────)/g, '');

// 6. Remove renderSettingsTags helper
// From L1643 (ish) "async function renderSettingsTags()" to JUST BEFORE "// ── Debug Menu ──────────────────────────────────────────"
appCode = appCode.replace(/async function renderSettingsTags\(\)[\s\S]*?(?=\/\/ ── Debug Menu ──────────────────────────────────────────)/g, '');

// 7. Update imports
// Add runAutoBenchmarks to settings imports
appCode = appCode.replace(/import \{ initSettings, updateDiscordStatus, getGithubPat \} from '\.\/settings\.js';/, "import { initSettings, updateDiscordStatus, getGithubPat, runAutoBenchmarks } from './settings.js';");

// 8. Fix leftovers/spacing
appCode = appCode.replace(/\n\s*\n\s*\n\s*\n/g, '\n\n');

fs.writeFileSync('js/app.js', appCode);

console.log('Final splice of app.js completed successfully.');
