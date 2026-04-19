import json
from collections import Counter

def find_duplicates(file_path):
    print(f"Checking {file_path}...")
    with open(file_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    keys = []
    for i, line in enumerate(lines):
        line = line.strip()
        if line.startswith('"') and ':' in line:
            key = line.split(':')[0].strip().strip('"')
            keys.append((key, i + 1))
    
    counts = Counter(k for k, _ in keys)
    dupes = {k: counts[k] for k in counts if counts[k] > 1}
    
    if not dupes:
        print("No duplicates found.")
        return
    
    for key, count in dupes.items():
        lines_list = [str(line_num) for k, line_num in keys if k == key]
        print(f"Duplicate key: '{key}' ({count} times) on lines: {', '.join(lines_list)}")

find_duplicates('e:/Travaille/CodageAutres/Better Project/BetterModsManager/frontend/Lang/en.json')
find_duplicates('e:/Travaille/CodageAutres/Better Project/BetterModsManager/frontend/Lang/fr.json')
