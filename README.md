# skill-publish

`skill-publish` is a GitHub Action that publishes **trustless, immutable, on-chain** skill releases and returns canonical references you can pin, verify, and re-fetch later.

Instead of sharing mutable URLs or copy/paste blobs, each `name@version` release is recorded on Hedera (HCS) and exposed via `hcs://...` references. That immutability is the value: the published artifact is tamper-evident, reproducible, and audit-friendly.

Immutability gives you:

- **Version pinning:** consumers can depend on an exact `name@version`.
- **Reproducible retrieval:** the same canonical references resolve later (not “whatever is at this URL today”).
- **Audit trail:** topic IDs, job IDs, and optional repo+commit stamping connect releases back to source.

A skill package is `SKILL.md` + `skill.json` (plus optional files). The action validates, quotes, publishes, waits for completion, and emits outputs.

[![GitHub Marketplace](https://img.shields.io/badge/GitHub_Marketplace-skill--publish-2EA44F?style=for-the-badge&logo=github)](https://github.com/marketplace/actions/skill-publish)
[![OpenAPI Spec](https://img.shields.io/badge/OpenAPI-3.1.0-6BA539?style=for-the-badge&logo=openapiinitiative&logoColor=white)](https://hol.org/registry/api/v1/openapi.json)
[![HOL Registry](https://img.shields.io/badge/HOL-Registry-5599FE?style=for-the-badge)](https://hol.org/registry)

## Quick Start

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

## Prerequisites (API Key + Credits)

To publish from CI, you need:

1. An API key for authenticated broker requests.
2. Credits to pay for broker usage.

Fast path:

1. Generate an API key: https://hol.org/registry/docs?tab=api-keys
2. Add credits: https://hol.org/registry/docs?tab=credits
3. Save the key as a GitHub Actions secret (example name: `RB_API_KEY`)

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
| `api-key` | Yes | - | Registry Broker API key. |
| `skill-dir` | Yes | - | Path containing `SKILL.md` and `skill.json`. |
| `api-base-url` | No | `https://hol.org/registry/api/v1` | Broker base URL (`.../registry` or `.../registry/api/v1`). |
| `account-id` | No | - | Optional Hedera account ID for publish authorization edge cases. |
| `name` | No | - | Optional skill name override for `skill.json`. |
| `version` | No | - | Optional version override for `skill.json`. |
| `stamp-repo-commit` | No | `true` | Stamp `repo` and `commit` metadata into payload. |
| `poll-timeout-ms` | No | `720000` | Max time to wait for publish job completion. |
| `poll-interval-ms` | No | `4000` | Interval between publish job status polls. |
| `annotate` | No | `true` | Post publish result to release notes or merged PR comments. |
| `github-token` | No | - | Token used only when `annotate=true`. |

## Outputs

| Output | Description |
| --- | --- |
| `published` | `true` when publish executed, `false` when skipped. |
| `skip-reason` | Skip reason (currently `version-exists`). |
| `skill-name` | Skill name from publish result. |
| `skill-version` | Skill version from publish result. |
| `quote-id` | Broker quote identifier. |
| `job-id` | Publish job identifier. |
| `directory-topic-id` | Skill directory topic ID. |
| `package-topic-id` | Skill package topic ID. |
| `skill-json-hrl` | Canonical `hcs://...` reference for `skill.json`. |
| `credits` | Credits consumed. |
| `estimated-cost-hbar` | Estimated HBAR cost from quote. |
| `annotation-target` | Annotation destination (`release:<id>`, `pr:<id>`, `none`, `failed`). |
| `result-json` | Full result payload as JSON string. |

Useful references after publish:
- `directory-topic-id`: where the skill record lives
- `package-topic-id`: package/version topic reference
- `skill-json-hrl`: canonical reference you can paste into docs, release notes, or tooling

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

1. Discovers and validates package files in `skill-dir`.
2. Resolves broker limits from `/skills/config`.
3. Checks if `name@version` already exists.
4. Requests quote via `POST /skills/quote`.
5. Publishes via `POST /skills/publish`.
6. Polls `GET /skills/jobs/{jobId}` until completion.
7. Emits outputs, step summary, and optional GitHub annotations.

Idempotency behavior:
- if version already exists, action exits cleanly with:
  - `published=false`
  - `skip-reason=version-exists`

## Permissions and Security

- Recommended minimum permissions:
  - `contents: write` for release note updates
  - `pull-requests: write` and `issues: write` for PR annotation path
- Store `RB_API_KEY` in repository or organization secrets.
- If you do not need GitHub annotations, set `annotate: "false"` and omit `github-token`.
- For strict supply-chain pinning, you can pin to a full commit SHA instead of `@v1`.

## Troubleshooting

- **`version-exists` skip**: expected for re-runs of an already published version.
- **quote/publish failures**: inspect `result-json` and step summary first.
- **timeout**: increase `poll-timeout-ms` for high-load periods.
- **annotation failure**: publish can still succeed; see `annotation-target` and step logs.
- **missing files**: ensure `skill-dir` contains both `SKILL.md` and `skill.json`.

## How Verification Works (HCS-26)

You do not need the full standard to use this action, but the storage and lookup rules follow HCS-26.

- the Registry Broker is the publish API surface
- the publish result includes topic IDs and `hcs://...` HRLs that can be resolved independently

Full standard:
- https://github.com/hashgraph-online/hiero-consensus-specifications/blob/main/docs/standards/hcs-26.md

## Canonical References

- Marketplace listing: https://github.com/marketplace/actions/skill-publish
- Registry landing page: https://hol.org/registry
- Skill index: https://hol.org/registry/skills
- Product docs: https://hol.org/docs/registry-broker/
- Interactive API docs: https://hol.org/registry/docs
- OpenAPI: https://hol.org/registry/api/v1/openapi.json
- Skill schema: https://raw.githubusercontent.com/hashgraph-online/skill-publish/main/schemas/skill.schema.json

## Citation

If you reference this action in documentation or research, use [`CITATION.cff`](./CITATION.cff).
