# BetterCommunity v2 and telemetry v2: BMM readiness

Status as of 2026-10-14 (BMM 1.0.3, branch `release/1.0.3`). This page lists every
BetterCommunity (BC) call BMM makes, what each becomes in v2, and what is ready, what waits for
v2, and what stays on v1. v2 contracts referenced here: `BetterCommunity-v2/packages/contracts/src/*.ts`
and ADRs 0009 (catalogues), 0011 (consent ledger), 0012 (feedback centre), 0018 (BMM on v2),
0019 (platform assets and update feed), 0020 (Laya), 0023 (Community and notifications), 0024
(app telemetry). Telemetry server: the Rust/Axum telemetry dashboard,
`BCW/BCWEB/bmm/telemetry-dashboard/server`.

**Nothing changes for users until the switch is on.** BMM 1.0.3 ships every v2 adapter dormant.
Without a `BCApiVersion` line in `app.cfg` and without `bc_api` in links.json, BMM builds the
same URLs and sends the same requests as 1.0.2. `tests/bc-endpoints.test.mjs` and
`tests/bc-v2.test.mjs` check this URL by URL, the bundled links.json included.

---

## 1. How to switch to v2

### 1.1 The switch and its precedence

`app.cfg` > links.json > v1, decided once per session:

| Where | Keys | Notes |
|---|---|---|
| `app.cfg` | `BCApiVersion=v2` (or `2`), `BCv2Base=https://…` | Wins. An explicit `BCApiVersion=v1` pins the install to v1 whatever links.json says. Documented in `APP_CFG.md`. |
| links.json (platform asset, fetched at every start) | `bc_api: "v2"`, `bc_v2_base` | The remote switch: the owner flips it the day v2 goes live and installed 1.0.3 copies follow without a release. |
| default | | v1. |

`BCv2Base` / `bc_v2_base` must be `https://`, or plain `http://` to this machine. Empty means:
the test base in test mode, else production.

links.json also carries BMM's public v2 identifiers (all public, safe to ship):
`bc_v2_client_id` (the OAuth device-flow client), `bc_v2_app_key` (publishable `bc_pk_…`),
`bc_v2_app_id` (`app_…`, for the telemetry route).

### 1.2 The health gate

`bc_v2_activate` (Rust, `bc_v2.rs`) applies the precedence, then calls `GET <root>/v2/health`.
Only `200` with `status` `ok` or `degraded` turns the session to v2. A refused base, another
answer or no answer leaves the session on v1, and the log says
« v2 requested by … but not usable (…): this session stays on v1 ». Until the check has answered
the session is v1. Every Rust caller asks `effective_v2_root()`; the webview gets the answer
through `core/bc-v2.ts` (`activateBcV2`, event `bmm:bc-session`) and never selects v2 itself.

### 1.3 What each area does

| Area | v1 mode (default) | v2 mode |
|---|---|---|
| links.json, contributors | BCWEB `/api/assets/*` | links.json still read from the v1 root (it carries the switch); contributors from `<v2>/api/assets/contributors.json` |
| Update check | GitHub, then `autoupdate_api_fallback` | GitHub, then `<v2>/api/updates/bmm` (GitHub shape). The installer is verified exactly as before (signed `update-manifest.json`, else signed `update.json`, else « Install anyway ») |
| Laya offline model | GitHub, then BCWEB asset | GitHub, then `<v2>/api/assets/bmm-laya-offline`, then BCWEB; same SHA-256 pin |
| Account | v1 link (`/api/link/*`, creator proof) | OAuth device flow, tokens sealed (DPAPI / keyring / memory) and bound to the v2 root; Settings card « Linked BetterCommunity account »; sign-out revokes on the server |
| Feedback | `POST /api/feedback/bmm` with creator headers | `POST /v2/projects/bmm/feedback`: as the account (Rust) when signed in, else publishable key (webview, CORS) |
| Consent receipts | telemetry server copy | also `POST /v2/consents`: category receipts; Terms / Privacy as `kind: legal` when v2 publishes the shipped version; same permission rule |
| Legal texts | local `TOS.md` / `PRIVACY.md`, start-up window | the same, plus `GET /v2/consents/documents?documents=bmm-terms,bmm-privacy`: a version other than the shipped one is asked again (Accept / Refuse / Later); the server's receipt kept in `consent-ledger.bcv2-legal.json` and shown in My consents |
| Notifications | v1 API key, `/api/v1/notifications` | the device-flow token on `<v2>/api/v1/notifications` (`notifications:read`); a v1 key still works against v1 when not signed in |
| Community page | BCWEB blog | `<v2>/api/blog*` (ADR 0023); avatars from v1 |
| Laya « BetterCommunity » provider | creator proof + v1 key | `<v2>/api/ai/bmm/suggest` with the token (`ai:classify`) |
| Telemetry | telemetry server (`bmm_pk_`) | with `bc_v2_app_id` + `bc_v2_app_key`: `POST /v2/apps/{app}/telemetry/batch` (§4); session replay and the live-issue routes stay on the telemetry server |
| Signed catalogue feeds | not read | `/v2/feeds/*`, verified against the pinned keys |
| Avatars, launch announcements, author search, Discord link | v1 | v1 (not served by v2, ADR 0023 §2) |

## 2. The client layer

| File | Role |
|---|---|
| `frontend/src/core/bc-endpoints.ts` | Pure functions, no imports. Reads `BCApiVersion` (`parseApiVersion`). Resolves the v1 and v2 roots (`resolveRoots`). Builds URLs: `v1ApiUrl` (`<root>/api<route>`, v2 root only for routes v2 serves) and `v2ApiUrl` (`<v2Root>/v2<route>`). Also holds the feedback mappers (`feedbackToV2`, `feedbackConfigFromV2`, `feedbackAnswerFromV2`) and the signed feed addresses (`signedFeedUrls`). |
| `frontend/src/core/bc-client.ts` | The runtime side. Exports `bcRoots()`, `bcApiVersion()` / `bcUsesV2()`, `bcUrl(route)`, `bcV2Url(route)`, `bcV2Root()`, `bcFeedbackEndpoint()` and `bcSignedFeeds()`. It also has a typed transport, `bcGetJson` / `bcPostJson`, with a client-side timeout and one error shape (`BcError {code: offline\|timeout\|http\|bad_json, status, body, message}`). Requests go through the native `bc_api_get` / `bc_api_post` bridge. |
| `frontend/src/core/links-config.ts` | `loadBcConfig` now also keeps `api_version` and `v2_base`, exposed as `bcApiVersionCfg()` and `bcV2BaseCfg()`. `bcRoot()` and `bcApi()` are unchanged. |
| `src-tauri/src/commands/settings.rs` | `BcConfig` gains `api_version` and `v2_base`. `bc_api_version_of()` parses the version. |
| `src-tauri/src/commands/bc_v2.rs` | Rust half: `resolve_v2_root`, `base_allowed`, the consent-receipt adapter and the `consent_sync_bc_v2` command. |

In v1 mode, `bcUrl('/x')` is exactly `` `${bcRoot()}/api/x` ``. That equality is what makes
migrating a call site "mechanical and safe".

## 3. Inventory of BMM → BetterCommunity calls

Auth legend:

- **anon**: no identity.
- **CID**: `X-Creator-ID` header, added by Rust `catalog_get` for first-party hosts.
- **proof**: `X-Creator-Proof`, a signed, origin-bound creator proof (v1 or v5).
- **keyproof**: `X-BMM-Key-Proof` (`repo_keyauth.rs`).
- **repo-pw**: `X-Repo-Password` header (or `?password=`).
- **BC key**: `Authorization: Bearer <BC API key>` (notifications scope).
- **pk**: the telemetry public ingest key `api_key`, sent in the request body.

Status legend:

- **done**: works against v2 today with no BMM change. v2 serves the same path and shape.
- **adapter ready**: BMM has the v2 code path, used only when `BCApiVersion=v2`.
- **blocked on v2**: v2 has no equivalent route yet.
- **not started**: v2 has a route, but BMM has no adapter yet.

### 3.1 Registry, catalogues and repos

| # | Call | Where (file:line) | Method and route | Auth | Payload / answer | v2 mapping | Status |
|---|---|---|---|---|---|---|---|
| 1 | links.json registry | `core/links-config.ts:158` (`bcwebLinksUrl`), fetched via `fetch_remote_json` (`commands/net.rs:83`) | GET `/api/assets/links.json` | anon | the `BmmLinks` JSON | No v2 route. v2 "platform assets" are not in the contracts. | adapter ready (1.0.3). v2 serves `/api/assets/links.json` byte for byte (ADR 0019). Read from the v1 root at start; it carries the remote switch (§1). |
| 2 | Contributors | `ui/app.ts:1761` (`links.contributors`) | GET `/api/assets/contributors.json` | anon | JSON list | Same as #1 | adapter ready (1.0.3). Moved to the v2 root by `bcRehome` once the session is v2. |
| 3 | Catalogue feeds per kind | `links-config.ts:90-96` defaults; read by `scheduler.ts:12220` and the catalogue loaders via `catalogSources()`; Rust `net.rs:38` `catalog_get` | GET `/api/catalog.json?project=bmm&kind=…` | CID, keyproof, repo-pw | v1 catalogue document | v2 compat `legacyCatalogFeed` (`compat.ts`), public catalogues only, v1 shape | done (compat). Native v2 is the signed feeds (#5). |
| 4 | Catalogue index | `links-config.ts:91` (`catalog_index`) | GET `/api/catalogs.json` | CID | list of official catalogues | No compat path. The v2 equivalent is the signed index `GET /v2/feeds/catalog`. | adapter ready (URL discovery only, see #5) |
| 5 | Signed catalogue feeds (v2 only) | `bc-endpoints.ts` `signedFeedUrls()`, `bc-client.ts` `bcSignedFeeds()` | GET `/v2/feeds/catalog`, `/v2/feeds/catalogs/:catalog`, `/v2/feeds/keys` | anon | DSSE envelope signed with Ed25519 | Verification belongs to the universal catalogue work: format in `catalog_format.rs`, Tauri commands `catalog_validate`, `catalog_normalize`, `catalog_convert`, `catalog_verify_signature` and `catalog_keys` in `catalog_convert.rs`. They are registered in `main.rs`. | adapter ready. The loaders read and verify the signed feeds in v2 mode (`catalog-read.ts`); the root's keys are pinned at the first read (trust on first use). |
| 6 | Public repo list | `features/repo/repo.ts:1478` (`links.server_browse`) | GET `/api/repos.json` | CID | `{ repos: [...] }` | v2 compat `legacyRepoFeed` (same shape) | done (compat) |
| 7 | Hosted repo content | Rust `api/mod.rs:3090,3173`, `modlist.rs:824`, `repo.rs:2474,2985,3104`, `net.rs:102` | GET `/api/repos/:slug/*` (`repo.json`, files, Range) | CID, keyproof, repo-pw, `X-Creator-Identity` | bytes | v2 compat `legacyRepoContent` checks `X-Repo-Password` and `X-BMM-Key-Proof` | done (compat). v2 does not read `X-Creator-ID` / `X-Creator-Identity`, so whitelist-by-creator repos need #22. |
| 8 | Update fallback | `ui/update-notes.ts:761` (`autoupdate_api_fallback`) | GET `/api/updates/bmm` (GitHub releases shape) | anon | releases JSON | v2 has `/v2/projects/:project/releases` and channels (`releases.ts`), but no GitHub-shaped compat. Belongs to the self-updater work. | adapter ready (1.0.3). `autoupdate_api_fallback` moved by `bcRehome` to `<v2>/api/updates/bmm` (ADR 0019, GitHub shape). The signed `update-manifest.json` / `update.json` checks are unchanged. |
| 9 | Laya offline model | Rust `commands/ai_embedded.rs:73` | GET `/api/assets/bmm-laya-offline` | anon | model archive | Same as #1, or a v2 release file | adapter ready (1.0.3). `pack_mirrors()` adds `<v2>/api/assets/bmm-laya-offline` before the v1 mirror; the SHA-256 pin is unchanged. |

### 3.2 Account link and identity

| # | Call | Where | Method and route | Auth | Payload | v2 mapping | Status |
|---|---|---|---|---|---|---|---|
| 10 | Link status | `core/bc-link.ts:82` (migrated to `bcUrl`); `features/repo/repo-sync.ts:251` (direct, not migrated) | GET `/api/link/status?creatorId=` | anon (query) | `{linked, displayName, discord}` | v2 has no install-to-account link. Accounts link installs through OIDC (`/v2/oauth/*`, device flow `/v2/oauth/device`) and `POST /v2/me/consents/link`. | v1 only. In v2 mode the device flow (#11) replaces it; the v1 link keeps working against v1. |
| 11 | Link request (pairing code) | `core/bc-link.ts:163` (migrated) | POST `/api/link/request` | proof | `{creatorId, proof}` → `{code}` or `{linked}` | Replace with the OIDC device flow (`/v2/oauth/device`) | adapter ready (1.0.3). OAuth device flow (`bc_v2_auth.rs`), Settings « Linked BetterCommunity account » card. |
| 12 | Key v5 upgrade / pin | `core/bc-link.ts:123` (migrated) | POST `/api/link/upgrade` | proof v5 | `{proof}` | No v2 route. v2 has no creator-key model. | not served by v2 (no creator-key model, ADR 0018 §2). Stays on v1. |
| 13 | Discord link | `features/settings/settings.ts:968` (Settings UI, belongs to another agent, not migrated) | POST `/api/link/discord` | anon | `{creatorId, code}` | No v2 route | stays on v1 (ADR 0023 §2: belongs to the v2 bot, P6). |
| 14 | Author lookup | `features/repo/repo-sync.ts:210` (repo-sync belongs to another agent) | GET `/api/users/search?q=` | anon | `{users:[…]}` | No public user search in v2 | stays on v1 (ADR 0023 §2: no creator-key registry). |

### 3.3 Content and notifications

| # | Call | Where | Method and route | Auth | v2 mapping | Status |
|---|---|---|---|---|---|---|
| 15 | Blog list, post, history, comments | `features/community/community.ts:181,576,671,683,774,817` (`bcGet` → `bcApi()`) | GET `/api/blog`, `/api/blog/:slug`, `/api/blog/:id/history[/:rev]`, `/api/blog/:id/comments[/:cid/history]` | anon | v2 content entries: `/v2/entries`, `/v2/entries/:kind/:slug` (`content.ts`). Different model. | adapter ready (1.0.3). The v1 paths on the v2 root (ADR 0023) through `bcUrl`; history and comments answer empty lists; a revision's or a comment's history stays on v1. |
| 16 | Avatars | `community.ts:98`, fetched with `bc_fetch_data_url` | GET `/api/avatar/:id?size=64` | anon | none in the v2 contracts | stays on v1 (ADR 0023 §2: v2 accounts have no avatar yet). |
| 17 | Launch announcements | `ui/launch-announcements.ts:80` | GET `/api/bmm/launch?version=&lang=` (ETag) | anon | v2 releases and announcements have no launch-deck route | stays on v1 (ADR 0023 §2: no announcement model yet). |
| 18 | Notifications | `core/bcweb-notifications.ts:49` → Rust `security.rs:549` | GET `/api/v1/notifications?since=` | BC key | `GET /v2/notifications` (`integrations.ts`) with a v2 token (`bc_pat_` with the notifications scope). Needs a v2 token story and a cursor mapping. | adapter ready (1.0.3). `bc_v2_notifications`: `/api/v1/notifications?since=` on the v2 root with the device-flow token (`notifications:read`), same v1 shape. |
| 19 | Laya "BetterCommunity" classifier | `features/ai/ai-shared.ts:139` (`bcAuthArgs`) → Rust `ai.rs:32`, `ai_core.rs:2157` | POST `/api/ai/bmm/suggest` | CID and proof | No v2 AI route (the plan describes Laya as a classifier; nothing in the contracts yet) | adapter ready (1.0.3). Same path on the v2 root with the device-flow token (`ai:classify`, ADR 0020); without a sign-in the provider answers `not_signed_in`. |
| 20 | Account page links | `bc-link.ts:236` (`/profile`), `community.ts:524,626` (`/blog`), `bc-feedback.ts:89` (`/dashboard?s=reports`) | browser navigation | n/a | v2 web paths differ (account pages). Needs a v2 path map. | not started (the v2 web paths are not in the contracts). |

### 3.4 Feedback, consent and telemetry

| # | Call | Where | Method and route | Auth | v2 mapping | Status |
|---|---|---|---|---|---|---|
| 21 | Feedback config | `features/feedback/bc-feedback.ts:132,193` | GET `<endpoint>/config` | anon | v1 mode: v1 path (v2 also serves it through compat). v2 mode: `GET /v2/projects/bmm/feedback/config`, mapped by `feedbackConfigFromV2`. | adapter ready. Checked against the final contract (`FeedbackConfigView`, `max_request_mb` included). |
| 22 | Feedback, bug and crash report | `bc-feedback.ts:221` (`submitFeedback`) | POST `/api/feedback/bmm` (default, unchanged) | CID and proof | v2 mode: `POST /v2/projects/bmm/feedback` with `feedbackToV2` (snake_case, flat meta ≤40 keys, `content_type`). The answer goes through `feedbackAnswerFromV2`, which turns problem codes into the v1 status and `{error}`. Identity in v2 mode: `Authorization: Bearer <bc_v2_app_key>` when links.json has a publishable `bc_pk_` key. The creator headers are not sent, because v2 does not read them. v2 compat on `/api/feedback/bmm` also works and treats every sender as anonymous. | adapter ready. Signed in: sent by Rust with the account token (`bc_v2_feedback_send`, sender `account`). Otherwise the webview sends it with the publishable key (sender `app`). |
| 23 | Consent receipts → BC v2 ledger | `core/consent.ts` `syncConsents` → Rust `bc_v2.rs` `consent_sync_bc_v2` | POST `/v2/consents` (one per receipt) | anon subject; optional `bc_pk_` app key | Telemetry and crash-report answers become `kind: categories`, `document: app.telemetry` / `app.crash_reports`, a boolean per category, `source: app`. Terms and Privacy answers are deferred (see §5). | adapter ready (1.0.3): category receipts, and Terms / Privacy receipts as `kind: legal` once v2 publishes `bmm-terms` / `bmm-privacy` in the shipped version; re-acceptance answers (§1.3). |
| 24 | Telemetry batch | Rust `commands/analytics.rs` `analytics_flush`; webview beacon `core/analytics.ts:825` | POST `<analytics_endpoint>` (`…/batch/`) | pk | Now a versioned envelope, see §4 | done (v1). In v2 mode with `bc_v2_app_id` and `bc_v2_app_key`: `POST /v2/apps/{app}/telemetry/batch` (`bc_v2_telemetry.rs`, §4). |
| 25 | Consent receipts → telemetry server | Rust `consent_ledger.rs:824` `consent_sync` | POST `…/consents` | pk | Already existed: append-only, receipt hash recomputed by the server, cursor `sent_seq` | done (pre-existing) |
| 26 | Live issues | Rust `commands/live_issues.rs:304,402` | POST `…/issues` | pk | unchanged | done |
| 27 | Packet status, deletion request, data request | Rust `analytics.rs` (`/api/packet-status`, `/delete-request`, `/data-request`) | GET / POST | pk | unchanged | done |

Telemetry SSO (the dashboard login through BCWEB `forward_auth`) is server-side. BMM makes no
call for it.

### 3.5 Call sites migrated, and those left alone

These were migrated to the client layer (`bcUrl()`, `bcRehome()`, `bcContentRoot()`, or Rust's
`effective_v2_root()`). Each produces the same URL in v1 mode:

- `core/bc-link.ts`: link status, link upgrade, link request.
- `community.ts`: the blog calls (`bcUrl`), the content root; avatars keep `bcApi()` (v1).
- `bcweb-notifications.ts`: `bc_v2_notifications` when signed in to v2, else the v1 key.
- `ai-shared.ts` / `ai.rs`: in v2 mode Rust ignores the page's base and headers.
- `ui/app.ts` (contributors), `ui/update-notes.ts` (update fallback): `bcRehome`.
- `ai_embedded.rs`: `pack_mirrors()`.

Left on v1 on purpose: `launch-announcements.ts` (no v2 route).

These were not migrated because another agent owns the file, or because migrating would change
behaviour:

- `features/repo/repo-sync.ts:205,247` reads `links.bettercommunity` directly and ignores
  `BCTestMode`. Moving it to `bcUrl()` would change test-mode behaviour. That file belongs to
  the repo-sync work.
- `features/settings/settings.ts:968` (`/link/discord`) belongs to the Settings page work.
- The Rust-side hosts (`net.rs` `is_bettercommunity_host`, `ai_core.rs` `bc_base_allowed`,
  `ai.rs` default base, `ai_embedded.rs:73`, `discord.rs:24`) still name `bettercommunity.ch`
  literally. A v2 staging host on another domain will not receive `X-Creator-ID` or the AI
  proof. That is the safe default: in v2 mode the creator headers are not used at all (the
  device-flow token replaces them for #19 and #22).

## 4. Telemetry v2

**Upload format.** BMM queues events in `analytics_queue.jsonl` (Rust). It sends them as
`POST <analytics_endpoint>` (gzip, `Content-Type: application/json`) with this body:

```json
{ "schema": "bmm-telemetry", "v": 1, "api_key": "bmm_pk_…", "packet_id": "<uuid>", "batch": [ { "event": "…", "distinct_id": "…", "timestamp": "…", "properties": { … } } ] }
```

- `schema` and `v` are new. They are constants, `TELEMETRY_SCHEMA` / `TELEMETRY_SCHEMA_V` in
  `analytics.rs`, and the session-end beacon (`analytics.ts`) sends the same pair. They carry
  no data about anybody.
- The server (`ingest_handler`, telemetry-dashboard `main.rs`) parses the envelope as free JSON
  and reads only `api_key`, `packet_id` and `batch`. A server that predates the new fields
  ignores them. A newer server can branch on `v` before it reads the events.
- Bump `TELEMETRY_SCHEMA_V` when an event's shape changes in a way the server must know about.
- The answer is `{status, received, packet_id, sampling}`. `sampling` is stored by
  `store_sampling`.

**Endpoint and keys.** These come from links.json:

- `analytics_endpoint`: `https://telemetry.bettercommunity.ch/batch/`, HTTPS only. Plain HTTP
  is allowed only to localhost (`endpoint_allowed`).
- `analytics_key`: a public ingest key, `bmm_pk_…`.

The other routes are derived from the endpoint: `/issues`, `/consents`, `/delete-request`,
`/data-request`, `/api/packet-status` and `/config`.

**Consent.** Nothing is sent unless `analytics_consent == Some(true)`. That rule did not change.
No new data is collected.

**Consent receipts → telemetry server `POST /consents`.** This already existed before this work
(`consent_sync`, `consent_ledger.rs:824`).

- It sends the receipts after a cursor (`consent-ledger.sync.json`), at most 200 per run, keyed
  by the random install id. The MAC is not sent.
- The server keeps the rows append-only and recomputes each receipt's hash. The canonical text
  is shared, and the vectors are tested on both sides (`canonical_vector`).
- It runs only with telemetry consent, or when the user presses « Send to the server » in My
  consents.
- No change was needed.

**Consent receipts → BC v2 ledger** (new: `bc_v2.rs`, `consent_sync_bc_v2`).

- It runs only when `BCApiVersion=v2` and the same permission as above holds. Both checks are
  repeated in Rust, so the webview cannot skip them.
- The subject is `anon_` followed by 26 Crockford base32 characters. They come from
  `sha256("bmm-consent-bcv2:" + install_id)`. The value is stable for the install, and it is not
  the install id that the telemetry server sees.
- The cursor is `consent-ledger.bcv2.json`: `sent_seq` plus the hash of that receipt. If the
  stored hash no longer matches the receipt at that seq (an imported ledger), the cursor
  restarts from the beginning.
- Each run sends at most 50 receipts.
- 2xx means accepted. 400, 403, 404, 409 and 422 mean rejected: the receipt is counted and
  passed. 401, 408, 429, 5xx and network errors stop the run, and the next run retries from the
  same receipt.
- The v2 server keeps its own chain and takes no client hash. Idempotence is therefore
  client-side. A crash between the server's 201 and the cursor write can send one receipt twice.

### 4.1 BetterCommunity v2 app telemetry (BMM 1.0.3, ADR 0024)

In v2 mode, when links.json gives `bc_v2_app_id` and `bc_v2_app_key`, `analytics_flush` first
sends the queue to `POST <v2>/v2/apps/{app}/telemetry/batch` (`bc_v2_telemetry.rs`):

- The consent gate is unchanged (`analytics_consent == Some(true)` before anything).
- The consent header is the newest telemetry receipt of the ledger (its categories, its text
  version), never the webview's word. No receipt granting a category: nothing goes to v2.
- `src-tauri/src/commands/bc_v2_telemetry.json` is the declaration the team PUTs on
  `/v2/apps/{app}/telemetry`. The same file filters each event: undeclared events and
  properties, and events of a category not granted, are dropped before sending. The precise
  hardware identity of `$identify` (board, machine model, disks, monitors) and names (repo,
  creator) are not declared, so they never leave.
- The install is `bmm_` + 32 hex of `sha256("bmm-telemetry-bcv2:" + Creator ID)`, never the id.
- Batches of 500 with a random packet id. `202`: sent. `404` (not declared yet), `403`, `5xx`,
  no answer: kept for the next flush. `400` / `413` / `422`: dropped.
- `$replay` has no v2 home and continues to the telemetry server; the session-end beacon is not
  sent in this mode (the queued `session_end` goes to v2).
- A deletion request on a v2 packet calls `/telemetry/forget` (v2 erases by install).

## 5. What the v2 side and the owner must do

In this order. Each step is safe on its own: until the last one, installed copies stay on v1.

1. **Provision BMM** on each v2 deployment, after `staff:bootstrap`:
   `DATABASE_URL=… pnpm --filter @bc/api run app:provision-bmm`. The run prints the
   publishable key once (`bc_pk_…`) and the client id. Its client must allow the scopes BMM asks:
   `openid profile offline_access feedback:write feedback:read notifications:read consents:read
   consents:write ai:classify` (ADR 0018 / 0020).
2. **Publish BMM's legal texts** as entries of BMM's project, slugs `bmm-terms` and
   `bmm-privacy`, in English and French, from `TOS.md` / `TOS_FR.md` and `PRIVACY.md` /
   `PRIVACY_FR.md`, with « Version 2026-10-13. » (the version this build ships) on the first
   line. While v2 publishes that same version, BMM sends the existing Terms / Privacy receipts as
   `kind: legal`; a later version on v2 makes BMM ask again.
3. **Declare BMM's telemetry**: `PUT /v2/apps/{app}/telemetry` with
   `src-tauri/src/commands/bc_v2_telemetry.json` as the body. Without it v2 answers `404
   telemetry.not_declared` and BMM keeps the events queued.
4. **Open the feedback centre** for project `bmm` (Studio, Feedback) with the limits wanted.
5. **Publish the platform assets** (ADR 0019): `contributors.json`, the Laya offline pack as a
   release file of BMM's stable channel (`bmm-laya-offline`), and BMM's releases on v2 for the
   update feed (`update-manifest.json` and `update.json` among the assets, as on GitHub).
6. **Set the links.json values** (asset `links.json`, `PUT /v2/platform-assets/links.json`, and
   the BCWEB copy while v1 still serves it):
   `bc_v2_client_id`, `bc_v2_app_key`, `bc_v2_app_id`, then, to switch, `bc_api: "v2"` and,
   while v2 runs beside v1, `bc_v2_base`. To roll back: remove `bc_api` (or set `"v1"`).
7. Test a build first with `app.cfg` `BCApiVersion=v2` + `BCv2Base=` the staging root.

Still open on the v2 side (BMM keeps v1 for these): avatars, launch announcements, author search
by creator id, the Discord link, post comment and revision history, the account web pages (#20),
a v2 home for session replay.

## 6. Not done in BMM 1.0.3

- An install's anonymous consent subject is not linked to the account after sign-in
  (`POST /v2/me/consents/link`): receipts stay on the anonymous subject.
- Repos with `require_login` or an allow list on v2 (ADR 0016) are not opened with the token
  (`repos:read` is not asked).
- links.json is read from the v1 root even in v2 mode (it carries the switch); after the
  cut-over one domain serves both.
- The v2 web address of the journal and of the account pages is not mapped: « Open on the
  website » uses the v2 root with v1's paths.

## 7. Verification

- `tests/bc-endpoints.test.mjs` checks:
  - v1-mode URLs equal the hand-built ones
  - the parsing of the switch
  - v2 routing (compat paths and native paths)
  - rejection of unsafe bases
  - the feedback mappers (payload, config, answers)
  - the wiring of the telemetry envelope and the v2 consent sync
- `src-tauri/src/commands/bc_v2.rs` tests check:
  - root resolution and base validation
  - the subject format and its stability
  - receipt mapping (custom, accepted, withdrawn, legal deferred, reset skipped)
  - the cursor's resume and restart
  - retry classes
  - app key validation
- `analytics.rs` `envelope_tests` checks the versioned batch envelope.

BMM 1.0.3 adds:

- `tests/bc-v2.test.mjs`: the v1 default (bundled links.json, every URL), the switch's
  precedence, what moves and what stays on v1, the device-flow state machine
  (`core/bc-device-flow.ts`), adapters against contract-shaped fixtures (feedback config and
  answers, notifications, blog, update feed, telemetry declaration), and the wiring (commands
  registered, health gate, no token in the webview, consent gate before v2 telemetry).
- Rust: `bc_v2.rs` (precedence, health answer, ids, legal versions and mapping),
  `bc_v2_auth.rs` (token endpoint answers, refresh margin, verification page host, no token in
  the status, scopes), `bc_v2_telemetry.rs` (declaration vs contract, pseudonym, consent header
  from the ledger, filtering, batch outcomes), `ai_embedded.rs` (v2 mirror).
