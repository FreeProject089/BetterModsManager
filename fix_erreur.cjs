const fs = require('fs');
const path = require('path');

function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      walk(p);
    } else if (p.endsWith('.ts') || p.endsWith('.js')) {
      let content = fs.readFileSync(p, 'utf8');
      let new_content = content.replace(/'Erreur'/g, "'Error'")
                               .replace(/"Erreur"/g, '"Error"')
                               .replace(/"Erreur de synchro"/g, '"Sync error"');
      if (new_content !== content) {
        fs.writeFileSync(p, new_content);
        console.log('Translated in ' + p);
      }
    }
  }
}

walk('frontend/src');
console.log('Done.');
