# Compiler BMM Docs — le site et le PDF

`BMM Docs/` est le site public MkDocs Material (son **propre dépôt git**, publié sur GitHub
Pages). Il produit deux choses : le site HTML, et un PDF unique de toute la documentation.

---

## 1. Installation

```bash
cd "BMM Docs"
pip install -r requirements.txt
```

> [!IMPORTANT]
> **`mkdocs` n'est peut-être pas dans ton PATH — utilise `python -m mkdocs`.** Avec un Python du
> **Microsoft Store** (le cas courant sous Windows), pip installe `mkdocs.exe` dans
> `%LOCALAPPDATA%\Packages\PythonSoftwareFoundation.Python.3.12_*\LocalCache\local-packages\Python312\Scripts`,
> qui **n'est pas** dans le PATH par défaut. `mkdocs serve` échoue alors sur *« le terme «mkdocs»
> n'est pas reconnu »*. Toutes les commandes de ce guide marchent en `python -m mkdocs …` ; cette
> forme ne demande aucune modification du PATH et c'est celle qu'utilise l'outillage du projet.
>
> Pour avoir la commande nue, ajoute ce dossier à ton PATH utilisateur une fois, puis rouvre le
> terminal :
>
> ```powershell
> [Environment]::SetEnvironmentVariable('PATH',
>   [Environment]::GetEnvironmentVariable('PATH','User') + ';' +
>   "$env:LOCALAPPDATA\Packages\PythonSoftwareFoundation.Python.3.12_qbz5n2kfra8p0\LocalCache\local-packages\Python312\Scripts",
>   'User')
> ```
>
> Attention : `python -c "import sysconfig; print(sysconfig.get_path('scripts'))"` te donne le
> **mauvais** dossier pour le Python du Store — il pointe vers `WindowsApps`, en lecture seule et
> sans `mkdocs.exe`.

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
python -m mkdocs serve            # http://127.0.0.1:8000 — le français sur /fr/
python -m mkdocs build --strict   # ce que la CI contrôle
```

> [!IMPORTANT]
> `--strict` transforme un **lien interne cassé en échec de build**. Lance-le avant de pousser —
> c'est la même barrière que la CI, et c'est la raison habituelle d'une PR de doc au rouge.

Convention bilingue : `page.md` est l'anglais, `page.fr.md` son pendant français ; les pages non
traduites retombent sur l'anglais.

---

## 3. Le PDF

```bash
python -m mkdocs build -f mkdocs.pdf.yml
# → site/pdf/bettermodsmanager.pdf
```

> [!CAUTION]
> **L'ordre compte si tu construis les deux.** `mkdocs build` **nettoie `site/` d'abord**, donc
> une compilation du site après celle du PDF supprime le PDF. Lance toujours la passe PDF **en
> dernier** :
>
> ```bash
> python -m mkdocs build --strict            # le site + le contrôle strict des liens
> python -m mkdocs build -f mkdocs.pdf.yml   # le PDF, dans le site déjà présent
> ```
>
> `mkdocs.pdf.yml` fait un INHERIT de `mkdocs.yml` et sa liste de plugins est un sur-ensemble : la
> seconde passe reproduit donc le même site et y ajoute le PDF.

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
  python -m mkdocs build --strict &&
  python -m mkdocs build -f mkdocs.pdf.yml"
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
depuis `master`. Étapes, dans l'ordre :

1. `actions/checkout@v4` **avec `lfs: true`**
2. une garde qui échoue si un `.bmmreplay` est encore un pointeur LFS
3. Python 3.12
4. les libs apt ci-dessus
5. `pip install -r requirements.txt`
6. `python tools/annotate.py --check`
7. `mkdocs build --strict` — le site, et la barrière stricte sur les liens
8. `mkdocs build -f mkdocs.pdf.yml` — le PDF, **en dernier**, parce qu'une compilation du site nettoie `site/`
9. upload de l'artéfact PDF → déploiement Pages (master uniquement)

### Deux bugs que ce workflow a eus

Les deux sont corrigés ; ils sont consignés parce que dans les deux cas le symptôme était le
**silence**, pas une erreur.

> [!NOTE]
> **Le PDF n'était jamais rendu.** L'étape de build lançait `mkdocs build --strict` avec une
> variable d'env `ENABLE_PDF: "1"` que **rien dans le dépôt ne lit** — `mkdocs.yml` n'a ni hook
> `!ENV` ni entrée `with-pdf`. Aucun PDF n'existait donc, et `upload-artifact` n'envoyait rien.
> Corrigé par les deux passes explicites des étapes 7–8.

> [!NOTE]
> **Tous les replays intégrés au site publié étaient cassés.** Les `.bmmreplay` sont suivis par
> LFS, mais le checkout n'avait pas `lfs: true` : la CI récupérait des fichiers pointeurs de 130
> octets, mkdocs les copiait tels quels dans `site/`, et le lecteur essayait de parser
> `version https://git-lfs.github.com/spec/v1…` comme un flux d'événements rrweb — n'affichant
> rien, sans erreur. Ça marchait en local seulement parce qu'un clone de dev a les vrais fichiers.
> Corrigé par `lfs: true` plus la garde de l'étape 2, pour qu'un pointeur ne puisse plus jamais
> atteindre le site.

---

## 6. Checklist avant de pousser de la doc

- [ ] `python -m mkdocs build --strict` passe (aucun lien interne cassé).
- [ ] La nouvelle page a bien `page.md` **et** `page.fr.md`, et figure dans la `nav` — plus une
      entrée `nav_translations` pour son titre français.
- [ ] `python tools/annotate.py --check` passe.
- [ ] Si tu as ajouté un plugin à `mkdocs.yml`, répercute-le dans `mkdocs.pdf.yml`.
- [ ] Nouveaux enregistrements `.bmmreplay` commités **via git-lfs** (voir *Intégrer replays &
      vidéo*), et `git lfs ls-files` les liste — un fichier commité avant que `.gitattributes` ne
      le couvre entre comme blob normal et déjoue silencieusement le cas inverse de la garde CI.
