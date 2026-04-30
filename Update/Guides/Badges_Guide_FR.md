# Guide du Développeur : Ajouter de Nouveaux Badges de Documentation

Ce guide explique comment ajouter de nouveaux badges spécialisés au rendu Markdown de Better Mods Manager (BMM).

## Aperçu

Les badges sont implémentés à l'aide de remplacements par **Expressions Régulières (Regex)** dans la fonction `renderMarkdown` du frontend. Pour ajouter un nouveau badge, vous devez mettre à jour la logique, le style et les traductions.

## Étape 1 : Mettre à jour la Logique

Ouvrez `frontend/src/ui/update-notes.ts` et localisez la fonction `renderMarkdown(md)`. Ajoutez une nouvelle règle de remplacement :

```javascript
// Exemple : Ajout d'un badge [CRITIQUE]
html = html.replace(/\[CRITIQUE\]/g, '<span class="md-badge md-badge-critical">' + t('update.badge.critical') + '</span>');
```

Pour le support de l'anglais, ajoutez l'équivalent :
```javascript
html = html.replace(/\[CRITICAL\]/g, '<span class="md-badge md-badge-critical">' + t('update.badge.critical') + '</span>');
```

## Étape 2 : Ajouter le Style

Dans le même fichier (`update-notes.ts`), descendez jusqu'à la fonction `injectMarkdownStyles()` (généralement une IIFE en bas du fichier). Ajoutez votre nouvelle classe CSS :

```css
.md-badge-critical {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
    border: 1px solid rgba(239, 68, 68, 0.3);
}
```

## Étape 3 : Ajouter les Traductions

Mettez à jour les fichiers de langue :

- `frontend/Lang/en.json` :
  ```json
  "update": {
    "badge": {
      "critical": "CRITICAL"
    }
  }
  ```

- `frontend/Lang/fr.json` :
  ```json
  "update": {
    "badge": {
      "critical": "CRITIQUE"
    }
  }
  ```

## Étape 4 : Mettre à jour la Documentation de Référence

N'oubliez pas de mettre à jour `Update/Documentation/Badges_EN.md` et `Badges_FR.md` pour inclure votre nouveau badge dans le tableau !

---

## 📢 Note sur les Alertes GitHub

BMM analyse également les alertes standard de style GitHub en utilisant `<blockquote>` et des balises spécifiques. Les balises suivantes sont prises en charge :
- `> [!NOTE]` (ou `[!REMARQUE]`)
- `> [!TIP]` (ou `[!ASTUCE]`)
- `> [!IMPORTANT]`
- `> [!WARNING]` (ou `[!AVERTISSEMENT]`)
- `> [!CAUTION]` (ou `[!ATTENTION]`)

Pour ajouter un nouveau type d'alerte GitHub, mettez à jour la regex dans `frontend/src/ui/update-notes.ts` qui capture `<blockquote>\s*<p>\[!(NOTE|TIP...)\]` et ajoutez les classes CSS correspondantes (`.md-alert-[type]`) dans `injectMarkdownStyles()`.

> [!IMPORTANT]
> Utilisez toujours `rgba` pour les arrière-plans afin de maintenir l'esthétique glassmorphism de BMM.
