const fs = require('fs');
const lines = fs.readFileSync('frontend/Lang/fr.json', 'utf8').split('\n');
const keys = {};
lines.forEach((line, i) => {
    const match = line.match(/^\s*\"([^\"]+)\"\s*:/);
    if (match) {
        const key = match[1];
        if (keys[key]) {
            console.log('Duplicate key: ' + key + ' at lines ' + (keys[key] + 1) + ' and ' + (i + 1));
        }
        keys[key] = i;
    }
});
