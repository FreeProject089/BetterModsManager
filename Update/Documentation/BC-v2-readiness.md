# BetterCommunity v2 and telemetry v2: BMM readiness

Status as of 2026-10-13 (branch `Tdev`). This page lists every BetterCommunity (BC) call BMM
makes, what each becomes in v2, and what is ready, what waits for v2, and what has not started.
v2 contracts referenced here: `BetterCommunity-v2/packages/contracts/src/*.ts` and ADRs 0009
(catalogues), 0011 (consent ledger), 0012 (feedback centre). Telemetry server: the Rust/Axum
telemetry dashboard, `BCW/BCWEB/bmm/telemetry-dashboard/server`.

**Nothing changes for users today.** Every switch below is off by default. With no new line in
`app.cfg`, BMM builds the same URLs and sends the same requests as before this work. The node
test `tests/bc-endpoints.test.mjs` checks this URL by URL.

---

## 1. How to switch a build to v2

Two `app.cfg` keys. They are line-parsed like `BCTestMode` and documented in `APP_CFG.md`:

```ini
BCApiVersion=v2
BCv2Base=https://v2-staging.example.org
```

| Key | Values | Default | Effect |
|---|---|---|---|
| `BCApiVersion` | `v2` or `2` (any case); anything else is v1 | `v1` | Selects the v2 adapters, and moves the v1 paths that v2 serves to the v2 root |
| `BCv2Base` | `https://…`, or `http://` to localhost / 127.0.0.1 / `*.localhost` | empty: same root as v1 | Where v2 lives while it runs beside v1 (ADR 0005) |

The keys are read once at startup by `get_bc_config` (`src-tauri/src/commands/settings.rs`).
The webview gets them through `loadBcConfig` (`frontend/src/core/links-config.ts`), and
`bc_v2.rs` reads them on the Rust side.

There is no Settings UI row for this. It is a build or test switch, like `BCTestMode`, and stays
out of the Settings page. Restart BMM after you change it.

In v2 mode only these things move:

1. Calls that have a v2 adapter: feedback, consent receipts, and signed feed discovery.
2. v1 paths that v2 serves itself in its compatibility layer (`compat.ts`, `feedback.ts`):
   `/api/catalog.json`, `/api/repos.json`, `/api/repos/:slug/*`, and `/api/feedback/:project(/config)`.

Every other call stays on the v1 root, so a v2 test build never calls a route v2 does not have.
The list is `V2_COMPAT_ROUTES` in `frontend/src/core/bc-endpoints.ts`. Keep it in step with the
v2 contracts.

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
| 1 | links.json registry | `core/links-config.ts:158` (`bcwebLinksUrl`), fetched via `fetch_remote_json` (`commands/net.rs:83`) | GET `/api/assets/links.json` | anon | the `BmmLinks` JSON | No v2 route. v2 "platform assets" are not in the contracts. | blocked on v2 |
| 2 | Contributors | `ui/app.ts:1761` (`links.contributors`) | GET `/api/assets/contributors.json` | anon | JSON list | Same as #1 | blocked on v2 |
| 3 | Catalogue feeds per kind | `links-config.ts:90-96` defaults; read by `scheduler.ts:12220` and the catalogue loaders via `catalogSources()`; Rust `net.rs:38` `catalog_get` | GET `/api/catalog.json?project=bmm&kind=…` | CID, keyproof, repo-pw | v1 catalogue document | v2 compat `legacyCatalogFeed` (`compat.ts`), public catalogues only, v1 shape | done (compat). Native v2 is the signed feeds (#5). |
| 4 | Catalogue index | `links-config.ts:91` (`catalog_index`) | GET `/api/catalogs.json` | CID | list of official catalogues | No compat path. The v2 equivalent is the signed index `GET /v2/feeds/catalog`. | adapter ready (URL discovery only, see #5) |
| 5 | Signed catalogue feeds (v2 only) | `bc-endpoints.ts` `signedFeedUrls()`, `bc-client.ts` `bcSignedFeeds()` | GET `/v2/feeds/catalog`, `/v2/feeds/catalogs/:catalog`, `/v2/feeds/keys` | anon | DSSE envelope signed with Ed25519 | Verification belongs to the universal catalogue work: format in `catalog_format.rs`, Tauri commands `catalog_validate`, `catalog_normalize`, `catalog_convert`, `catalog_verify_signature` and `catalog_keys` in `catalog_convert.rs`. They are registered in `main.rs`. | adapter ready (discovery). The catalogue loaders do not call the commands yet. |
| 6 | Public repo list | `features/repo/repo.ts:1478` (`links.server_browse`) | GET `/api/repos.json` | CID | `{ repos: [...] }` | v2 compat `legacyRepoFeed` (same shape) | done (compat) |
| 7 | Hosted repo content | Rust `api/mod.rs:3090,3173`, `modlist.rs:824`, `repo.rs:2474,2985,3104`, `net.rs:102` | GET `/api/repos/:slug/*` (`repo.json`, files, Range) | CID, keyproof, repo-pw, `X-Creator-Identity` | bytes | v2 compat `legacyRepoContent` checks `X-Repo-Password` and `X-BMM-Key-Proof` | done (compat). v2 does not read `X-Creator-ID` / `X-Creator-Identity`, so whitelist-by-creator repos need #22. |
| 8 | Update fallback | `ui/update-notes.ts:761` (`autoupdate_api_fallback`) | GET `/api/updates/bmm` (GitHub releases shape) | anon | releases JSON | v2 has `/v2/projects/:project/releases` and channels (`releases.ts`), but no GitHub-shaped compat. Belongs to the self-updater work. | not started |
| 9 | Laya offline model | Rust `commands/ai_embedded.rs:73` | GET `/api/assets/bmm-laya-offline` | anon | model archive | Same as #1, or a v2 release file | blocked on v2 |

### 3.2 Account link and identity

| # | Call | Where | Method and route | Auth | Payload | v2 mapping | Status |
|---|---|---|---|---|---|---|---|
| 10 | Link status | `core/bc-link.ts:82` (migrated to `bcUrl`); `features/repo/repo-sync.ts:251` (direct, not migrated) | GET `/api/link/status?creatorId=` | anon (query) | `{linked, displayName, discord}` | v2 has no install-to-account link. Accounts link installs through OIDC (`/v2/oauth/*`, device flow `/v2/oauth/device`) and `POST /v2/me/consents/link`. | blocked on v2 |
| 11 | Link request (pairing code) | `core/bc-link.ts:163` (migrated) | POST `/api/link/request` | proof | `{creatorId, proof}` → `{code}` or `{linked}` | Replace with the OIDC device flow (`/v2/oauth/device`) | blocked on v2 (needs a BMM OIDC client) |
| 12 | Key v5 upgrade / pin | `core/bc-link.ts:123` (migrated) | POST `/api/link/upgrade` | proof v5 | `{proof}` | No v2 route. v2 has no creator-key model. | blocked on v2 |
| 13 | Discord link | `features/settings/settings.ts:968` (Settings UI, belongs to another agent, not migrated) | POST `/api/link/discord` | anon | `{creatorId, code}` | No v2 route | blocked on v2 |
| 14 | Author lookup | `features/repo/repo-sync.ts:210` (repo-sync belongs to another agent) | GET `/api/users/search?q=` | anon | `{users:[…]}` | No public user search in v2 | blocked on v2 |

### 3.3 Content and notifications

| # | Call | Where | Method and route | Auth | v2 mapping | Status |
|---|---|---|---|---|---|---|
| 15 | Blog list, post, history, comments | `features/community/community.ts:181,576,671,683,774,817` (`bcGet` → `bcApi()`) | GET `/api/blog`, `/api/blog/:slug`, `/api/blog/:id/history[/:rev]`, `/api/blog/:id/comments[/:cid/history]` | anon | v2 content entries: `/v2/entries`, `/v2/entries/:kind/:slug` (`content.ts`). Different model. | not started |
| 16 | Avatars | `community.ts:98`, fetched with `bc_fetch_data_url` | GET `/api/avatar/:id?size=64` | anon | none in the v2 contracts | blocked on v2 |
| 17 | Launch announcements | `ui/launch-announcements.ts:80` | GET `/api/bmm/launch?version=&lang=` (ETag) | anon | v2 releases and announcements have no launch-deck route | blocked on v2 |
| 18 | Notifications | `core/bcweb-notifications.ts:49` → Rust `security.rs:549` | GET `/api/v1/notifications?since=` | BC key | `GET /v2/notifications` (`integrations.ts`) with a v2 token (`bc_pat_` with the notifications scope). Needs a v2 token story and a cursor mapping. | not started |
| 19 | Laya "BetterCommunity" classifier | `features/ai/ai-shared.ts:139` (`bcAuthArgs`) → Rust `ai.rs:32`, `ai_core.rs:2157` | POST `/api/ai/bmm/suggest` | CID and proof | No v2 AI route (the plan describes Laya as a classifier; nothing in the contracts yet) | blocked on v2 |
| 20 | Account page links | `bc-link.ts:236` (`/profile`), `community.ts:524,626` (`/blog`), `bc-feedback.ts:89` (`/dashboard?s=reports`) | browser navigation | n/a | v2 web paths differ (account pages). Needs a v2 path map. | not started |

### 3.4 Feedback, consent and telemetry

| # | Call | Where | Method and route | Auth | v2 mapping | Status |
|---|---|---|---|---|---|---|
| 21 | Feedback config | `features/feedback/bc-feedback.ts:132,193` | GET `<endpoint>/config` | anon | v1 mode: v1 path (v2 also serves it through compat). v2 mode: `GET /v2/projects/bmm/feedback/config`, mapped by `feedbackConfigFromV2`. | adapter ready |
| 22 | Feedback, bug and crash report | `bc-feedback.ts:221` (`submitFeedback`) | POST `/api/feedback/bmm` (default, unchanged) | CID and proof | v2 mode: `POST /v2/projects/bmm/feedback` with `feedbackToV2` (snake_case, flat meta ≤40 keys, `content_type`). The answer goes through `feedbackAnswerFromV2`, which turns problem codes into the v1 status and `{error}`. Identity in v2 mode: `Authorization: Bearer <bc_v2_app_key>` when links.json has a publishable `bc_pk_` key. The creator headers are not sent, because v2 does not read them. v2 compat on `/api/feedback/bmm` also works and treats every sender as anonymous. | adapter ready |
| 23 | Consent receipts → BC v2 ledger | `core/consent.ts` `syncConsents` → Rust `bc_v2.rs` `consent_sync_bc_v2` | POST `/v2/consents` (one per receipt) | anon subject; optional `bc_pk_` app key | Telemetry and crash-report answers become `kind: categories`, `document: app.telemetry` / `app.crash_reports`, a boolean per category, `source: app`. Terms and Privacy answers are deferred (see §5). | adapter ready (category receipts). Legal receipts are blocked on v2. |
| 24 | Telemetry batch | Rust `commands/analytics.rs` `analytics_flush`; webview beacon `core/analytics.ts:825` | POST `<analytics_endpoint>` (`…/batch/`) | pk | Now a versioned envelope, see §4 | done |
| 25 | Consent receipts → telemetry server | Rust `consent_ledger.rs:824` `consent_sync` | POST `…/consents` | pk | Already existed: append-only, receipt hash recomputed by the server, cursor `sent_seq` | done (pre-existing) |
| 26 | Live issues | Rust `commands/live_issues.rs:304,402` | POST `…/issues` | pk | unchanged | done |
| 27 | Packet status, deletion request, data request | Rust `analytics.rs` (`/api/packet-status`, `/delete-request`, `/data-request`) | GET / POST | pk | unchanged | done |

Telemetry SSO (the dashboard login through BCWEB `forward_auth`) is server-side. BMM makes no
call for it.

### 3.5 Call sites migrated, and those left alone

These were migrated to `bcUrl()`. Each produces the same URL in v1 mode:

- `core/bc-link.ts`: link status, link upgrade, link request.

These already go through one central function (`bcApi()` / `bcRoot()`) and were left as they are.
v2 has no route for them, so moving them buys nothing yet:

- `community.ts` (`apiBase = bcApi`)
- `launch-announcements.ts`
- `bcweb-notifications.ts`
- `ai-shared.ts`

These were not migrated because another agent owns the file, or because migrating would change
behaviour:

- `features/repo/repo-sync.ts:205,247` reads `links.bettercommunity` directly and ignores
  `BCTestMode`. Moving it to `bcUrl()` would change test-mode behaviour. That file belongs to
  the repo-sync work.
- `features/settings/settings.ts:968` (`/link/discord`) belongs to the Settings page work.
- The Rust-side hosts (`net.rs` `is_bettercommunity_host`, `ai_core.rs` `bc_base_allowed`,
  `ai.rs` default base, `ai_embedded.rs:73`, `discord.rs:24`) still name `bettercommunity.ch`
  literally. A v2 staging host on another domain will not receive `X-Creator-ID` or the AI
  proof. That is the safe default. Widen it only together with #22 and #19.

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

## 5. What BC v2 still needs from or for BMM

1. **A way to recognise an install, or a linked account.** v2 ignores `X-Creator-ID` and
   `X-Creator-Proof` everywhere, including the feedback compat. It has no `/link/*` routes and
   no creator-key pinning (#10–#13). Two options:
   - accept the BMM creator proof (v1/v5) as an identity, or
   - register BMM as an OIDC public client. BMM would then implement the device flow and keep
     a `bc_at_` token.

   Until one exists, every BMM report on v2 is anonymous (`require_contact` applies), and
   whitelist-by-creator hosted repos cannot work.
2. **A publishable app key for BMM** (`bc_pk_…`, registered under `/v2/apps`). BMM reads it from
   links.json as `bc_v2_app_key`. It attributes reports and receipts to the app, and it is safe
   to ship.
3. **CORS for the webview origin** (`https://tauri.localhost`, `http://tauri.localhost`,
   `tauri://localhost`) on `/v2/projects/:project/feedback` and its `/config`. The feedback
   client uses a webview `fetch` like in v1. Without CORS, the alternative is to proxy through
   Rust: `bc_api_post` would need an `Authorization` header option.
4. **BMM's legal texts as v2 entries.** For example `bmm-terms` and `bmm-privacy`, published
   with a revision per language. Until then, BMM's Terms and Privacy receipts cannot go to
   `/v2/consents`, because `kind: legal` requires a published v2 text and its current revision.
   They are kept in `deferred` and replayed later. BMM will also need to show and send the
   revision (`GET /v2/consents/documents`).
5. **A home for platform assets.** links.json, contributors.json, the Laya offline model and the
   update fallback in the GitHub releases shape (#1, #2, #8, #9) have no v2 route. They need
   either compat paths (`/api/assets/:key`, `/api/updates/bmm`) or a release channel for BMM.
6. **The remaining v1 surfaces BMM reads:**
   - blog as content entries, with history and comments (#15)
   - avatars (#16)
   - launch announcements (#17)
   - user search (#14)
   - the Discord link (#13)
   - the AI suggest endpoint (#19)

   Each needs a v2 route or a compat path. BMM then needs an adapter.
7. **Notifications.** A token BMM can hold for `GET /v2/notifications` (scope
   `notifications:read`), plus a cursor equivalent of `since` (#18).
8. **Signed feed verification on the BMM side.** This is the sibling's work: the
   `catalog_verify_signature` / `catalog_normalize` commands, now registered from
   `catalog_convert.rs`. What is missing is BMM wiring, not v2: the catalogue loaders do not
   yet read `bcSignedFeeds()` in v2 mode. The index will replace `catalogs.json`.
9. **Telemetry server.** No change is required. Optionally, read `schema` / `v` from the batch
   envelope and refuse versions it does not know.

## 6. Next steps on the BMM side, in order

1. In v2 mode, have the catalogue loaders fetch
   `bcSignedFeeds().index`, verify it, normalise it, and fall back to `catalogs.json` on v1.
   Exit criterion: a signed v2 feed loads and a tampered one is refused in the app.
2. When v2 provides item 2, ship `bc_v2_app_key` in links.json. Exit criterion: v2 shows
   reports as sender `app`.
3. When v2 provides items 1 and 3, add a BMM OIDC client (device flow). Replace
   `bc-link.ts`'s three calls with it in v2 mode. Exit criterion: a linked user's report
   arrives as `account`.
4. When v2 provides item 4, map `tos` and `privacy` receipts to `kind: legal`, and replay
   `deferred`. Exit criterion: My consents shows the v2 chain as ok.
5. Port the remaining surfaces (blog, notifications, announcements, avatars) one at a time.
   Each goes behind `bcUsesV2()`, with a node test that v1 URLs are unchanged.

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
