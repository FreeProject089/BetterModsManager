import json
import re
import os

def is_likely_french(text):
    if not isinstance(text, str): return False
    # Heuristics for French
    french_indicators = [r'\bé\b', r'\bà\b', r'\ble\b', r'\bla\b', r'\bdes\b', r'\bdans\b', r'\bavec\b', r'\bpour\b', r'\bpar\b', r'\bsur\b', r'\bqui\b', r'\bque\b']
    if any(re.search(ind, text, re.I) for ind in french_indicators):
        return True
    if any(acc in text for acc in 'éàèùâêîôûëïüç'):
        return True
    return False

def fix_i18n():
    en_path = 'frontend/Lang/en.json'
    fr_path = 'frontend/Lang/fr.json'
    
    if not os.path.exists(en_path) or not os.path.exists(fr_path):
        print("Missing en.json or fr.json")
        return

    with open(en_path, 'r', encoding='utf-8') as f:
        en = json.load(f)
    with open(fr_path, 'r', encoding='utf-8') as f:
        fr = json.load(f)

    # 1. Detect English in fr.json (Values same as en.json, but EN check)
    eng_in_fr = []
    for k, v in fr.items():
        if k.startswith('__') or k == '_info': continue
        if v == en.get(k):
            # Same value is likely a fallback, unless it is a very short word like "OK"
            if len(v) > 3 or re.search('[a-zA-Z]{4,}', v):
                 eng_in_fr.append(k)

    # 2. Detect French in en.json
    fr_in_en = []
    for k, v in en.items():
        if k.startswith('__') or k == '_info': continue
        if is_likely_french(v):
            fr_in_en.append(k)

    print(f"--- ENGLISH IN fr.json ({len(eng_in_fr)}) ---")
    for k in sorted(eng_in_fr):
        print(f"FR_MISSING: {k} | VAL: {fr[k]}")

    print(f"\n--- FRENCH IN en.json ({len(fr_in_en)}) ---")
    for k in sorted(fr_in_en):
        print(f"EN_MISSING: {k} | VAL: {en[k]}")

if __name__ == "__main__":
    fix_i18n()
