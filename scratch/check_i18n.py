import json
import os

def check_parity(file1, file2):
    with open(file1, 'r', encoding='utf-8') as f:
        data1 = json.load(f)
    with open(file2, 'r', encoding='utf-8') as f:
        data2 = json.load(f)

    keys1 = set(data1.keys())
    keys2 = set(data2.keys())

    missing_in_2 = keys1 - keys2
    missing_in_1 = keys2 - keys1

    return missing_in_1, missing_in_2

if __name__ == "__main__":
    en_path = r"e:\Travaille\CodageAutres\Better Project\BetterModsManager\frontend\Lang\en.json"
    fr_path = r"e:\Travaille\CodageAutres\Better Project\BetterModsManager\frontend\Lang\fr.json"
    
    missing_in_en, missing_in_fr = check_parity(en_path, fr_path)
    
    print(f"Missing in EN: {len(missing_in_en)}")
    for k in sorted(list(missing_in_en)):
        print(f"  - {k}")
        
    print(f"\nMissing in FR: {len(missing_in_fr)}")
    for k in sorted(list(missing_in_fr)):
        print(f"  - {k}")
