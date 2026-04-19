import json
import os

def compare_json(file1, file2):
    if not os.path.exists(file1) or not os.path.exists(file2):
        print(f"File not found: {file1} or {file2}")
        return
        
    with open(file1, 'r', encoding='utf-8') as f1, open(file2, 'r', encoding='utf-8') as f2:
        data1 = json.load(f1)
        data2 = json.load(f2)
    
    keys1 = set(data1.keys())
    keys2 = set(data2.keys())
    
    missing_in_1 = keys2 - keys1
    
    print(f"Missing in {file1}:")
    for key in sorted(missing_in_1):
        if not key.startswith('__'):
            value = str(data2[key]).replace('"', '\\"')
            print(f'    "{key}": "{value}",')

if __name__ == "__main__":
    compare_json('frontend/Lang/en.json', 'frontend/Lang/fr.json')
