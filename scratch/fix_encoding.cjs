const fs = require('fs');
const paths = ['frontend/Lang/fr.json', 'frontend/Lang/en.json'];

const map = {
    'Ã©': 'é',
    'Ã¨': 'è',
    'Ã ': 'à',
    'Ã´': 'ô',
    'Ã»': 'û',
    'Ãª': 'ê',
    'Ã®': 'î',
    'Ã¯': 'ï',
    'Ã§': 'ç',
    'Ã‰': 'É',
    'Ãˆ': 'È',
    'Ã€': 'À',
    'Ã”': 'Ô',
    'Ã›': 'Û',
    'ÃŠ': 'Ê',
    'ÃŽ': 'Î',
    'Ãcf': 'ï', // some weird ones
    'ǟ': 'à',
    'Ǹj': 'é',
    'DÃ©pÃ´t': 'Dépôt',
    'DÃ©sactivation': 'Désactivation',
    'BibliothÃ¨que': 'Bibliothèque',
    'FranÃ§ais': 'Français',
    'VÃ©rification': 'Vérification',
    'VÃ©rifier': 'Vérifier',
    'ParamÃ¨tres': 'Paramètres',
    'DÃ©jÃ ': 'Déjà',
    'activÃ©e': 'activée',
    'partagÃ©e': 'partagée',
    'personnalisÃ©e': 'personnalisée',
    'DÃ©pÃ´t': 'Dépôt'
};

paths.forEach(p => {
    if (!fs.existsSync(p)) return;
    let content = fs.readFileSync(p, 'utf8');
    
    // Remove BOM if present
    if (content.charCodeAt(0) === 0xFEFF) {
        content = content.slice(1);
    }
    
    // Replace broken patterns
    Object.keys(map).forEach(key => {
        const regex = new RegExp(key, 'g');
        content = content.replace(regex, map[key]);
    });
    
    // Also try to fix any remaining double-encoded UTF-8
    try {
        // This is a trick to fix double encoding: decode as latin1 then encode as utf8
        // But only if it looks like it's broken
        if (content.includes('Ã')) {
             const buf = Buffer.from(content, 'binary');
             // This is risky, let's stick to the map for now or use a proper decoder
        }
    } catch (e) {}

    fs.writeFileSync(p, content, 'utf8');
    console.log(`Sanitized ${p}`);
});
