const fs = require('fs');
let code = fs.readFileSync('js/app.js', 'utf8');

// 1. Titlebar (replace everything from Titlebar up to just before Modlist view)
code = code.replace(/\/\/ ── Titlebar ─+[\s\S]*?(?=\/\/ ── Modlist view ─+)/g, '');

// 2. Navbar Version / Update Notes / Render Markdown (up to Offline Detection)
// This also deletes the injectMarkdownStyles IIFE since it's inside that block.
code = code.replace(/\/\/ ── Navbar Version Button ─+[\s\S]*?(?=\/\/ ── Offline Detection ─+)/g, '');

// 3. Auto Update System / Licenses / PTB (up to main())
code = code.replace(/\/\/ ── Auto Update System ─+[\s\S]*?(?=main\(\)\.catch)/g, '');

// Add imports
const imports = `import { initTitlebar } from './titlebar.js';\nimport { initNavbarVersion, initUpdateNotes, initAutoUpdate, checkPtbMode, openLicenseModal } from './update-notes.js';\n`;
code = code.replace(/(import \{ initDeepLinks \} from '\.\/deep_link_manager\.js';\r?\n)/, '$1' + imports);

// Fix trailing newlines if multiple empty lines were left
code = code.replace(/\n\s*\n\s*\n/g, '\n\n');

fs.writeFileSync('js/app.js', code);
console.log('Successfully extracted blocks via Regex.');
