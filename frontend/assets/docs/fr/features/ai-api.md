# API Laya locale

Les programmes de ton PC peuvent poser à la Laya intégrée les mêmes questions qu'à
[laya-serve](doc-page:features/ai) : classer un texte dans des étiquettes, répondre oui ou non, noter un niveau.
**Désactivée par défaut.** Classification seulement : l'API ne peut lire ni fichier, ni mod, ni
réglage, ni rien d'autre à toi.

## L'activer

**Paramètres → API Laya locale → Activer l'API locale.** BMM crée un jeton et l'affiche **une
seule fois** : copie-le à ce moment-là. **Nouveau jeton** en crée un autre ; l'ancien cesse de
marcher aussitôt.

Depuis un terminal : `bmm ai-api start` (affiche un jeton une fois s'il n'y en a pas),
`bmm ai-api stop`, `bmm ai-api status`, `bmm ai-api rotate`. Elle ne tourne que si BMM est ouvert
**et** l'IA activée dans les Paramètres ; couper l'un ou l'autre l'arrête en quelques secondes.

## L'appeler

```bash
curl -s http://127.0.0.1:51275/v1/systemone \
  -H "Authorization: Bearer <jeton>" -H "Content-Type: application/json" \
  -d '{"state":{"body":"Le jeu plante au démarrage"},
       "questions":{"cat":{"type":"choice","instructions":"Lequel ?","criteria":["crash","ui"]}}}'
```

Le corps et la réponse sont ceux de laya-serve : `state` est un texte (ou `{"body": texte}`),
chaque question est `choice`, `noul` ou `score` avec ses `criteria` (une liste, ou un objet dont
l'ordre est gardé). `GET /health` répond sans jeton : `{"status":"ok","ready":true}`.

| Réponse | Pourquoi |
|---|---|
| 401 | Pas de jeton, ou le mauvais. Dix essais faux en une minute bloquent l'appelant une minute (429) |
| 403 | Une page web absente des **Pages web autorisées** |
| 413 / 422 | Trop gros : 64 Ko par requête, 20 000 caractères par texte, 16 questions, 64 options |
| 421 | L'en-tête `Host` ne nomme pas ce serveur (DNS rebinding) |
| 429 | Plus de 60 requêtes par minute pour l'appelant |
| 503 | IA désactivée, `--no-ai`, un jeu en cours (`game_mode`), modèle absent, ou occupée (1 ou 2 à la fois, 4 en attente) |
| 504 | Laya a mis plus de 30 s |

## Vos étiquettes et réglages : /v1/classify

```bash
curl -s http://127.0.0.1:51275/v1/classify \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"text":"Le jeu plante au lancement","labels":["crash",{"id":"ui","description":"un problème d'affichage","examples":["texte coupé"]}]}'
```

`labels` sont des ids ou des `{id, description, examples}` (2 à 32), ou `"task": "<id>"` désigne
une tâche enregistrée dans **Paramètres → Réponses de Laya**. La réponse suit vos réglages pour les
*Programmes* (ou ceux de la tâche) : `label` (`none` quand Laya s'abstient), `p`, `labels`
(retenues), `ranked`, `probabilities` (chaque étiquette), `abstained`, `uncertain`, `reason`. Champs
inconnus : 400.

`GET /v1/laya/config` renvoie les réglages en export. `PUT /v1/laya/config` enregistre une config ou
un export seulement si vous avez coché *Les programmes (API locale, MCP, CLI) peuvent modifier ces
réglages* ; sinon 403 `config_locked`. Un programme ne peut jamais la cocher, et une valeur hors
limites est refusée (422), pas corrigée.

## Ce qu'elle protège

- **127.0.0.1 seulement.** Toute autre adresse dans les réglages est refusée avant d'ouvrir un port.
- **Jeton.** 256 bits aléatoires, gardés seulement sous forme de SHA-256, comparés en temps constant.
- **Pages web.** Une requête qui porte un `Origin` est refusée sauf si cette origine exacte est
  listée (aucune par défaut) ; seule une origine listée reçoit un en-tête CORS.
- **Journaux.** Le chemin, le statut, la durée et les tailles. Jamais le texte, les questions,
  les réponses ni le jeton.

Le modèle de menace complet est dans [Sécurité de l'IA](doc-page:how-it-works/ai-security).
