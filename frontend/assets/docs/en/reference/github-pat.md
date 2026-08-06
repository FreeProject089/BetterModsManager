# GitHub rate limits & the Personal Access Token

BMM reads a fair amount from GitHub: release feeds for update checks, catalog files, and the mod
downloads a `.mmlist` points at. GitHub rate-limits requests that arrive without credentials, so a
big import can run into a wall that has nothing to do with BMM.

A **Personal Access Token** raises that ceiling. It is optional, and most people never need one.

---

## When you actually need it

| | |
|---|---|
| **Unauthenticated** | ~60 requests per hour, counted **per IP address** |
| **With a token** | 5 000 requests per hour, counted per account |

Sixty an hour is plenty for normal use. You hit it when a single action makes many requests in a
row — importing a `.mmlist` with dozens of GitHub-hosted mods is the usual one. The symptom is a
run of downloads that suddenly start failing with a **403**, often after a burst that worked.

!!! note "Per IP, not per machine"

    On a shared connection — a household, a student residence, an office — the sixty are shared
    with everyone else on it. That is why the limit can be reached without you having done
    anything unusual.

---

## Where BMM sends it, and where it does not

This is worth being precise about, because it is a credential.

- The token is attached **only when the URL's host is `github.com` or
  `raw.githubusercontent.com`**. A mod hosted anywhere else — a personal server, a mirror, a
  file-host — is fetched without it. It cannot leak to a third party by way of a link someone put
  in a mod list.
- It is sent as a standard `Authorization: Bearer` header, alongside GitHub's API version header.
- It is stored in `data.json` on your machine, and it is never uploaded anywhere.

!!! warning "It is not applied everywhere GitHub is used"

    The mod-download path applies it. Other GitHub traffic — the app's own update check, for
    instance — does not, so a token will not silence every possible rate-limit message. If you are
    hitting the limit on update checks specifically, waiting is the fix.

---

## Creating one

You want the **least-privileged token that exists**. BMM only ever *reads* public files, so it
needs no scopes at all.

1. GitHub → **Settings → Developer settings → Personal access tokens**.
2. Either kind works. For a **fine-grained** token: no account permissions, public repositories
   only. For a **classic** token: tick **nothing** — an unscoped classic token still lifts the
   rate limit, and that is all BMM wants from it.
3. Give it an expiry. There is no reason for this one to live forever.
4. Copy it — GitHub shows it once.
5. In BMM: **Settings → Identity & API**, paste, save.

!!! danger "Never give it write scopes"

    A token with `repo` or write access can modify your repositories. Nothing BMM does requires
    that, so a token that has it is pure risk. If you already pasted a broad token, revoke it on
    GitHub and issue a read-only one — revoking is instant and free.

---

## Checking it worked

Re-run whatever was failing. If it still fails at the same point, the token is not being applied:

- Confirm it was saved (re-open Settings — the field should show a stored value).
- Confirm the failing URL is actually on GitHub. A mod hosted elsewhere is unaffected by a token,
  by design.
- If GitHub says the token is invalid, it has probably expired. They do, silently.

---

## See also

- [Install BMM](doc-page:getting-started/install) — where update checks and this limit first come up.
- [Security](doc-page:how-it-works/security) — how BMM handles credentials generally.
- [.MM Lists](doc-page:features/modlist) — the import that most often runs into the limit.
