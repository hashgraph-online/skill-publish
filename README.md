# skill-publish

GitHub Action to validate, quote, publish, and poll HCS-26 skill releases through Registry Broker.

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.18748325.svg?style=for-the-badge)](https://doi.org/10.5281/zenodo.18748325)
[![HOL Registry](https://img.shields.io/badge/HOL-Registry-5599FE?style=for-the-badge)](https://hol.org/registry)
[![Registry Skills](https://img.shields.io/badge/HOL-Skills-5599FE?style=for-the-badge)](https://hol.org/registry/skills)

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
      - uses: hashgraph-online/skill-publish@v1
        with:
          api-key: ${{ secrets.RB_API_KEY }}
          skill-dir: skills/registry-broker
          annotate: "true"
          github-token: ${{ github.token }}
```

## Required secret

- `RB_API_KEY`: Registry Broker API key for the publishing account.

## Optional inputs

- `version`: Optional version override.
- `name`: Optional name override.
- `stamp-repo-commit`: default `true`.
- `poll-timeout-ms`: default `720000`.
- `poll-interval-ms`: default `4000`.
- `annotate`: default `true`.
- `github-token`: token for release/PR annotation.
- `api-base-url`: optional, defaults to `https://hol.org/registry/api/v1`.
- `account-id`: optional override for edge cases.

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
