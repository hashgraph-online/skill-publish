# skill-publish

| ![Hashgraph Online Logo](https://raw.githubusercontent.com/hashgraph-online/standards-sdk/b5be8d9b59eed13ee3ea174d8f0e75293793faad/Hashgraph-Online.png) | The official **skill-publish** CLI and GitHub Action for validating, quoting, and publishing trustless, immutable, on-chain skill releases through the HOL Registry Broker.<br><br>Built and maintained by [Hashgraph Online](https://hol.org).<br><br>[npm Package](https://www.npmjs.com/package/skill-publish)<br>[GitHub Marketplace](https://github.com/marketplace/actions/skill-publish)<br>[HOL Registry](https://hol.org/registry) |
| :--- | :--- |

Instead of sharing mutable URLs or copy/paste blobs, each `name@version` release is recorded on Hedera (HCS) and exposed via `hcs://...` references. That immutability is the value: the published artifact is tamper-evident, reproducible, and audit-friendly.

Immutability gives you:

- **Version pinning:** consumers can depend on an exact `name@version`.
- **Reproducible retrieval:** the same canonical references resolve later (not “whatever is at this URL today”).
- **Audit trail:** topic IDs, job IDs, and optional repo+commit stamping connect releases back to source.

A skill package is `SKILL.md` + `skill.json` (plus optional files). The action validates, quotes, publishes, waits for completion, and emits outputs.

By default, `skill-publish` excludes hidden files and directories, env files, lockfiles, build output, local databases, and key/certificate material from package discovery before quote or publish.

[![npm](https://img.shields.io/npm/v/skill-publish?style=for-the-badge&logo=npm)](https://www.npmjs.com/package/skill-publish)
[![GitHub Marketplace](https://img.shields.io/badge/GitHub_Marketplace-skill--publish-2EA44F?style=for-the-badge&logo=github)](https://github.com/marketplace/actions/skill-publish)
[![OpenAPI Spec](https://img.shields.io/badge/OpenAPI-3.1.0-6BA539?style=for-the-badge&logo=openapiinitiative&logoColor=white)](https://hol.org/registry/api/v1/openapi.json)
[![HOL Registry](https://img.shields.io/badge/HOL-Registry-5599FE?style=for-the-badge)](https://hol.org/registry)

## Quick Start

Choose the path that matches how you work:

### GitHub Action (validate-first quickstart)

Start with a validate-only pull request workflow. This does not require `RB_API_KEY`, and it uploads preview status through GitHub OIDC when the repo grants `id-token: write`.

```yaml
name: Validate Skill
on:
  pull_request:
    paths:
      - skills/my-skill/**
      - .github/workflows/validate-skill.yml

jobs:
  validate:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - name: Validate skill package
        uses: hashgraph-online/skill-publish@v1
        with:
          mode: validate
          skill-dir: skills/my-skill
          annotate: "false"
```

### GitHub Action (release publishing)

Publishing immutable releases still consumes HOL Registry Broker credits. Add `RB_API_KEY` only when you are ready to request an authenticated quote and then publish on-chain:

```yaml
name: Publish Skill
on:
  release:
    types: [published]

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v4
      - name: Publish skill package
        uses: hashgraph-online/skill-publish@v1
        with:
          api-key: ${{ secrets.RB_API_KEY }}
          skill-dir: skills/my-skill
          annotate: "true"
          github-token: ${{ github.token }}
```

### CLI (recommended for local setup and first publish)

```bash
npx skill-publish
npx skill-publish validate ./weather-skill
npx skill-publish setup --account-id 0.0.12345 --hedera-private-key <key>
npx skill-publish create ./weather-skill --name weather-skill --preset api
npx skill-publish quote ./weather-skill
npx skill-publish publish ./weather-skill
```

After publish, use the returned canonical skill page, badge snippet, and resolver URLs to share a version-pinned release.

## 60-Second Path

If you already have a repo and wallet, this is the shortest path to a live page:

```bash
npx skill-publish setup-action . --skill-dir .
npx skill-publish setup --account-id 0.0.12345 --hedera-private-key <key>
git tag v1.0.0 && git push --tags
```

That gives you validate-only CI first, then a live Registry page, pinned install URLs, and share-ready badge snippets once you have funded credits and publish a release.

## Jump To

- [CLI (npx)](#cli-npx)
- [First Publish in Under 5 Minutes](#first-publish-in-under-5-minutes)
- [Golden Workflow Templates](#golden-workflow-templates)
- [Trust and Security Defaults](#trust-and-security-defaults)
- [Troubleshooting Matrix](#troubleshooting-matrix)
- [Canonical References](#canonical-references)

## CLI (npx)

The CLI now supports guided, Vercel-style command discovery:

```bash
npx skill-publish
npx skill-publish --help
```

Core flows:

```bash
npx skill-publish setup --account-id 0.0.12345 --hedera-private-key <key> --hbar 5
npx skill-publish create ./weather-skill --name weather-skill --preset api
npx skill-publish init ./skills/my-skill
npx skill-publish doctor ./skills/my-skill
npx skill-publish doctor ./skills/my-skill --fix --local-only
npx skill-publish validate ./skills/my-skill
npx skill-publish quote --skill-dir ./skills/my-skill
npx skill-publish publish --skill-dir ./skills/my-skill
```

Repository automation flows:

```bash
# Add a publish workflow to an existing SKILL.md repository
npx skill-publish setup-action . --skill-dir skills/my-skill

# Scaffold a new repository with skill package + GitHub workflow preconfigured
npx skill-publish scaffold-repo ./weather-skill --name weather-skill

# Golden path: scaffold repo, repair package metadata, and prepare for publish
npx skill-publish create ./weather-skill --name weather-skill --preset api
```

Distribution helper flows:

```bash
npx skill-publish badge ./skills/my-skill
npx skill-publish install-url ./skills/my-skill --format summary
npx skill-publish install-url --name programmable-secrets --version 1.0.1 --format pinned-skill-md
npx skill-publish release-notes ./skills/my-skill
npx skill-publish readme-snippet ./skills/my-skill
npx skill-publish attested-kit ./skills/my-skill --format json
npx skill-publish apply-kit ./skills/my-skill --repo-dir . --docs-path docs/my-skill.md
npx skill-publish submit-indexnow ./skills/my-skill
```

## Attested Distribution Kit

`skill-publish` can now generate an attested distribution kit for each resolved `name@version`.

The kit includes:

- canonical HOL page URL
- machine-readable `entity.json`
- badge markdown and HTML
- release notes, README, and docs snippets
- package metadata block
- `codemeta.json`
- IndexNow submission targets

Typical flow:

```bash
npx skill-publish attested-kit ./skills/my-skill --format json
npx skill-publish apply-kit ./skills/my-skill --repo-dir . --docs-path docs/my-skill.md
npx skill-publish submit-indexnow ./skills/my-skill
```

Wallet-first bootstrap:

```bash
# Create API key via ledger challenge/verify and top up credits in one command
npx skill-publish setup \
  --account-id 0.0.12345 \
  --network hedera:testnet \
  --hedera-private-key <key> \
  --hbar 5
```

What `setup` does:
- requests a ledger challenge from the broker
- signs locally with your Hedera private key
- verifies the challenge and receives an API key
- stores the key in `~/.skill-publish/credentials.json` (unless `--no-save`)
- optionally purchases credits with `--hbar`

After setup, `quote` and `publish` automatically reuse the stored key, so you can run:

```bash
npx skill-publish doctor ./skills/my-skill
npx skill-publish validate ./skills/my-skill
npx skill-publish quote ./skills/my-skill
npx skill-publish publish ./skills/my-skill
```

`quote` requires broker authentication, and `publish` requires both broker authentication and funded credits because the release is written on-chain.

`publish` remains the default command, so legacy flag-only usage still works:

```bash
RB_API_KEY=rbk_xxx npx skill-publish --skill-dir ./skills/my-skill
```

Optional overrides:

```bash
npx skill-publish \
  --mode validate \
  --skill-dir ./skills/my-skill
```

```bash
npx skill-publish \
  publish \
  --api-key rbk_xxx \
  --skill-dir ./skills/my-skill \
  --version 1.2.3 \
  --annotate false
```

Dry run behavior:

```bash
npx skill-publish publish ./skills/my-skill --dry-run
# no key => validate-only
# with key => quote-only
```

GitHub Action modes:

```yaml
with:
  mode: validate # no RB_API_KEY required
  annotate: "false"
```

```yaml
with:
  mode: publish
  api-key: ${{ secrets.RB_API_KEY }}
```

## First Publish in Under 5 Minutes

Use this path when you want the full CI/CD setup with GitHub releases and annotations.

1. Generate an API key: https://hol.org/registry/docs?tab=api-keys
2. Add credits: https://hol.org/registry/docs?tab=credits
3. Add `RB_API_KEY` as a GitHub secret.
4. Commit `SKILL.md` and `skill.json` to your repo.
5. Add the validate workflow for pull requests, then add the publish workflow for releases.

Validate on pull requests without secrets:

```yaml
name: Validate Skill

on:
  pull_request:
    paths:
      - skills/my-skill/**
      - .github/workflows/validate-skill.yml

jobs:
  validate:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - name: Validate skill package
        uses: hashgraph-online/skill-publish@v1
        with:
          mode: validate
          skill-dir: skills/my-skill
          annotate: "false"
```

Publish immutable releases:

```yaml
name: Publish Skill
on:
  release:
    types: [published]

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v4
      - name: Publish skill package
        uses: hashgraph-online/skill-publish@v1
        with:
          mode: publish
          api-key: ${{ secrets.RB_API_KEY }}
          skill-dir: skills/my-skill
          annotate: "true"
          github-token: ${{ github.token }}
```

Expected success signal:
- workflow output includes `published=true`
- output includes `skill-json-hrl` (`hcs://...`) for your immutable release reference

## Minimal Skill Package

```
skills/my-skill/
├── SKILL.md
└── skill.json
```

Example `skill.json`:

```json
{
  "name": "my-skill",
  "version": "0.1.0",
  "description": "Example skill package"
}
```

## Default Package Exclusions

These paths are never included in publish payloads:

- hidden paths such as `.env`, `.env.local`, `.gitignore`, `.github/`, `.vscode/`
- lockfiles such as `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lockb`
- build and dependency output such as `node_modules/`, `dist/`, `build/`, `.next/`, `coverage/`
- local state and sensitive material such as `*.db`, `*.sqlite`, `*.pem`, `*.key`, `*.p12`, `*.pfx`

If you need to ship a supporting artifact, keep it in a normal visible path inside the skill directory.

## Golden Workflow Templates

Use these copy-ready templates:

- Release-driven publish: `examples/workflows/publish-on-release.yml`
- Manual publish (`workflow_dispatch`): `examples/workflows/publish-manual.yml`
- Monorepo path-filtered publish: `examples/workflows/publish-monorepo-paths.yml`

## Why This Matters (Trustless Skills)

Most “skills” get shared as copy/paste blobs or mutable links. That works until you need version pinning, audits, or reproducibility.

In this context, a “trustless skill release” means:

- you publish an exact `name@version`
- consumers can later re-fetch the same published artifact by its canonical reference
- you can compare versions over time without relying on a private server or a package registry
- the published payload can be traced back to a repo + commit (default behavior)

This action exists to make that publish step deterministic and automated in CI.

## What You Provide vs What Runs in CI

| You provide | Action handles |
| --- | --- |
| `skill-dir` with `SKILL.md` and `skill.json` | file discovery, MIME detection, size checks |
| `RB_API_KEY` secret | authenticated API calls |
| optional overrides (`name`, `version`) | payload shaping and metadata stamping |
| optional annotation settings | release/PR annotation behavior |
| workflow trigger | quote/publish/job polling orchestration |

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `mode` | No | `publish` | Execution mode: `validate`, `quote`, or `publish`. |
| `api-key` | Validate: No, Quote/Publish: Yes | - | Registry Broker API key. Publish still consumes credits and requires funded broker auth. |
| `skill-dir` | Yes | - | Path containing `SKILL.md` and `skill.json`. |
| `api-base-url` | No | `https://hol.org/registry/api/v1` | Broker base URL (`.../registry` or `.../registry/api/v1`). |
| `account-id` | No | - | Optional Hedera account ID for publish authorization edge cases. |
| `name` | No | - | Optional skill name override for `skill.json`. |
| `version` | No | - | Optional version override for `skill.json`. Non-stable overrides are blocked on production by default. |
| `allow-nonstable-production-version` | No | `false` | Explicitly permits publishing a non-stable custom version to the production registry. |
| `stamp-repo-commit` | No | `true` | Stamp `repo` and `commit` metadata into payload. |
| `poll-timeout-ms` | No | `720000` | Max time to wait for publish job completion. |
| `poll-interval-ms` | No | `4000` | Interval between publish job status polls. |
| `annotate` | No | `true` | Post publish result to release notes or merged PR comments. |
| `preview-upload` | No | `true` | When `mode=validate`, upload preview state through GitHub OIDC when available. |
| `submit-indexnow` | No | `false` | Submit canonical HOL skill URLs to IndexNow after publish or skip-existing. |
| `github-token` | No | - | Token used only when `annotate=true`. |

## Outputs

| Output | Description |
| --- | --- |
| `published` | `true` when publish executed, `false` when skipped. |
| `skip-reason` | Skip reason (currently `version-exists`). |
| `skill-name` | Skill name from publish result. |
| `skill-version` | Skill version from publish result. |
| `preview-json` | Validate-mode `skill-preview.v1` payload. |
| `preview-json-path` | Path to the generated preview JSON file. |
| `status-url` | Preview or published lifecycle URL, depending on mode. |
| `quote-id` | Broker quote identifier. |
| `job-id` | Publish job identifier. |
| `directory-topic-id` | Skill directory topic ID. |
| `package-topic-id` | Skill package topic ID. |
| `skill-json-hrl` | Canonical `hcs://...` reference for `skill.json`. |
| `credits` | Credits consumed. |
| `estimated-cost-hbar` | Estimated HBAR cost from quote. |
| `skill-page-url` | Canonical skill detail page URL for the resolved `name@version`. |
| `entity-url` | Machine-readable `entity.json` URL for the canonical skill page. |
| `docs-url` | Canonical HOL docs URL for the registry. |
| `openapi-url` | Canonical OpenAPI URL for the registry API. |
| `install-url-pinned-skill-md` | Pinned `SKILL.md` resolver URL. |
| `install-url-latest-skill-md` | Latest `SKILL.md` resolver URL. |
| `install-url-pinned-manifest` | Pinned `manifest` resolver URL. |
| `install-url-latest-manifest` | Latest `manifest` resolver URL. |
| `install-metadata-pinned-url` | Pinned install metadata URL. |
| `install-metadata-latest-url` | Latest install metadata URL. |
| `badge-markdown` | Markdown badge snippet for the resolved version. |
| `badge-html` | HTML badge snippet for the resolved version. |
| `markdown-link` | Markdown link snippet for the canonical skill page. |
| `html-link` | HTML link snippet for the canonical skill page. |
| `readme-snippet` | README snippet with canonical install links. |
| `docs-snippet` | Docs snippet with canonical HOL links. |
| `citation-snippet` | Citation snippet pointing to canonical HOL metadata. |
| `release-notes` | Release notes snippet with install links and badge markdown. |
| `package-metadata-json` | JSON block for package metadata pointing at HOL canonical URLs. |
| `codemeta-json` | CodeMeta document for the resolved skill version. |
| `attested-kit-json` | Full attested distribution kit payload. |
| `next-actions` | Post-publish checklist with the best distribution next steps. |
| `annotation-target` | Annotation destination (`release:<id>`, `pr:<id>`, `none`, `failed`). |
| `indexnow-result` | IndexNow submission result when enabled. |
| `result-json` | Full result payload as JSON string. |

Useful references after publish:
- `directory-topic-id`: where the skill record lives
- `package-topic-id`: package/version topic reference
- `skill-json-hrl`: canonical reference you can paste into docs, release notes, or tooling
- `skill-page-url`, install URL outputs, and snippets: ready-to-share distribution kit output for READMEs and release notes

An HRL looks like: `hcs://1/0.0.12345`

## Example: Gate Follow-up Jobs on Publish State

```yaml
- name: Publish skill
  id: publish_skill
  uses: hashgraph-online/skill-publish@v1
  with:
    api-key: ${{ secrets.RB_API_KEY }}
    skill-dir: skills/my-skill

- name: Notify only when new version published
  if: steps.publish_skill.outputs.published == 'true'
  run: |
    echo "Published ${{
      steps.publish_skill.outputs.skill-name
    }}@${{
      steps.publish_skill.outputs.skill-version
    }}"
```

## Runtime Behavior

`mode=validate`
1. Discovers and validates package files in `skill-dir`.
2. Resolves broker limits from `/skills/config`.
3. Emits `skill-preview.v1` JSON plus lifecycle/share outputs.
4. Optionally uploads preview state through GitHub OIDC.

`mode=quote`
1. Discovers and validates package files in `skill-dir`.
2. Resolves broker limits from `/skills/config`.
3. Checks if `name@version` already exists.
4. Requests quote via `POST /skills/quote`.
5. Emits quote metadata without publishing.

`mode=publish`
1. Discovers and validates package files in `skill-dir`.
2. Resolves broker limits from `/skills/config`.
3. Checks if `name@version` already exists.
4. Requests quote via `POST /skills/quote`.
5. Publishes via `POST /skills/publish`.
6. Polls `GET /skills/jobs/{jobId}` until completion.
7. Emits outputs, step summary, and optional GitHub annotations.

## Idempotency and Failure Behavior

- If `name@version` already exists, the action exits cleanly with `published=false` and `skip-reason=version-exists`.
- Publish failures return structured output in `result-json` so CI can gate follow-up jobs.
- Annotation failures do not hide publish status; `annotation-target` reports where comments were attempted.
- Validate mode never quotes or publishes, and it does not require `RB_API_KEY`.

## Trust and Security Defaults

- Validate workflows should grant `contents: read` and `id-token: write`.
- Publish workflows that annotate releases or PRs typically also need `contents: write`, `pull-requests: write`, and `issues: write`.
- Store `RB_API_KEY` in repository or organization secrets.
- If you do not need GitHub annotations, set `annotate: "false"` and omit `github-token`.
- For strict supply-chain pinning, pin to a full commit SHA instead of `@v1`:

```yaml
uses: hashgraph-online/skill-publish@93aee116a8a4b8d90dcde8cfb64628bc255becde
```

- When annotations are disabled, this tighter permission set is sufficient:

```yaml
permissions:
  contents: read
```

## Troubleshooting Matrix

| Symptom | Likely Cause | Fix |
| --- | --- | --- |
| `skip-reason=version-exists` | Same `name@version` already published | Bump `version` in `skill.json` and re-run. |
| Quote request fails | Missing credits or invalid package metadata | Top up credits, then validate `skill.json` fields and size limits. |
| Publish job times out | Broker load or long queue | Increase `poll-timeout-ms` (for example, `1200000`) and re-run. |
| `published=true` but no PR/release annotation | Missing write scopes or missing `github-token` | Add `pull-requests: write`, `issues: write`, `contents: write`, and pass `github-token`. |
| Missing file validation error | `SKILL.md` or `skill.json` not found under `skill-dir` | Verify folder structure and `skill-dir` path in workflow. |
| API authentication error | Wrong or revoked API key | Regenerate key at `/registry/docs?tab=api-keys` and update `RB_API_KEY` secret. |

## How Verification Works (HCS-26)

You do not need the full standard to use this action, but the storage and lookup rules follow HCS-26.

- the Registry Broker is the publish API surface
- the publish result includes topic IDs and `hcs://...` HRLs that can be resolved independently

Full standard:
- https://github.com/hashgraph-online/hiero-consensus-specifications/blob/main/docs/standards/hcs-26.md

## Canonical References

- npm package: https://www.npmjs.com/package/skill-publish
- Marketplace listing: https://github.com/marketplace/actions/skill-publish
- Registry landing page: https://hol.org/registry
- Skill index: https://hol.org/registry/skills
- Product docs: https://hol.org/docs/registry-broker/
- Interactive API docs: https://hol.org/registry/docs
- OpenAPI: https://hol.org/registry/api/v1/openapi.json
- Skill schema: https://raw.githubusercontent.com/hashgraph-online/skill-publish/main/schemas/skill.schema.json

## Citation

If you reference this action in documentation or research, use [`CITATION.cff`](./CITATION.cff).
