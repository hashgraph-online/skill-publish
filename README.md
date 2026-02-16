# skills-publish

GitHub Action to validate, quote, publish, and poll HCS-26 skill releases through Registry Broker.

## Usage

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
      - uses: hashgraph-online/skills-publish@v1
        with:
          api-base-url: ${{ secrets.RB_BASE_URL }}
          api-key: ${{ secrets.RB_API_KEY }}
          account-id: ${{ secrets.RB_ACCOUNT_ID }}
          skill-dir: skills/registry-broker
          annotate: "true"
          github-token: ${{ github.token }}
```

## Inputs

- `api-base-url`: Registry Broker base URL (`.../registry` or `.../registry/api/v1`, optional)
- `api-key`: Registry Broker API key (required)
- `account-id`: Hedera account ID (optional; usually not needed for user API keys)
- `skill-dir`: Folder containing `SKILL.md` and `skill.json` (required)
- `name`: Optional name override
- `version`: Optional version override
- `stamp-repo-commit`: default `true`
- `poll-timeout-ms`: default `720000`
- `poll-interval-ms`: default `4000`
- `annotate`: default `true`
- `github-token`: token for release/PR annotation

## Outputs

- `skill-name`
- `skill-version`
- `quote-id`
- `job-id`
- `directory-topic-id`
- `package-topic-id`
- `skill-json-hrl`
- `result-json`
- `annotation-target`

## Behavior

The action:

1. Validates package files and `/skills/config` constraints.
2. Calls `POST /skills/quote`.
3. Calls `POST /skills/publish`.
4. Polls `GET /skills/jobs/{jobId}` until completion.
5. Stamps `repo` + `commit` metadata in `skill.json` payload by default.
6. Appends publish result details to release notes (release events) or merged PR comments (push to `main`) when annotation is enabled.
