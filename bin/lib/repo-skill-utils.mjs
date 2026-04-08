import { constants } from 'node:fs';
import { access, readdir } from 'node:fs/promises';
import path from 'node:path';

export const PINNED_CHECKOUT_ACTION_REF =
  'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683';
export const PINNED_SKILL_PUBLISH_ACTION_REF =
  'hashgraph-online/skill-publish@9742f4cab7ca48683d39dcd16f92ec7dfe565df7';

const REQUIRED_SKILL_FILES = ['SKILL.md'];
const OPTIONAL_SKILL_FILES = ['skill.json', 'apis.json', 'llms.txt'];
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.github',
  '.idea',
  '.next',
  '.turbo',
  '.vscode',
  '__fixtures__',
  '__tests__',
  'build',
  'coverage',
  'dist',
  'example',
  'examples',
  'fixture',
  'fixtures',
  'node_modules',
  'out',
  'spec',
  'specs',
  'target',
  'temp',
  'test',
  'tests',
  'tmp',
]);

function isIgnoredDirectory(name) {
  return IGNORED_DIRECTORIES.has(name) || name.startsWith('test-runtime-');
}

export function toPosix(relativePath) {
  return relativePath.split(path.sep).join(path.posix.sep);
}

export async function pathExists(targetPath) {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(targetPath) {
  try {
    const entries = await readdir(targetPath);
    return Array.isArray(entries);
  } catch {
    return false;
  }
}

export function normalizeSkillDir(value) {
  const trimmed = toPosix(String(value ?? '').trim());
  if (!trimmed) {
    throw new Error('Skill directory cannot be empty.');
  }
  if (trimmed.startsWith('/')) {
    throw new Error('Skill directory must be relative.');
  }
  if (trimmed.includes('..')) {
    throw new Error('Skill directory cannot contain parent path segments.');
  }
  if (!/^[A-Za-z0-9._/-]+$/u.test(trimmed)) {
    throw new Error('Skill directory contains invalid characters.');
  }
  return trimmed;
}

function normalizeDirectoryLabel(relativeDir) {
  return relativeDir ? toPosix(relativeDir) : '.';
}

function ensureMetadataRecord(records, relativeDir) {
  const key = normalizeDirectoryLabel(relativeDir);
  const existing = records.get(key);
  if (existing) {
    return existing;
  }
  const created = new Set();
  records.set(key, created);
  return created;
}

async function collectSkillMetadata(repoDir, relativeDir = '', records = new Map()) {
  const absoluteDir = relativeDir ? path.join(repoDir, relativeDir) : repoDir;
  const entries = await readdir(absoluteDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (isIgnoredDirectory(entry.name)) {
        continue;
      }
      const childRelative = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
      await collectSkillMetadata(repoDir, childRelative, records);
      continue;
    }

    if (![...REQUIRED_SKILL_FILES, 'skill.json'].includes(entry.name)) {
      continue;
    }

    ensureMetadataRecord(records, relativeDir).add(entry.name);
  }

  return records;
}

export async function inspectSkillRepo(repoDir) {
  const records = await collectSkillMetadata(repoDir);
  const packages = [];
  const partials = [];

  for (const [dir, files] of records.entries()) {
    const present = Array.from(files).sort();
    const missing = REQUIRED_SKILL_FILES.filter((name) => !files.has(name));
    if (missing.length === 0) {
      packages.push({ dir, present });
      continue;
    }
    partials.push({ dir, present, missing });
  }

  packages.sort((left, right) => left.dir.localeCompare(right.dir));
  partials.sort((left, right) => left.dir.localeCompare(right.dir));

  const issues = [];
  if (packages.length === 0) {
    issues.push('No HOL skill package found. A valid package needs SKILL.md in the same directory.');
  }
  if (packages.length > 1) {
    issues.push('Multiple HOL skill packages found. Choose one explicitly with --skill-dir.');
  }
  if (partials.length > 0) {
    issues.push('Partial skill-like directories exist but are missing required HOL package files.');
  }

  const recommendedSkillDir = packages.length === 1 ? packages[0].dir : '';
  return {
    repoDir,
    packages,
    partials,
    recommendedSkillDir,
    readyForSetupAction: packages.length === 1,
    issues,
    nextAction:
      packages.length === 0
        ? 'scaffold-repo'
        : packages.length === 1
          ? 'setup-action'
          : 'choose-skill-dir',
  };
}

function buildSkillPathFilters(skillDir) {
  if (skillDir === '.') {
    return [
      'SKILL.md',
      'skill.json',
      ...OPTIONAL_SKILL_FILES,
      'references/**',
      'schemas/**',
    ];
  }

  return [
    `${skillDir}/SKILL.md`,
    `${skillDir}/skill.json`,
    ...OPTIONAL_SKILL_FILES.map((fileName) => `${skillDir}/${fileName}`),
    `${skillDir}/references/**`,
    `${skillDir}/schemas/**`,
  ];
}

function buildPrepareSkillPackageStep(skillDir) {
  const sourceDirLiteral = JSON.stringify(skillDir === '.' ? '.' : skillDir);
  return `      - name: Prepare skill package
        id: package
        shell: bash
        run: |
          SOURCE_DIR=${sourceDirLiteral}
          PACKAGE_DIR="publish-package-\${GITHUB_RUN_ID}-\${GITHUB_RUN_ATTEMPT}"
          mkdir -p "\${PACKAGE_DIR}/references" "\${PACKAGE_DIR}/schemas"
          cp "\${SOURCE_DIR}/SKILL.md" "\${PACKAGE_DIR}/"
          if [[ -f "\${SOURCE_DIR}/skill.json" ]]; then
            cp "\${SOURCE_DIR}/skill.json" "\${PACKAGE_DIR}/"
          fi
          if [[ -f "\${SOURCE_DIR}/apis.json" ]]; then
            cp "\${SOURCE_DIR}/apis.json" "\${PACKAGE_DIR}/"
          fi
          if [[ -f "\${SOURCE_DIR}/llms.txt" ]]; then
            cp "\${SOURCE_DIR}/llms.txt" "\${PACKAGE_DIR}/"
          fi
          if [[ -d "\${SOURCE_DIR}/references" ]]; then
            cp -r "\${SOURCE_DIR}/references/." "\${PACKAGE_DIR}/references/"
          fi
          if [[ -d "\${SOURCE_DIR}/schemas" ]]; then
            cp -r "\${SOURCE_DIR}/schemas/." "\${PACKAGE_DIR}/schemas/"
          fi
          echo "dir=\${PACKAGE_DIR}" >> "\$GITHUB_OUTPUT"`;
}

function buildVersionResolutionStep(trigger, skillDir) {
  const skillJsonPath =
    skillDir === '.' ? './skill.json' : `./${toPosix(path.posix.join(skillDir, 'skill.json'))}`;
  const skillJsonFallback = `const fs = require('node:fs'); const filePath = '${skillJsonPath}'; if (!fs.existsSync(filePath)) { console.log('1.0.0'); process.exit(0); } const skillJson = require(filePath); console.log(skillJson.version || '1.0.0');`;
  const body =
    trigger === 'release'
      ? `          RELEASE_TAG="\${{ github.event.release.tag_name }}"
          if [[ -n "\${RELEASE_TAG}" ]]; then
            RESOLVED_VERSION="\${RELEASE_TAG#v}"
          else
            RESOLVED_VERSION="$(node -e "${skillJsonFallback}")"
          fi`
      : `          VERSION_INPUT="\${{ inputs.version }}"
          if [[ -n "\${VERSION_INPUT}" ]]; then
            RESOLVED_VERSION="\${VERSION_INPUT}"
          else
            RESOLVED_VERSION="$(node -e "${skillJsonFallback}")"
          fi`;

  return `      - name: Resolve publish version
        id: version
        shell: bash
        run: |
${body}
          echo "version=\${RESOLVED_VERSION}" >> "\$GITHUB_OUTPUT"`;
}

export function buildReleaseWorkflow(skillDir, annotate) {
  return `name: Publish Skill

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
      - uses: ${PINNED_CHECKOUT_ACTION_REF}
${buildPrepareSkillPackageStep(skillDir)}
${buildVersionResolutionStep('release', skillDir)}
      - name: Publish skill package
        uses: ${PINNED_SKILL_PUBLISH_ACTION_REF}
        with:
          mode: publish
          api-key: \${{ secrets.RB_API_KEY }}
          skill-dir: \${{ steps.package.outputs.dir }}
          version: \${{ steps.version.outputs.version }}
          annotate: "${annotate ? 'true' : 'false'}"
          submit-indexnow: "true"
          github-token: \${{ github.token }}
`;
}

export function buildManualWorkflow(skillDir, annotate) {
  return `name: Publish Skill (Manual)

on:
  workflow_dispatch:
    inputs:
      publish_target:
        type: choice
        required: true
        default: staging
        options:
          - staging
          - production
      version:
        type: string
        required: false

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
    steps:
      - uses: ${PINNED_CHECKOUT_ACTION_REF}
      - name: Resolve broker API URL
        id: target
        shell: bash
        run: |
          if [[ "\${{ inputs.publish_target }}" == "staging" ]]; then
            echo "api_base_url=https://registry-staging.hol.org/registry/api/v1" >> "\$GITHUB_OUTPUT"
          else
            echo "api_base_url=https://hol.org/registry/api/v1" >> "\$GITHUB_OUTPUT"
          fi
${buildPrepareSkillPackageStep(skillDir)}
${buildVersionResolutionStep('manual', skillDir)}
      - name: Publish skill package
        uses: ${PINNED_SKILL_PUBLISH_ACTION_REF}
        with:
          mode: publish
          api-base-url: \${{ steps.target.outputs.api_base_url }}
          api-key: \${{ secrets.RB_API_KEY }}
          skill-dir: \${{ steps.package.outputs.dir }}
          version: \${{ steps.version.outputs.version }}
          annotate: "${annotate ? 'true' : 'false'}"
          submit-indexnow: "true"
          github-token: \${{ github.token }}
`;
}

export function buildValidateWorkflow(skillDir, workflowPath) {
  const skillPaths = buildSkillPathFilters(skillDir)
    .map((pattern) => `      - '${pattern}'`)
    .join('\n');

  return `name: Validate Skill

on:
  pull_request:
    paths:
${skillPaths}
      - '${workflowPath}'

jobs:
  validate:
    concurrency:
      group: validate-skill-\${{ github.event.pull_request.number || github.ref }}
      cancel-in-progress: true
    runs-on: ubuntu-latest
    permissions:
      contents: read
      issues: write
      pull-requests: write
    steps:
      - uses: ${PINNED_CHECKOUT_ACTION_REF}
${buildPrepareSkillPackageStep(skillDir)}
      - name: Validate skill package
        uses: ${PINNED_SKILL_PUBLISH_ACTION_REF}
        with:
          mode: validate
          skill-dir: \${{ steps.package.outputs.dir }}
          repo-skill-dir: ${JSON.stringify(skillDir === '' ? '.' : skillDir)}
          annotate: "false"
          github-token: \${{ github.token }}
          comment-mode: "state-changes"
          comment-on-success: "true"
`;
}
