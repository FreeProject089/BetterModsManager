const fs = require('fs');

function findDupes(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const keys = {};
    const dupes = [];

    lines.forEach((line, index) => {
        const match = line.match(/^\s*"([^"]+)":/);
        if (match) {
            const key = match[1];
            if (keys[key]) {
                dupes.push({ key, first: keys[key], second: index + 1 });
            } else {
                keys[key] = index + 1;
            }
        }
    });

    console.log(`Duplicates in ${filePath}:`);
    dupes.forEach(d => console.log(`- ${d.key}: line ${d.first} and ${d.second}`));
}

findDupes('frontend/Lang/en.json');
findDupes('frontend/Lang/fr.json');
