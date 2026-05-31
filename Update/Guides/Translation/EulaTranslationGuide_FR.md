# Guide de Traduction du CLUF (EULA) - Better Mods Manager

Vous souhaitez traduire l'EULA (Contrat de Licence Utilisateur Final) dans votre langue ? Suivez ces étapes simples !

## 1. Convention de nommage
Le nom du fichier EULA doit respecter ce format exact :

```
EULA_{LANG_CODE}.md
```

Où `{LANG_CODE}` est la version en **majuscules** du nom du fichier de langue situé dans le dossier `frontend/Lang` (avant `.json`).

**Exemples :**
| Fichier de langue | Nom du fichier EULA |
|---|---|
| `fr.json` | `EULA_FR.md` |
| `en.json` | `EULA_EN.md` |
| `de.json` | `EULA_DE.md` |
| `es.json` | `EULA_ES.md` |

## 2. Emplacement du fichier
Placez votre fichier EULA traduit à la **racine de l'application** (au même endroit que `EULA.md` et `LICENSE.md`).

## 3. Logique de secours (Fallback)
BMM utilise un mécanisme de remplacement intelligent :
1. **D'abord**, il cherche `EULA_{VOTRE_LANGUE}.md` (ex : `EULA_DE.md` pour l'allemand).
2. **S'il est introuvable**, il se rabat sur le fichier par défaut `EULA.md` (Anglais).

Cela signifie que vous n'avez besoin de fournir que les traductions pour votre langue — l'anglais reste toujours la valeur par défaut.

## 4. Structure du contenu
Votre EULA traduit doit suivre la même structure de sections que `EULA.md` :

1. **CONCESSION DE LICENCE** — Expliquez qu'il s'agit de GPL-3.0
2. **EXCLUSION DE GARANTIE "TEL QUEL"** — Clause "As is"
3. **RESPONSABILITÉ ET RISQUES** — Les risques liés au modding
4. **DÉPÔTS DE SERVEURS ET MODÉRATION** — Conditions des serveurs et bannissements
5. **VIE PRIVÉE ET DONNÉES** — Ce qui est ou n'est pas collecté
6. **COMMUNAUTÉ ET SUPPORT** — Canaux de support

## 5. Démarrage rapide
1. Copiez `EULA.md` vers `EULA_{VOTRE_LANGUE}.md`
2. Traduisez le contenu
3. Relancez BMM — votre EULA sera automatiquement chargé !

## 6. Pour les créateurs de Bundles / Distributeurs
Si vous packagez BMM pour le distribuer, assurez-vous d'inclure votre fichier `EULA_{LANG}.md` dans le tableau des ressources (`resources`) du `tauri.conf.json` :

```json
"resources": [
    "../EULA.md",
    "../EULA_FR.md",
    "../EULA_DE.md"
]
```

---
*Astuce : Utilisez le fichier `EULA_FR.md` existant comme un exemple parfait d'une traduction réussie !*
