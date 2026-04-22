import json
import os

files = {
    r'e:\Travaille\CodageAutres\Better Project\BetterModsManager\frontend\Lang\fr.json': {
        "docs.diagram.taskyInstruction": "Passez votre souris sur une étape pour que je vous explique !"
    },
    r'e:\Travaille\CodageAutres\Better Project\BetterModsManager\frontend\Lang\en.json': {
        "docs.diagram.taskyInstruction": "Hover over a step and I'll explain it to you!"
    }
}

for path, keys in files.items():
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    for k, v in keys.items():
        data[k] = v
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=4)
