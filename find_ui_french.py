import os, re

words = ['Aucun', 'Tous les', 'Nom du', 'Sélectionnez', 'Dossier', 'Fichier', 'Ajouter', 'Supprimer', 'Modifier']
pattern = re.compile(r'[\'\"].*?(' + '|'.join(words) + r').*?[\'\"]', re.IGNORECASE)

for root, dirs, files in os.walk('frontend/src'):
    for file in files:
        if file.endswith('.ts') or file.endswith('.js'):
            path = os.path.join(root, file)
            with open(path, 'r', encoding='utf-8') as f:
                for i, line in enumerate(f):
                    if pattern.search(line) and 't(' in line:
                        print(f'{path}:{i+1}:{line.strip()}')
