# skill-publish

`skill-publish` is the GitHub Action for shipping **HCS-26 skill releases** to the Hashgraph Online Registry Broker with one workflow step.

It is optimized for real release pipelines:

- idempotent by `name@version` (safe re-runs)
- validates package limits against live broker config
- quotes credits before publish
- publishes and polls completion automatically
- emits machine-readable outputs for downstream jobs
- annotates releases/PRs with publish results

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
      - name: Publish to HCS-26 registry
        uses: hashgraph-online/skill-publish@v1
        with:
          api-key: ${{ secrets.RB_API_KEY }}
          skill-dir: skills/my-skill
          annotate: "true"
          github-token: ${{ github.token }}
```

## Why Teams Use This Action

- **Release-safe idempotency**: if the exact version already exists, the run exits cleanly with `published=false`.
- **Governed packaging**: validates file count, byte limits, and MIME policy from `/skills/config` before publish.
- **Traceability by default**: stamps `repo` and `commit` into publish payload metadata.
- **CI/CD-ready outputs**: exposes topic IDs, job IDs, and serialized result JSON for later workflow steps.
- **Operator visibility**: writes a Markdown publish report to step summary and GitHub annotation targets.

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
| `skill-json-hrl` | HCS-1 HRL for `skill.json`. |
| `credits` | Credits consumed. |
| `estimated-cost-hbar` | Estimated HBAR cost from quote. |
| `annotation-target` | Annotation destination (`release:<id>`, `pr:<id>`, `none`, `failed`). |
| `result-json` | Full result payload as JSON string. |

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
3. Checks if `name@version` already exists (skip-safe).
4. Requests quote via `POST /skills/quote`.
5. Publishes via `POST /skills/publish`.
6. Polls `GET /skills/jobs/{jobId}` until completion.
7. Emits outputs, step summary, and optional GitHub annotations.

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
