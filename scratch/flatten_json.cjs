const fs = require('fs');

function flatten(obj, prefix = '') {
    let result = {};
    for (const key in obj) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
            Object.assign(result, flatten(obj[key], fullKey));
        } else {
            result[fullKey] = obj[key];
        }
    }
    return result;
}

function processFile(path) {
    const data = JSON.parse(fs.readFileSync(path, 'utf8'));
    const info = data._info;
    delete data._info;
    
    const flattened = flatten(data);
    
    // Put _info back at the start
    const finalData = { _info: info, ...flattened };
    
    fs.writeFileSync(path, JSON.stringify(finalData, null, 4), 'utf8');
    console.log(`Flattened: ${path}`);
}

processFile('frontend/Lang/en.json');
processFile('frontend/Lang/fr.json');
