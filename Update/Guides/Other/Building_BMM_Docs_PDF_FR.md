# Compiler BMM Docs — le site et le PDF

`BMM Docs/` est le site public MkDocs Material (son **propre dépôt git**, publié sur GitHub
Pages). Il produit deux choses : le site HTML, et un PDF unique de toute la documentation.

---

## 1. Installation

```bash
cd "BMM Docs"
pip install -r requirements.txt
```

Versions épinglées :

```
mkdocs==1.6.1
mkdocs-material==9.5.44
mkdocs-static-i18n==1.2.3
mkdocs-with-pdf==0.9.3
Pillow==11.0.0
```

---

## 2. Le site (ce qu'utilisent les contributeurs)

```bash
mkdocs serve                # http://127.0.0.1:8000 — le français sur /fr/
mkdocs build --strict       # ce que la CI contrôle
```

> [!IMPORTANT]
> `--strict` transforme un **lien interne cassé en échec de build**. Lance-le avant de pousser —
> c'est la même barrière que la CI, et c'est la raison habituelle d'une PR de doc au rouge.

Convention bilingue : `page.md` est l'anglais, `page.fr.md` son pendant français ; les pages non
traduites retombent sur l'anglais.

---

## 3. Le PDF

```bash
mkdocs build -f mkdocs.pdf.yml
# → site/pdf/bettermodsmanager.pdf
```

> [!AVERTISSEMENT]
> **Ça exige des bibliothèques système GTK et c'est en pratique réservé à Linux/CI.** Le PDF est
> rendu par `mkdocs-with-pdf` → WeasyPrint, qui a besoin de vraies libs cairo/pango. Sur une
> machine Windows classique, ça meurt avec `cannot load library 'libgobject-2.0-0'`.

### Pourquoi deux fichiers de config

MkDocs **importe chaque plugin listé dans une config, même désactivé**. Mettre `with-pdf` dans
`mkdocs.yml` faisait donc planter un simple `mkdocs serve` sur toute machine Windows sans GTK —
c'est-à-dire la plupart. Donc :

- `mkdocs.yml` — ce qu'utilisent les contributeurs. **Pas de plugin PDF.** Marche partout, sans GTK.
- `mkdocs.pdf.yml` — `INHERIT: mkdocs.yml` plus le plugin `with-pdf`. Utilisé par la CI.

> [!REMARQUE]
> Comme `plugins:` est une **liste**, la config enfant *remplace* celle du parent au lieu de la
> fusionner. C'est pourquoi `mkdocs.pdf.yml` redéclare `search` et `i18n` à côté de `with-pdf`. Si
> tu ajoutes un plugin à `mkdocs.yml`, ajoute-le aussi à `mkdocs.pdf.yml` ou le build PDF le perd.

### Bibliothèques système (Debian/Ubuntu)

```bash
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf-2.0-0 libffi-dev shared-mime-info
```

Sans elles tu obtiens une erreur cairo/pango opaque plutôt qu'un clair « dépendance manquante ».

### Compiler le PDF sous Windows quand même

Utilise WSL, ou Docker :

```bash
docker run --rm -v "$PWD":/docs -w /docs python:3.12-slim bash -c "
  apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf-2.0-0 libffi-dev shared-mime-info &&
  pip install -r requirements.txt &&
  mkdocs build -f mkdocs.pdf.yml"
```

---

## 4. Annotations des captures d'écran

Les captures annotées sont **générées**, pas retouchées à la main : un `*.png` brut plus une
spec `*.json` produisent `*.annotated.png`.

```bash
python tools/annotate.py           # régénérer
python tools/annotate.py --check   # barrière CI : échoue si un fichier généré est périmé
```

Si tu modifies une spec `.json` ou remplaces une capture brute, relance `annotate.py` et commite
le `.annotated.png` régénéré, sinon la CI échoue sur le `--check`.

---

## 5. CI

`.github/workflows/docs.yml` compile sur push vers `master` / PR, et déploie sur GitHub Pages
depuis `master`. Étapes : Python 3.12 → les libs apt ci-dessus → `pip install -r requirements.txt`
→ `python tools/annotate.py --check` → build → upload de l'artéfact PDF → déploiement.

> [!ATTENTION]
> **Bug connu — la CI ne produit pas réellement le PDF.** L'étape de build lance
> `mkdocs build --strict` avec une variable d'env `ENABLE_PDF: "1"`, mais `ENABLE_PDF` n'est
> référencée **nulle part ailleurs dans le dépôt** — `mkdocs.yml` n'a ni hook `!ENV` ni entrée
> `with-pdf`. Aucun PDF n'est donc rendu, et l'étape `upload-artifact`
> (`if-no-files-found: error`) devrait échouer. L'étape correcte est :
>
> ```yaml
> run: |
>   mkdocs build --strict                 # site (et la barrière stricte sur les liens)
>   mkdocs build -f mkdocs.pdf.yml        # PDF → site/pdf/bettermodsmanager.pdf
> ```

---

## 6. Checklist avant de pousser de la doc

- [ ] `mkdocs build --strict` passe (aucun lien interne cassé).
- [ ] La nouvelle page a bien `page.md` **et** `page.fr.md`, et figure dans la `nav` — plus une
      entrée `nav_translations` pour son titre français.
- [ ] `python tools/annotate.py --check` passe.
- [ ] Si tu as ajouté un plugin à `mkdocs.yml`, répercute-le dans `mkdocs.pdf.yml`.
- [ ] Nouveaux enregistrements `.bmmreplay` commités **via git-lfs** (voir *Intégrer replays & vidéo*).
