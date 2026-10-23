# Guide de traduction de la Politique de confidentialité — Better Mods Manager

Vous souhaitez traduire la Politique de confidentialité de BMM ? Le fonctionnement
est identique au guide des Conditions d'utilisation, avec son propre nom de fichier.

## 1. Convention de nommage
```
PRIVACY_{CODE_LANGUE}.md
```
`{CODE_LANGUE}` = code de langue en **majuscules** (nom du fichier `frontend/Lang` avant `.json`).

| Fichier de langue | Nom du fichier Confidentialité |
|---|---|
| `fr.json` | `PRIVACY_FR.md` |
| `en.json` | `PRIVACY_EN.md` |
| `de.json` | `PRIVACY_DE.md` |

## 2. Emplacement
À la **racine de l'application** (à côté de `PRIVACY.md`, `TOS.md`, `LICENSE.md`).

## 3. Logique de repli
BMM résout la Politique de confidentialité dans cet ordre :
1. `PRIVACY_{VOTRE_LANGUE}.md`
2. `PRIVACY.md` (anglais par défaut)

## 4. Structure du contenu
Reprenez `PRIVACY.md` section par section. Sections clés à conserver :
1. **Ce que nous collectons** — specs, performances/benchmarks, usage & navigation, localisation approximative, Creator ID anonyme, replay de session masqué optionnel
2. **Ce que nous ne collectons jamais** — noms/emails, contenu des mods, chemins de fichiers (sauf si le replay complet est explicitement activé)
3. **Consentement & contrôle** — opt-in, options individuelles, export & suppression depuis *Paramètres → Confidentialité*
4. **Conservation & effacement** — durée limitée, demandes de suppression par paquet
5. **Contact**

⚠️ La précision est essentielle : gardez un sens identique à la source anglaise — n'ajoutez ni n'affaiblissez aucune affirmation sur le traitement des données. Ne traduisez pas les URL, emails ou noms de produits.

## 5. Démarrage rapide
1. Copiez `PRIVACY.md` → `PRIVACY_{VOTRE_LANGUE}.md`
2. Traduisez uniquement le texte
3. Redémarrez BMM — la politique suit la langue de l'app (premier lancement et *Paramètres → Confidentialité*)

## 6. Pour les empaqueteurs
Ajoutez-le à `tauri.conf.json` → `resources` (ex. `"../PRIVACY_DE.md"`).

---
*`PRIVACY_FR.md` à la racine est un exemple complet. Voir aussi `EulaTranslationGuide_FR.md` (Conditions d'utilisation) et `TranslationGuide_FR.md` (interface complète).*
