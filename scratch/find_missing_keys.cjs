const fs = require('fs');
const html = fs.readFileSync('frontend/index.html', 'utf8');
const fr = JSON.parse(fs.readFileSync('frontend/Lang/fr.json', 'utf8'));
const en = JSON.parse(fs.readFileSync('frontend/Lang/en.json', 'utf8'));
const keysInHtml = [...html.matchAll(/data-i18n=\"(docs\.gallery\.btn\.[^\"]+)\"/g)].map(m => m[1]);
const missingFr = keysInHtml.filter(k => fr[k] === undefined);
const missingEn = keysInHtml.filter(k => en[k] === undefined);
console.log('Missing in fr.json:', missingFr);
console.log('Missing in en.json:', missingEn);
