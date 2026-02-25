# skill-publish

`skill-publish` is a GitHub Action for **agent skills registry publishing**.  
It validates an HCS-26 skill package, requests a quote, publishes the release, and polls job completion against the Hashgraph Online Registry Broker API.

[![Run in Postman](https://img.shields.io/badge/Run_in-Postman-FF6C37?style=for-the-badge&logo=postman&logoColor=white)](https://app.getpostman.com/run-collection/51598040-f1ef77fd-ae05-4edb-8663-efa52b0d1e99?action=collection%2Ffork&source=rip_markdown&collection-url=entityId%3D51598040-f1ef77fd-ae05-4edb-8663-efa52b0d1e99%26entityType%3Dcollection%26workspaceId%3Dfb06c3a9-4aab-4418-8435-cf73197beb57)
[![OpenAPI Spec](https://img.shields.io/badge/OpenAPI-3.1.0-6BA539?style=for-the-badge&logo=openapiinitiative&logoColor=white)](https://hol.org/registry/api/v1/openapi.json)

Canonical docs and API surfaces:
- Registry landing page: https://hol.org/registry
- Skill index: https://hol.org/registry/skills
- Skill manifest schema: https://raw.githubusercontent.com/hashgraph-online/skill-publish/main/schemas/skill.schema.json
- Product docs: https://hol.org/docs/registry-broker/
- Interactive API docs: https://hol.org/registry/docs
- OpenAPI schema: https://hol.org/registry/api/v1/openapi.json
- Live stats endpoint: https://hol.org/registry/api/v1/dashboard/stats
- APIs.json metadata: https://hol.org/registry/apis.json
- Repository APIs.json: https://raw.githubusercontent.com/hashgraph-online/skill-publish/main/apis.json
- Repository LLM index: https://raw.githubusercontent.com/hashgraph-online/skill-publish/main/llms.txt

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

## Share / Embed

```md
[![Publish Skills with skill-publish](https://img.shields.io/badge/Publish-skill--publish-7C3AED?style=for-the-badge)](https://github.com/hashgraph-online/skill-publish)
```

## DOI Readiness

- Zenodo metadata: [`.zenodo.json`](./.zenodo.json)
- Citation metadata: [`CITATION.cff`](./CITATION.cff)
- Schema validation workflow: [`.github/workflows/schema-validate.yml`](./.github/workflows/schema-validate.yml)
- Release workflow: [`.github/workflows/release.yml`](./.github/workflows/release.yml)

## Required secret

- `RB_API_KEY`: Registry Broker API key for the publishing account.

## Optional inputs

- `version`: optional version override.
- `name`: optional skill name override.
- `stamp-repo-commit`: default `true`.
- `poll-timeout-ms`: default `720000`.
- `poll-interval-ms`: default `4000`.
- `annotate`: default `true`.
- `github-token`: token for release and PR annotation.
- `api-base-url`: defaults to `https://hol.org/registry/api/v1`.
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
2. Checks whether the exact `name@version` already exists and skips publish when it does.
3. Calls `POST /skills/quote` when publish is needed.
4. Calls `POST /skills/publish`.
5. Polls `GET /skills/jobs/{jobId}` until completion.
6. Stamps `repo` and `commit` metadata in `skill.json` payload by default.
7. Appends publish result details to release notes (release events) or merged PR comments (push to `main`) when annotation is enabled.

## Cite this repository

If you reference this project in docs or research, use [`CITATION.cff`](./CITATION.cff).
