import os

def merge(target, temp, marker):
    try:
        with open(target, 'r', encoding='utf-8-sig', errors='ignore') as f:
            content = f.read()
        with open(temp, 'r', encoding='utf-8') as f:
            diag = f.read()
        
        idx = content.find(marker)
        if idx == -1:
            print(f"Marker not found in {target}")
            return False
        
        eol = content.find('\n', idx)
        if eol == -1: eol = idx + len(marker)
        
        head = content[:eol].rstrip()
        if not head.endswith(','): head += ','
        
        with open(target, 'w', encoding='utf-8') as f:
            f.write(head + '\n' + diag)
        print(f"Successfully merged {target}")
        return True
    except Exception as e:
        print(f"Error merging {target}: {e}")
        return False

path_fr = r'e:/Travaille/CodageAutres/Better Project/BetterModsManager/frontend/Lang/fr.json'
path_en = r'e:/Travaille/CodageAutres/Better Project/BetterModsManager/frontend/Lang/en.json'
tmp_fr = r'e:/Travaille/CodageAutres/Better Project/BetterModsManager/tmp/diag_fr.txt'
tmp_en = r'e:/Travaille/CodageAutres/Better Project/BetterModsManager/tmp/diag_en.txt'

merge(path_fr, tmp_fr, '"repo.selectSyncTasks"')
merge(path_en, tmp_en, '"repo.selectSyncTasks"')
