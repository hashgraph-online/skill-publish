# skill-publish

`skill-publish` is the GitHub Action for shipping **HCS-26 skill releases** to the Hashgraph Online Registry Broker with one workflow step.

If you are building skills and do not want to hand-roll publish orchestration, this action handles the release path:

- validate package against broker limits
- quote credits
- publish
- poll completion
- emit outputs for downstream jobs
- optionally annotate release/PR

[![GitHub Marketplace](https://img.shields.io/badge/GitHub_Marketplace-skill--publish-2EA44F?style=for-the-badge&logo=github)](https://github.com/marketplace/actions/skill-publish)
[![OpenAPI Spec](https://img.shields.io/badge/OpenAPI-3.1.0-6BA539?style=for-the-badge&logo=openapiinitiative&logoColor=white)](https://hol.org/registry/api/v1/openapi.json)
[![HOL Registry](https://img.shields.io/badge/HOL-Registry-5599FE?style=for-the-badge)](https://hol.org/registry)

## HCS-26 in 60 Seconds

You can use this action without being deep in the spec.

- A skill package includes `SKILL.md` and `skill.json`.
- HCS-26 stores package files and publishes registry records for discovery/versioning.
- The Registry Broker exposes this as API endpoints (`/skills/config`, `/skills/quote`, `/skills/publish`, `/skills/jobs/{id}`).
- This action is a thin automation layer over those endpoints.

If you want the full standard details, see:
- https://github.com/hashgraph-online/hiero-consensus-specifications/blob/main/docs/standards/hcs-26.md

## Developer Value

Without this action, every pipeline typically needs custom scripts for:

1. package validation and size checks
2. idempotency checks (`name@version` exists?)
3. quote request + publish request + job polling
4. wiring output data to later workflow steps

With this action, that logic is in one step and one versioned dependency.

## You Provide vs Action Handles

| You provide | Action handles |
| --- | --- |
| `skill-dir` with `SKILL.md` and `skill.json` | file discovery, MIME detection, size checks |
| `RB_API_KEY` secret | authenticated API calls |
| optional overrides (`name`, `version`) | payload shaping and metadata stamping |
| optional annotation settings | release/PR annotation behavior |
| workflow trigger | quote/publish/job polling orchestration |

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

Useful for first-time HCS-26 users:
- `directory-topic-id`: where the skill record lives
- `package-topic-id`: package/version topic reference
- `skill-json-hrl`: direct HCS locator for `skill.json`

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
