# Guide de traduction des Conditions d'utilisation (TOS) — Better Mods Manager

> Ce guide remplace l'ancien guide « EULA ». BMM affiche désormais des **Conditions
> d'utilisation (TOS)**. Les anciens fichiers `EULA_*.md` fonctionnent encore en
> repli, mais privilégiez `TOS_*.md`.

Vous souhaitez traduire les Conditions d'utilisation dans votre langue ? Suivez ces étapes simples !

## 1. Convention de nommage
Le nom du fichier doit suivre exactement ce motif :

```
TOS_{CODE_LANGUE}.md
```

Où `{CODE_LANGUE}` est la version **en majuscules** du nom du fichier de langue du dossier `frontend/Lang` (avant `.json`).

**Exemples :**
| Fichier de langue | Nom du fichier TOS |
|---|---|
| `fr.json` | `TOS_FR.md` |
| `en.json` | `TOS_EN.md` |
| `de.json` | `TOS_DE.md` |
| `es.json` | `TOS_ES.md` |

## 2. Emplacement
Placez votre fichier traduit à la **racine de l'application** (même endroit que `TOS.md`, `PRIVACY.md` et `LICENSE.md`).

## 3. Logique de repli
BMM résout les Conditions dans cet ordre :
1. `TOS_{VOTRE_LANGUE}.md` (ex. `TOS_DE.md` pour l'allemand)
2. `TOS.md` (anglais par défaut)
3. `EULA_{VOTRE_LANGUE}.md` — *ancien*
4. `EULA.md` — *ancien*

Vous n'avez donc qu'à fournir la traduction de votre langue — l'anglais reste le défaut.

## 4. Structure du contenu
Reprenez la même structure de sections que `TOS.md` :

1. **OCTROI DE LICENCE** — GPL-3.0
2. **EXCLUSION DE GARANTIE** — clause « EN L'ÉTAT »
3. **RESPONSABILITÉ DE L'UTILISATEUR** — risques du moddage
4. **CONFIDENTIALITÉ & DONNÉES** — renvoie à la Politique de confidentialité (traduite à part — voir `PrivacyTranslationGuide`)
5. **COMMUNAUTÉ & SUPPORT** — canaux d'aide

Gardez les titres et l'ordre des sections identiques pour rester cohérent avec le lecteur intégré.

## 5. Démarrage rapide
1. Copiez `TOS.md` vers `TOS_{VOTRE_LANGUE}.md`
2. Traduisez le contenu (ne traduisez pas le code, les URL, ni les noms de produits)
3. Redémarrez BMM — vos Conditions se chargent automatiquement (selon la langue de l'app)

## 6. Pour les empaqueteurs / distributeurs
Ajoutez votre fichier au tableau `resources` de `tauri.conf.json` pour qu'il soit livré avec le build :

```json
"resources": [
    "../TOS.md",
    "../TOS_FR.md",
    "../TOS_DE.md"
]
```

---
*Astuce : `TOS_FR.md` à la racine est un exemple complet prêt à lire. La Politique de confidentialité se traduit séparément — voir `PrivacyTranslationGuide_FR.md`. Pour traduire toute l'interface, voir `TranslationGuide_FR.md`.*
