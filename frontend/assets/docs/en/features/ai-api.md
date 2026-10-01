# Local Laya API

Programs on your PC can ask the built-in Laya the same questions as
[laya-serve](doc-page:features/ai): sort a text into labels, answer yes or no, score a level. **Off by default.**
Classification only: the API cannot read a file, a mod, a setting or anything else of yours.

## Turn it on

**Settings → Local Laya API → Turn on the local API.** BMM makes a token and shows it **once**:
copy it then. **New token** makes another one; the old one stops working at once.

From a terminal: `bmm ai-api start` (prints a token once if there is none), `bmm ai-api stop`,
`bmm ai-api status`, `bmm ai-api rotate`. It runs only while BMM is open **and** AI is on in
Settings; turning either off stops it within seconds.

## Call it

```bash
curl -s http://127.0.0.1:51275/v1/systemone \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"state":{"body":"The game crashes at start"},
       "questions":{"cat":{"type":"choice","instructions":"Which?","criteria":["crash","ui"]}}}'
```

The body and the answer are laya-serve's: `state` is a text (or `{"body": text}`), each question
is `choice`, `noul` or `score` with its `criteria` (a list, or an object whose order is kept).
`GET /health` answers without a token: `{"status":"ok","ready":true}`.

| Answer | Why |
|---|---|
| 401 | No token, or the wrong one. Ten wrong tries in a minute lock the caller out for a minute (429) |
| 403 | A web page not in **Allowed web pages** |
| 413 / 422 | Too big: 64 KB a request, 20 000 characters a text, 16 questions, 64 options |
| 421 | The `Host` header does not name this server (DNS rebinding) |
| 429 | More than 60 requests a minute from the caller |
| 503 | AI off, `--no-ai`, a game running (`game_mode`), the model not installed, or busy (1 or 2 at a time, 4 waiting) |
| 504 | Laya took more than 30 s |

## What it guards

- **127.0.0.1 only.** Any other address in the settings is refused before a port is opened.
- **Token.** 256 random bits, stored only as a SHA-256, compared in constant time.
- **Web pages.** A request that carries an `Origin` is refused unless that exact origin is listed
  (none by default); only a listed one gets a CORS header.
- **Logs.** The path, the status, the time and the sizes. Never the text, the questions, the
  answers or the token.

The full threat model is in [AI security](doc-page:how-it-works/ai-security).
