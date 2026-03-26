const fs = require('fs');
let lines = fs.readFileSync('js/app.js','utf8').split('\n');
const toRemove = new Set();
for(let i=122; i<=266; i++) toRemove.add(i);
for(let i=1313; i<=1505; i++) toRemove.add(i);
for(let i=2421; i<=2847; i++) toRemove.add(i);

let newLines = lines.filter((_, i) => !toRemove.has(i));

const importStatements = [
  "import { initTitlebar } from './titlebar.js';",
  "import { initNavbarVersion, initUpdateNotes, initAutoUpdate, checkPtbMode, openLicenseModal } from './update-notes.js';"
];

const targetIdx = newLines.findIndex(l => l.includes('import { initDeepLinks }'));
newLines.splice(targetIdx + 1, 0, ...importStatements);

fs.writeFileSync('js/app.js', newLines.join('\n'));
console.log('Successfully spliced app.js and added imports.');
