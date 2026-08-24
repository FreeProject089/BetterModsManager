# Closing a server you generated

Every server BMM generates reads an **`access.json`** from the folder it serves. It is how you
put a password on a repo, or restrict it to people holding a key you authorised.

This applies to all of them:

| What you generated | Where the file goes |
|---|---|
| Standalone server (Express / Node) | Beside `server.js` |
| Standalone lightweight, v1 or v2, `.bat` or `.sh` | Beside the script |
| Multi-Repo Hub | **Inside each repo folder**, one per repo |
| Static hub export | *Nowhere — see the last section* |

---

## The file

BMM writes an empty one for you when it generates the server. Empty means **open**, which is
the same meaning a blank password has everywhere else in BMM.

```json
{
  "password": "",
  "pubkeys": [],
  "audience": ""
}
```

| Field | Meaning |
|---|---|
| `password` | A download password. Subscribers send it as `X-Repo-Password` — BMM asks for it and remembers it for the session. Blank = no password. |
| `pubkeys` | One-line OpenSSH **public** keys. Empty = no key required. |
| `audience` | The address your subscribers type. Required as soon as `pubkeys` is not empty. |

It is read **when a request arrives**, not when the server starts. Add a key, save the file,
and the next download already sees it. No restart, no regeneration, no re-upload.

---

## Two locks, and what each is for

A **password** is a shared secret. Everyone who has it can sync — and everyone who has it can
pass it on. That is exactly right for handing access to a group, and exactly wrong for handing
it to one machine.

A **key** cannot be passed on so easily. You paste the public half; the holder must have the
private half and *sign* for it on every request. Nothing that travels over the wire can be
replayed elsewhere, and revoking access is deleting one line.

They combine. With both set, a request needs both.

---

## Adding a key

Ask the person for their **public** key line — the contents of their `.pub` file, or in BMM
**Settings → Identity & API → Identity keys**, which shows it ready to copy. It looks like:

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA… them@machine
```

ed25519, RSA and ECDSA are all accepted. Put each on its own line of the array:

```json
{
  "password": "",
  "pubkeys": [
    "ssh-ed25519 AAAAC3Nza… me@laptop",
    "ssh-rsa AAAAB3NzaC1yc… them@desktop"
  ],
  "audience": "http://repo.example.com:3000"
}
```

> **The first key you list closes the repo for everyone.**
> With no keys, the check does not apply. The moment one key is listed, a valid proof becomes
> a condition on **every** request — including yours. Add your own key first, and confirm you
> can still sync, before you add anybody else's.

Never paste a **private** key here. Nothing in BMM ever asks for one in a config file.

---

## `audience` — the one that locks everybody out

BMM signs **the address it dialled**. A proof made for `http://1.2.3.4:3000` is refused by a
server that expects `https://repo.example.com`, and that is the point: a proof captured on one
server cannot be replayed against another.

So `audience` must be the origin your subscribers actually type — scheme, host and port,
exactly:

```
http://192.168.1.10:3000       ← a LAN address, with its port
https://repo.example.com       ← behind a reverse proxy on 443, no port
http://repo.example.com:3000   ← a direct connection on 3000
```

Get it wrong and every proof is refused, for a reason nothing on the client side explains. It
is deliberately **not** taken from the request's `Host` header: an attacker replaying a
captured proof would simply send the matching `Host`, which would make the whole check
decorative.

You can also set it once for the whole server with the `BMM_PUBLIC_ORIGIN` environment
variable; a per-repo `access.json` overrides it.

---

## What a refusal looks like

| Response | Meaning |
|---|---|
| **401** + `Wrong or missing repo password` | The password is set and was not sent, or was wrong. |
| **401** + `A valid key proof is required (missing)` | Keys are listed and the client sent no proof. |
| **401** + `… (audience)` | The proof was made for a different address — check `audience`. |
| **401** + `… (not_authorised)` | A valid proof, from a key that is not on your list. |
| **500** + `No audience configured` | You listed keys but left `audience` empty. |
| **500** + `Key checking is unavailable` | `keyauth.mjs` is missing beside the server. Re-generate. |

401 rather than 403 throughout, deliberately: the client can *do* something about a 401, and
BMM reads one as "there is a credential to supply" and asks for it.

The server also prints, at startup, which repos are restricted — a gate nobody can see is a
gate people forget they set, then debug as "my repo is broken".

---

## Your own dashboard still works

The check runs **after** bans and the whitelist, and only for content requests. `/dashboard`,
`/monitoring.json` and `/admin/*` are answered before it, and local connections are exempt
throughout. Listing a key does not lock you out of your own admin panel.

---

## The static export cannot do this

A static hub export is plain files. There is no BMM process serving them, so a password and
authorised keys **cannot be enforced** — whatever web server you point at the folder decides
who may read it (`auth_basic` in nginx, a Caddy directive, your host's own controls).

The export ships a `README-access.txt` saying exactly that. If you want BMM to enforce access,
generate the hub with the Node server instead.

---

## See also

- **Catalog index — one address for many catalogs**
- **PRIVACY.md**, §3.1.b and §3.2.b — what is stored and what is only ever read
