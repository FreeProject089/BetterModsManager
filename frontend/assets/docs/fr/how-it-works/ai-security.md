# Sécurité de l'IA

Laya est optionnelle, et l'essentiel tourne sur ton PC. Elle lit pourtant du texte que BMM ne
contrôle pas (le readme d'un mod, un rapport, un fichier qu'une tâche désigne) et une partie peut
joindre un serveur que tu as choisi. Cette page est le modèle de menace en bref : ce qui peut mal
tourner, et ce qui l'arrête.

## Les surfaces

| Surface | Qui peut l'appeler | Où va le texte |
|---|---|---|
| Suggérer, Demander à Laya, vérification de rapport (dans l'app) | Toi, par un clic | La Laya intégrée ; ton laya-serve ; un modèle de rédaction que tu as configuré |
| Tâches planifiées (`ai.classify`, `ai.ask`, `ai.suggest_mod_metadata`) | Une tâche à qui tu as accordé **Laya (IA)** | La Laya intégrée ou ton laya-serve (jamais BetterCommunity) |
| [API Laya locale](doc-page:features/ai-api) | Un programme de ce PC qui a le jeton | La Laya intégrée seulement |
| CLI et MCP (`bmm ai-*`, `bmm_ai_*`) | Toi, ou un client IA que tu as branché | Comme l'app |
| IA de BetterCommunity (modération du site, recherche, bot Discord) | Le site et ses membres | Le fournisseur du site |

## Menaces et défenses

**Injection de prompt.** Un readme peut dire « ignore tes instructions ». Tout texte non fiable
arrive au modèle dans une clôture, nettoyé d'abord : pas de caractères cachés, pas de
commentaires HTML, pas d'images, pas de clôture qu'il pourrait fermer. La Laya intégrée efface
aussi chaque jeton réservé de son tokenizer (`<eos>`, `<bos>`, `<mask>`, `<pad>`…) dans le texte, la
question et les identifiants d'étiquettes : aucun texte ne peut finir son segment plus tôt. Laya ne
fait que **choisir** parmi des options données (tes tags, tes étiquettes, de vraies sources) et
peut répondre « aucune ». La sortie d'un modèle de rédaction est revérifiée : un lien (avec ou sans
`https://`, quelle que soit la fin du domaine), une adresse IP, un chemin réseau
(`\\hôte\partage`), un fichier ou un chemin doit figurer mot pour mot dans les sources ; les
liens `javascript:`, `data:` et `ms-…:` et les commandes (`Remove-Item`, `certutil`, `mshta`,
`rundll32`, `Invoke-…`, `schtasks`…) sont toujours refusés.

**Une réponse utilisée comme commande.** Dans une tâche, le texte libre d'`ai.ask` et
d'`ai.suggest_mod_metadata` est marqué non fiable, ainsi que toute copie. Il peut aller dans un
message, une ligne de journal ou le contenu d'un fichier. Partout ailleurs (un programme, un
script, un chemin, une adresse, un en-tête, une condition qui regarde un fichier) l'étape échoue.
Une étiquette d'`ai.classify` est toujours une des étiquettes de la tâche ou `none`, quoi que
réponde le moteur.

**Une page web ou un autre programme qui vise l'API locale.** Elle n'écoute que sur 127.0.0.1.
Une requête dont le `Host` ne nomme pas ce serveur est refusée (DNS rebinding), une requête venant
d'une page web est refusée sauf si son origine exacte est listée, et tout sauf `/health` demande
un jeton de 256 bits gardé seulement sous forme de hash. Un client MCP peut activer ou couper
l'API, mais ne reçoit jamais de jeton.

**Requêtes vers le mauvais endroit (SSRF).** Un modèle de rédaction sur ce PC doit être en
loopback (`localhost`, 127.x, ::1 ; un nom comme `x.localhost` n'est PAS du loopback) ; un modèle
distant doit être en https sur une adresse publique, y compris une IPv4 cachée dans une IPv6
(`[::ffff:10.0.0.1]`). Une requête vers le loopback ignore tout proxy système. Aucune redirection
n'est suivie, et les réponses sont plafonnées à 1 Mio. BetterCommunity n'est joint qu'à
`https://bettercommunity.ch` (ou à l'adresse de test https que nomme `app.cfg`, jamais une adresse
locale) : la page ne peut pas le diriger ailleurs.

**Clés.** Gardées par DPAPI de Windows ou le trousseau du système, jamais réaffichées, jamais
journalisées, jamais dans un message d'erreur. Chaque clé est liée à l'adresse pour laquelle elle a
été enregistrée (schéma, hôte, port) et n'est envoyée que là. Changer l'adresse efface la clé :
retape-la pour le nouveau serveur. Une clé ne passe jamais en http simple, sauf vers ce PC.

**Épuisement.** Plafonds sur le texte, les questions et les options ; une exécution du moteur à
la fois (deux pour l'API) ; files courtes ; délais ; 20 étapes Laya et 2 minutes par exécution de
tâche, 30 étapes par minute pour toutes les tâches, 60 requêtes API par minute et par appelant ;
les refus sont journalisés quelques-uns par minute, pas une ligne chacun.

**Confidentialité.** Les journaux portent des comptes, des tailles et des codes, jamais le texte,
la question ni la réponse. La Laya intégrée n'envoie rien. Les tâches et l'API locale n'utilisent
jamais BetterCommunity.

**Interrupteurs.** L'interrupteur général de l'IA, `--no-ai` (ou `BMM_NO_AI=1`) et un jeu en
cours arrêtent toute étape Laya et toute réponse de l'API ; couper l'IA arrête l'API en quelques
secondes.

## Limites connues

- La marque « non fiable » d'une variable partagée est gardée dans le stockage local de l'app ; le
  vider efface la marque.
- Dix mauvais jetons en une minute bloquent tous les appelants locaux pendant cette minute :
  n'importe quel programme de ce PC peut le faire exprès.
- Une classification est une probabilité. Fixe un minimum (`aiLabel … min: 0.8`) avant d'agir.
