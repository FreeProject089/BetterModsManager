import json
import os
import sys

def load_json(path):
    if not os.path.exists(path):
        print(f"Error: {path} not found")
        return None
    with open(path, 'r', encoding='utf-8') as f:
        try:
            return json.load(f)
        except json.JSONDecodeError as e:
            print(f"Error decoding {path}: {e}")
            return None

def get_vars(text):
    if not isinstance(text, str):
        return set()
    return {x.split('}')[0] for x in text.split('{') if '}' in x}

def test_i18n():
    files = {
        "EN": r'frontend\Lang\en.json',
        "FR": r'frontend\Lang\fr.json',
        "TEMPLATE": r'frontend\Lang\template.json'
    }
    
    data = {lang: load_json(path) for lang, path in files.items()}
    if any(v is None for v in data.values()):
        sys.exit(1)

    errors = 0
    
    # 1. Key Parity Check
    all_keys = set()
    for d in data.values():
        all_keys.update(d.keys())
        
    for lang, d in data.items():
        missing = all_keys - set(d.keys())
        # Filter out section markers
        missing = {k for k in missing if not k.startswith("__SECTION")}
        if missing:
            print(f"\n[FAIL] {lang} is missing {len(missing)} keys:")
            for k in sorted(missing):
                print(f"  - {k}")
            errors += 1

    # 2. Variable Consistency Check
    print("\n--- Variable Consistency Check ---")
    checked_vars = 0
    for k in sorted(all_keys):
        if k.startswith("__SECTION"): continue
        
        # Collect variables from all files that have the key
        vars_map = {}
        for lang, d in data.items():
            if k in d:
                vars_map[lang] = get_vars(d[k])
        
        # Compare all found variable sets
        if len(vars_map) > 1:
            base_lang = list(vars_map.keys())[0]
            base_vars = vars_map[base_lang]
            for lang, vship in vars_map.items():
                if vship != base_vars:
                    print(f"[FAIL] Variable mismatch for '{k}':")
                    for l, v in vars_map.items():
                        print(f"  - {l}: {v}")
                    errors += 1
                    break
        checked_vars += 1

    if errors > 0:
        print(f"\n[SUMMARY] I18N Validation FAILED with {errors} error(s).")
        sys.exit(1)
    else:
        print(f"\n[SUCCESS] I18N Validation PASSED ({len(all_keys)} keys, {checked_vars} strings verified).")
        sys.exit(0)

if __name__ == "__main__":
    test_i18n()
