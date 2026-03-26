const fs = require('fs');
let code = fs.readFileSync('js/app.js', 'utf8');

// 1. Remove GitHub PAT + Discord RPC blocks
code = code.replace(/\/\/ ── GitHub PAT helper ─+[\s\S]*?(?=\/\/ ── Crash Report UI ─+)/g, '');

// 2. Remove Shortcuts block
code = code.replace(/\/\/ ── Settings keyboard shortcuts ─+[\s\S]*?(?=export function escHtml)/g, '');

// 3. Add import at the top
const imports = `import { initSettings, updateDiscordStatus } from './settings.js';\n`;
code = code.replace(/(import \{ initTitlebar \} from '\.\/titlebar\.js';\r?\n)/, '$1' + imports);

// 4. Replace inline Settings bindings in main() with initSettings()
// Specifically: from "// Tags Settings" down to JUST BEFORE "// Show onboarding on first launch"
code = code.replace(/\/\/ Tags Settings[\s\S]*?(?=\/\/ Show onboarding on first launch)/g, 'await initSettings();\n\n    ');

// 5. Replace other references
// find "renderSettingsShortcuts();" and "await initGithubPatSettings();" and "await initDiscordRpcSettings();" and remove them, since they are now grouped in initSettings()!
code = code.replace(/\s*renderSettingsShortcuts\(\);\r?\n\s*await initGithubPatSettings\(\);\r?\n\s*await initDiscordRpcSettings\(\);\r?\n/, '\n');

// Fix newlines
code = code.replace(/\n\s*\n\s*\n/g, '\n\n');

fs.writeFileSync('js/app.js', code);
console.log('Successfully spliced settings from app.js.');
