import os, re

french_words = re.compile(r'[\'"][^\'"]*\b(Impossible|Fichier|Dossier|Attention|Nouveau|Erreur|Succès|Copie|Terminé|Annuler|Valider)\b[^\'"]*[\'"]', re.IGNORECASE)

for root, dirs, files in os.walk('frontend/src'):
    for file in files:
        if file.endswith('.ts'):
            path = os.path.join(root, file)
            with open(path, 'r', encoding='utf-8') as f:
                for i, line in enumerate(f):
                    if french_words.search(line) and 't(' not in line and 'console' not in line:
                        print(f'{path}:{i+1}:{line.strip()}')
