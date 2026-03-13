import json
import os

def check_i18n():
    en_path = r'frontend\Lang\en.json'
    fr_path = r'frontend\Lang\fr.json'
    
    if not os.path.exists(en_path):
        print(f"Error: {en_path} not found")
        return
    if not os.path.exists(fr_path):
        print(f"Error: {fr_path} not found")
        return

    with open(en_path, 'r', encoding='utf-8') as f:
        en = json.load(f)
    with open(fr_path, 'r', encoding='utf-8') as f:
        fr = json.load(f)
        
    en_keys = set(en.keys())
    fr_keys = set(fr.keys())
    
    missing_in_fr = en_keys - fr_keys
    missing_in_en = fr_keys - en_keys
    
    print(f"--- I18N AUDIT REPORT ---")
    print(f"Keys in EN: {len(en_keys)}")
    print(f"Keys in FR: {len(fr_keys)}")
    
    if missing_in_fr:
        print(f"\n[MISSING IN FR] ({len(missing_in_fr)} keys):")
        for k in sorted(missing_in_fr):
            if not k.startswith("__SECTION"):
                print(f"  - {k}")
    
    if missing_in_en:
        print(f"\n[MISSING IN EN] ({len(missing_in_en)} keys):")
        for k in sorted(missing_in_en):
            if not k.startswith("__SECTION"):
                print(f"  - {k}")

    # Check for variable consistency (e.g. {name}, {count})
    print(f"\n[VARIABLE CONSISTENCY CHECK]")
    common_keys = en_keys & fr_keys
    for k in sorted(common_keys):
        if not isinstance(en[k], str) or not isinstance(fr[k], str):
            continue
        en_vars = {x.split('}')[0] for x in en[k].split('{') if '}' in x}
        fr_vars = {x.split('}')[0] for x in fr[k].split('{') if '}' in x}
        
        if en_vars != fr_vars:
            print(f"  - {k}: EN={en_vars} vs FR={fr_vars}")

if __name__ == "__main__":
    check_i18n()
