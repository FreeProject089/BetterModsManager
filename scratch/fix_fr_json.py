import json
import sys

path = r'e:\Travaille\CodageAutres\Better Project\BetterModsManager\frontend\Lang\fr.json'
with open(path, 'r', encoding='utf-8') as f:
    data = json.load(f)

# The keys we want to ensure at the end (well, JSON doesn't guarantee order but we want them present)
data["docs.diagram.cluster.CREATION"] = "CRÉATION"
data["docs.diagram.cluster.SHARING"] = "PARTAGE"
data["docs.diagram.cluster.ACTION"] = "ACTION"
data["docs.diagram.label.collect"] = "Collecte"
data["docs.diagram.label.ready"] = "Prêt"
data["docs.diagram.label.share"] = "Partage"
data["docs.diagram.label.p2p"] = "Transfert"
data["docs.diagram.label.verify"] = "Vérification"
data["docs.diagram.label.ok"] = "Succès"

# Ensure modpack.modFallbackType is correct
data["modpack.modFallbackType"] = "Type de repli"

with open(path, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=4)
