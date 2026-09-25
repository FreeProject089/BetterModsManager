# CI/CD and security scans

Every GitHub Actions workflow in the BMM repository: what starts it, what it checks, what makes it
fail, what it leaves behind, and how to run the same thing on your own machine. The last part covers
the security scans in detail: running each one by hand, changing thresholds, excluding a path, and
dismissing a false positive.

This page is for contributors and maintainers. Nothing here runs inside the app.

---

## The four workflows

| Workflow | File | Starts on | Blocks on |
|---|---|---|---|
| CI | `.github/workflows/ci.yml` | push to `main` / `Tdev`, every pull request, by hand | any gate in `npm run ci`, a failing `cargo test`, an unexplained npm or cargo advisory |
| Release | `.github/workflows/release.yml` | a `v*` tag, or by hand with a version | any build, signing or upload step |
| Re-sign update manifests | `.github/workflows/resign-manifests.yml` | Monday and Thursday 04:17 UTC, or by hand | a manifest that does not verify against the pinned public key |
| Security | `.github/workflows/security.yml` | push to `main` / `master` / `Tdev`, every pull request, Monday 04:23 UTC, by hand | a secret in the history, or a Semgrep / Trivy finding at or above the threshold |

Every action is pinned to a full commit SHA with its tag in a comment, and every Docker image the
security scans use is pinned to a digest. A tag can be moved by whoever controls it; a SHA cannot.
Each workflow starts from `permissions: {}` or `contents: read`, and a job gets more only when it
writes something.

### CI (`ci.yml`)

| Job | What it checks |
|---|---|
| Frontend | `npm ci`, then `npm run ci`: the same gate chain as a local run (translations, docs, TypeScript, compiled output freshness, API docs, deep links, `security-guard`, `check-api-secrets`…). The BMM Docs repository is cloned at the commit this tree pins, because several gates read it. |
| Rust | `cargo test` in `src-tauri` on Windows (BMM's target). |
| npm audit | `node .github/scripts/dep-audit.mjs npm .`: high and critical advisories in shipped (non-dev) npm dependencies fail. |
| cargo audit | `node .github/scripts/dep-audit.mjs cargo src-tauri`: any RustSec vulnerability fails. |

The only way past a reported advisory is an entry in `.github/audit-ignore.json` that names the
advisory, the folder and a reason. Warnings (unmaintained, yanked) are printed and do not fail.

- **Secrets / variables:** none.
- **Artifacts:** none.
- **Run it locally:** `npm run ci`, `cd src-tauri && cargo test`, and the two `dep-audit.mjs` lines above.

### Release (`release.yml`)

Builds BMM and the MCP sidecar, packs and signs the installer with BetterInstaller, signs the update
manifests, and publishes the GitHub release. Its one job has `contents: write`.

- **Secrets:** `BMM_PRIVATE_KEY` (required, the Ed25519 publisher key); `BETAHUB_CONFIG` (optional,
  the full `betahub-config.local.ts`; without it the committed example is used).
- **Artifacts:** the release itself: installer, delta, `update.json`, `update-manifest.json`.
- **Run it locally:** `examples/bmm/release.ps1` in BetterInstaller does the same steps. Never run
  it with `-Publish` to test.

### Re-sign update manifests (`resign-manifests.yml`)

Both signed manifests expire after 7 days. This job downloads them from the latest release (or the
tag given by hand), renews the signature, verifies it against the public key installed copies pin,
and re-uploads them. It runs twice a week so that one skipped scheduled run is not an outage.

- **Secrets:** `BMM_PRIVATE_KEY` (required); `BCWEB_ASSETS_TOKEN` (optional: also pushes the files to
  the BCWEB mirror; skipped when unset).
- **Artifacts:** none; it replaces the two release assets.

### Security (`security.yml`)

| Job | Tool | What it reads | Fails when |
|---|---|---|---|
| Gate self-test | `node --test` | `.github/scripts/security-gate.test.mjs` | the gate itself is wrong; every scan waits for it |
| Secrets | Gitleaks 8.30.1 | the whole git history, every branch | any finding not reviewed in `.gitleaks.toml` / `.gitleaksignore`, or zero commits read |
| SAST | Semgrep 1.178.0 | `src-tauri/src`, `frontend/src`, `.github/workflows`, and the mini-server templates | a finding at or above the Semgrep threshold |
| Dependencies + container config | Trivy 0.74.0 | `benchmarks/rust/Cargo.lock` and the Dockerfile templates in `src-tauri/src/templates/docker` | a finding at or above the Trivy threshold |
| Upload SARIF to code scanning | `codeql-action/upload-sarif` | the three SARIF files | an upload that fails on a repository that supports code scanning |
| PR comment | `gh api` | the three verdicts | never fails a pull request by itself |

Each scanner writes its own report and exits 0. **One script decides:**
`.github/scripts/security-gate.mjs`, the same file in BMM, BetterInstaller, BMM Docs and BCW. It puts
every finding on one scale (`critical > high > medium > low > info`), prints a table and fails the job
only at or above the threshold.

- **Secrets:** none to create. The upload and comment jobs use the automatic `GITHUB_TOKEN`.
- **Variables:** see [Thresholds](#thresholds).
- **Artifacts** (kept 30 days): `security-gitleaks`, `security-semgrep` and `security-trivy`. Each
  holds the native JSON report, the SARIF, a `*-summary.md` table and a `*.result.json` verdict.

**Why some scans are not here:**

- **No DAST (OWASP ZAP, Nuclei).** BMM is a desktop app. There is no staging web app to point a
  scanner at: the local API binds to `127.0.0.1` inside the running app, and repo servers run on
  users' own machines. No job in this repository targets a host on the network, least of all a
  production one.
- **No Trivy scan of `package-lock.json` and `src-tauri/Cargo.lock`.** `ci.yml`'s npm and cargo
  audits already gate them, blocking, with reasons in `.github/audit-ignore.json`. A second scanner
  would need every accepted advisory written in two ignore files that drift apart. So each lockfile
  has one authority. Trivy covers what nothing else did: the benchmark crate's lockfile and the
  Dockerfiles BMM generates for users.
- **No image scan.** No container image is built or published by this repository.
- **Semgrep complements the `npm run ci` gates, it does not repeat them.** `security-guard` bans
  `eval` and inline handlers, and `check-api-secrets` checks the API docs. Semgrep brings taint-style
  rules (path traversal, ReDoS, open redirect, unsafe spawn, Actions script injection, unpinned
  actions) and covers the Express mini-server that those gates do not read.

---

## Reading the results

### The job log and summary

The gate prints one table per tool: severity, `BLOCK` or `pass`, rule id and location. It also
writes the same table to the job summary. A blocking finding is also an `::error` annotation on the
run page. Gitleaks never prints a secret: it runs with `--redact`, so the log shows the rule, the
file, the line, the commit and the fingerprint.

### The pull-request comment

On a pull request, the `PR comment` job posts **one** comment, then edits that same comment on
every later run. It finds it by a hidden first line, `<!-- bmm-security-gate -->`. The comment
shows:

- one row per tool: threshold, count per severity, blocking count, `pass` or **FAIL**;
- an overall `PASSED`, `FAILED` or `INCOMPLETE` (`INCOMPLETE` means one scan produced no verdict
  because it did not run; it is never shown as a pass);
- a link to the run and its artifacts.

A pull request from a fork, or from Dependabot, gets a read-only token: the job prints a notice and
posts nothing. The same table is still in each scan job's summary.

### Code scanning (the Security tab)

The `code-scanning` job uploads the Gitleaks, Semgrep and Trivy SARIF with one category per tool
(`gitleaks`, `semgrep`, `trivy`). GitHub then:

- tracks each alert over time (open, fixed, dismissed);
- annotates the changed lines of a pull request.

The upload runs even when a gate failed, because those are the alerts that matter. The job first
asks the API whether code scanning is available. BMM is public, so it is. On a private repository
without GitHub Advanced Security, the job says so in a notice and uploads nothing, and the SARIF
stays in the artifacts. The templates' SARIF is not uploaded, because its paths name the renamed
`*.js` copies; those findings are in the `security-semgrep` artifact and the gate.

Code scanning is a view. **The gate is what fails the build.** A finding dismissed in the Security
tab still fails the job at the next run, as long as the tool still reports it.

---

## Thresholds

The threshold is the **lowest severity that fails**. Set it as a repository variable in
**Settings > Secrets and variables > Actions > Variables**:

| Variable | Values | Default |
|---|---|---|
| `SECURITY_GATE_SEVERITY` | `critical`, `high`, `medium`, `low` | `high` |
| `SECURITY_GATE_SEVERITY_SEMGREP` | same | the global value |
| `SECURITY_GATE_SEVERITY_TRIVY` | same | the global value |

- `critical` and `high` block by default. `medium` blocks only if you choose `medium` or `low`.
  `low` blocks only at `low`. `info` never blocks.
- Gitleaks has no threshold: any secret that is not a reviewed exclusion fails.
- A value the gate does not know, such as a typo, **fails the run** with exit code 2. It does not
  fall back to a default, because a typo must never mean that nothing blocks.
- Trivy's `UNKNOWN` (an advisory not rated yet) counts as `high`.
- Semgrep's `ERROR` counts as `high`, `WARNING` as `medium` and `INFO` as `low`.

To try a threshold without changing the variable, run the gate locally on the downloaded artifact:

```bash
SECURITY_GATE_SEVERITY=medium node .github/scripts/security-gate.mjs --tool trivy --report trivy.json
```

---

## Running each scan by hand

Everything runs from the repository root with Docker, using the same pinned images as CI. On
Windows, use Git Bash with `export MSYS_NO_PATHCONV=1`, or a clone inside WSL. Bind mounts of a
Windows drive are slow, and Trivy can hit its 5-minute timeout on them.

```bash
GITLEAKS=zricethezav/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f
SEMGREP=semgrep/semgrep:1.178.0@sha256:32e459968daabe7ab86968184a29109b9564aa00392401156f9788452b42786b
TRIVY=aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969
mkdir -p reports
```

**Secrets (Gitleaks, whole history):**

```bash
docker run --rm -v "$PWD:/repo" \
  -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0='*' \
  "$GITLEAKS" git /repo --config /repo/.gitleaks.toml --gitleaks-ignore-path /repo/.gitleaksignore \
  --redact --verbose --report-format json --report-path /repo/reports/gitleaks.json --exit-code 0
node .github/scripts/security-gate.mjs --tool gitleaks --report reports/gitleaks.json
```

The log must say `N commits scanned` with N above 0. `0 commits scanned` means git refused the
folder (the `safe.directory` variables are missing), not that the history is clean.

**SAST (Semgrep, pinned rules):**

```bash
REF=$(grep -oE 'SEMGREP_RULES_REF: [0-9a-f]{40}' .github/workflows/security.yml | cut -d' ' -f2)
git init -q ../semgrep-rules && git -C ../semgrep-rules fetch -q --depth 1 https://github.com/semgrep/semgrep-rules "$REF" \
  && git -C ../semgrep-rules checkout -q FETCH_HEAD
CFG=$(grep -v '^#' .github/security/semgrep-rules.txt | grep . | sed 's#^#--config=/rules/#')
docker run --rm -v "$PWD:/src" -v "$PWD/../semgrep-rules:/rules:ro" -w /src \
  -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0='*' \
  "$SEMGREP" semgrep scan --metrics=off $CFG --json-output=reports/semgrep.json \
  src-tauri/src frontend/src .github/workflows
node .github/scripts/security-gate.mjs --tool semgrep --report reports/semgrep.json
```

**Dependencies and Dockerfiles (Trivy):**

```bash
docker run --rm -v "$PWD:/src" -w /src "$TRIVY" fs --scanners vuln,misconfig --show-suppressed \
  --skip-files package-lock.json --skip-files src-tauri/Cargo.lock \
  --file-patterns 'dockerfile:Dockerfile\..*\.template$' \
  --format json --output reports/trivy.json --exit-code 0 .
node .github/scripts/security-gate.mjs --tool trivy --report reports/trivy.json
```

**The gate itself:** `node --test .github/scripts/security-gate.test.mjs`.

**The PR comment, rendered locally:** add `--json reports/<tool>.result.json` to each gate line
above, then run:

```bash
node .github/scripts/security-gate.mjs --markdown --results reports/gitleaks.result.json \
  --results reports/semgrep.result.json --results reports/trivy.result.json --marker bmm-security-gate
```

---

## Adding or excluding a target

| To… | Edit |
|---|---|
| Scan another source folder with Semgrep | the path list at the end of the `semgrep (application code)` step in `security.yml` |
| Add a Semgrep rule | a line in `.github/security/semgrep-rules.txt`: a rule file path in `semgrep/semgrep-rules` at the pinned commit |
| Exclude paths from Semgrep | a `.semgrepignore` at the root, one pattern per line, with a comment saying why |
| Give a lockfile to Trivy | nothing: `trivy fs` finds every lockfile, except the two in `--skip-files` |
| Exclude a folder from Trivy | `--skip-dirs <dir>` in the `trivy fs` step, with a comment saying why |
| Bump the Semgrep rules | change `SEMGREP_RULES_REF`, then regenerate the lists (see below) and read the diff |

The rule lists hold only rule files whose rules are not tagged `subcategory: audit`. Audit rules
flag every use of a sink, such as every `innerHTML` or every `temp_dir`, for a human to review. On
this codebase they produced about 3,700 hits, 1,480 of them at `ERROR`, with no way to tell a real
one from the rest. To regenerate the list after bumping the ref, keep the same directories as the
list header, keep every rule file whose rules are not all `audit`, and review the diff like code.

A Semgrep rule from a pinned commit gives the same result next year, while a registry ruleset
(`p/…`) changes under you. The cost is that new rules arrive only when someone bumps the ref.

---

## Dismissing a false positive properly

There are two places to silence a finding. **Prefer the tool's own config.** It is versioned,
reviewed in a pull request, carries its reason next to it, and applies to the gate, the artifacts
and the Security tab alike. A dismissal in the Security tab only hides the alert in that view: the
gate still fails at the next run.

| Tool | Where | Format |
|---|---|---|
| Gitleaks, one finding | `.gitleaksignore` | the fingerprint printed in the log (`commit:file:rule:line`), under a comment saying why |
| Gitleaks, a class of false positive | `.gitleaks.toml` `[[allowlists]]` | `targetRules` + a narrow `regexes`, with a comment proving it cannot match a real secret |
| Semgrep | the source line | `// nosemgrep: <rule-id>` (or `#` in Python), with the reason on the line above |
| Trivy | `.trivyignore` | `CVE-XXXX-YYYY exp:2026-12-31` under a comment with the reason; the expiry makes the exclusion come back up for review |
| Dependency audit (`ci.yml`) | `.github/audit-ignore.json` | id, tool, folder, reason, date |

Rules for all of them:

- **A real secret is never excluded.** Rotate it first. Only then, if it must stay in the history,
  add its fingerprint with the rotation date.
- An exclusion names one finding or one provably harmless class, never a whole rule or a whole
  folder "to make CI pass".
- A change to any of these files is a security change: review it like one.

A Security-tab dismissal (`False positive` / `Won't fix`, with a comment) is still useful to record a
decision about an alert that the tool config cannot express. Write the justification in the comment
field, not just the reason code.

---

## Testing without touching anything live

- Every scan reads only the checkout. No job opens a connection to a BMM server, a user's repo
  server or any production host. The only network traffic is fetching the pinned images, Trivy's
  advisory database and the pinned Semgrep rules.
- Run the workflows on a branch or a pull request. `workflow_dispatch` runs them on demand without
  a commit.
- Run each command above locally; the reports land in `reports/`. Do not commit that folder.
- To see the gate fail on purpose, lower the threshold for one run with `SECURITY_GATE_SEVERITY=low`
  locally, or set the repository variable on a test branch run.
- `node --test .github/scripts/security-gate.test.mjs` proves the gate still tells `high` from `low`,
  and treats a missing report or a scan of nothing as a failure, not a pass.
