const fs = require('fs');

// --- 1. Splicing app.js ---
let appCode = fs.readFileSync('js/app.js', 'utf8');

// Remove initModals()
appCode = appCode.replace(/\/\/ ── Modals ─+[\s\S]*?(?=\/\/ ── Modlist view ─+)/g, '');

// Add import
const appImports = `import { initModals } from './modals.js';\n`;
appCode = appCode.replace(/(import \{ initSettings, updateDiscordStatus \} from '\.\/settings\.js';\r?\n)/, '$1' + appImports);

// Fix newlines
appCode = appCode.replace(/\n\s*\n\s*\n/g, '\n\n');

fs.writeFileSync('js/app.js', appCode);


// --- 2. Splicing titlebar.js ---
let tbCode = fs.readFileSync('js/titlebar.js', 'utf8');

// Remove window.confirmCustom
tbCode = tbCode.replace(/\s*\/\/ --- Global Confirmation Utility ---[\s\S]*?(?=const toggleFullscreen = async \(\) => \{)/g, '\n\n        ');

// Remove t import if no longer used (although let's leave it in titlebar in case we use it)
// actually titlebar no longer uses t() directly if confirmCustom is removed.
tbCode = tbCode.replace(/import \{ t \} from '\.\/i18n\.js';\r?\n/, '');

// Fix newlines
tbCode = tbCode.replace(/\n\s*\n\s*\n/g, '\n\n');

fs.writeFileSync('js/titlebar.js', tbCode);

console.log('Successfully spliced modals from app.js and titlebar.js.');
