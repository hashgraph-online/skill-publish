import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const cliPath = path.join(repoRoot, 'bin', 'cli.mjs');

function runCli(args, cwd) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

const runtimeRoot = await mkdtemp(path.join(repoRoot, 'test-runtime-'));
const existingRepoDir = path.join(runtimeRoot, 'existing-skill-repo');
const markdownOnlyRepoDir = path.join(runtimeRoot, 'markdown-only-skill-repo');
const invalidRepoDir = path.join(runtimeRoot, 'invalid-skill-repo');
const ambiguousRepoDir = path.join(runtimeRoot, 'ambiguous-skill-repo');
const fixtureOnlyRepoDir = path.join(runtimeRoot, 'fixture-only-repo');
const scaffoldRepoDir = path.join(runtimeRoot, 'scaffolded-skill-repo');

try {
  await mkdir(path.join(existingRepoDir, 'skills', 'weather-skill'), {
    recursive: true,
  });
  await writeFile(
    path.join(existingRepoDir, 'skills', 'weather-skill', 'SKILL.md'),
    '# Weather Skill\n',
    'utf8',
  );
  await writeFile(
    path.join(existingRepoDir, 'skills', 'weather-skill', 'skill.json'),
    `${JSON.stringify(
      {
        name: 'weather-skill',
        version: '1.0.0',
        description: 'Weather lookup skill',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  await mkdir(path.join(markdownOnlyRepoDir, 'skills', 'docs-skill'), {
    recursive: true,
  });
  await writeFile(
    path.join(markdownOnlyRepoDir, 'skills', 'docs-skill', 'SKILL.md'),
    '# Docs Skill\n\nUse this skill to answer docs questions.\n',
    'utf8',
  );
  await mkdir(path.join(invalidRepoDir, 'skills', 'broken-skill'), {
    recursive: true,
  });
  await writeFile(
    path.join(invalidRepoDir, 'skills', 'broken-skill', 'skill.json'),
    `${JSON.stringify(
      {
        name: 'broken-skill',
        version: '1.0.0',
        description: 'Broken skill',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  await mkdir(path.join(ambiguousRepoDir, 'skills', 'alpha-skill'), {
    recursive: true,
  });
  await mkdir(path.join(ambiguousRepoDir, 'skills', 'beta-skill'), {
    recursive: true,
  });
  await writeFile(
    path.join(ambiguousRepoDir, 'skills', 'alpha-skill', 'SKILL.md'),
    '# Alpha Skill\n',
    'utf8',
  );
  await writeFile(
    path.join(ambiguousRepoDir, 'skills', 'alpha-skill', 'skill.json'),
    `${JSON.stringify(
      {
        name: 'alpha-skill',
        version: '1.0.0',
        description: 'Alpha skill',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  await writeFile(
    path.join(ambiguousRepoDir, 'skills', 'beta-skill', 'SKILL.md'),
    '# Beta Skill\n',
    'utf8',
  );
  await writeFile(
    path.join(ambiguousRepoDir, 'skills', 'beta-skill', 'skill.json'),
    `${JSON.stringify(
      {
        name: 'beta-skill',
        version: '1.0.0',
        description: 'Beta skill',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  await mkdir(path.join(fixtureOnlyRepoDir, 'test', 'fixtures', 'weather-skill'), {
    recursive: true,
  });
  await writeFile(
    path.join(fixtureOnlyRepoDir, 'test', 'fixtures', 'weather-skill', 'SKILL.md'),
    '# Fixture Skill\n',
    'utf8',
  );
  await writeFile(
    path.join(fixtureOnlyRepoDir, 'test', 'fixtures', 'weather-skill', 'skill.json'),
    `${JSON.stringify(
      {
        name: 'fixture-skill',
        version: '1.0.0',
        description: 'Fixture only skill',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const inspectExistingResult = runCli(['inspect-repo', existingRepoDir, '--json'], repoRoot);
  assert.equal(inspectExistingResult.status, 0, inspectExistingResult.stderr);
  const inspectExisting = JSON.parse(inspectExistingResult.stdout);
  assert.equal(inspectExisting.readyForSetupAction, true);
  assert.deepEqual(
    inspectExisting.packages.map((entry) => entry.dir),
    ['skills/weather-skill'],
  );
  assert.equal(inspectExisting.recommendedSkillDir, 'skills/weather-skill');

  const inspectMarkdownOnlyResult = runCli(
    ['inspect-repo', markdownOnlyRepoDir, '--json'],
    repoRoot,
  );
  assert.equal(inspectMarkdownOnlyResult.status, 0, inspectMarkdownOnlyResult.stderr);
  const inspectMarkdownOnly = JSON.parse(inspectMarkdownOnlyResult.stdout);
  assert.equal(inspectMarkdownOnly.readyForSetupAction, true);
  assert.deepEqual(
    inspectMarkdownOnly.packages.map((entry) => entry.dir),
    ['skills/docs-skill'],
  );
  assert.equal(inspectMarkdownOnly.recommendedSkillDir, 'skills/docs-skill');

  const inspectInvalidResult = runCli(['inspect-repo', invalidRepoDir, '--json'], repoRoot);
  assert.equal(inspectInvalidResult.status, 0, inspectInvalidResult.stderr);
  const inspectInvalid = JSON.parse(inspectInvalidResult.stdout);
  assert.equal(inspectInvalid.readyForSetupAction, false);
  assert.deepEqual(inspectInvalid.packages, []);
  assert.deepEqual(
    inspectInvalid.partials.map((entry) => ({
      dir: entry.dir,
      missing: entry.missing,
    })),
    [{ dir: 'skills/broken-skill', missing: ['SKILL.md'] }],
  );

  const inspectFixtureOnlyResult = runCli(
    ['inspect-repo', fixtureOnlyRepoDir, '--json'],
    repoRoot,
  );
  assert.equal(inspectFixtureOnlyResult.status, 0, inspectFixtureOnlyResult.stderr);
  const inspectFixtureOnly = JSON.parse(inspectFixtureOnlyResult.stdout);
  assert.deepEqual(inspectFixtureOnly.packages, []);
  assert.equal(inspectFixtureOnly.readyForSetupAction, false);

  const invalidSetupActionResult = runCli(
    ['setup-action', invalidRepoDir, '--with-validate'],
    repoRoot,
  );
  assert.notEqual(invalidSetupActionResult.status, 0);
  assert.equal(
    invalidSetupActionResult.stderr.includes('No valid HOL skill package found.'),
    true,
    invalidSetupActionResult.stderr,
  );

  const ambiguousSetupActionResult = runCli(
    ['setup-action', ambiguousRepoDir, '--with-validate'],
    repoRoot,
  );
  assert.notEqual(ambiguousSetupActionResult.status, 0);
  assert.equal(
    ambiguousSetupActionResult.stderr.includes('Multiple skill packages detected'),
    true,
    ambiguousSetupActionResult.stderr,
  );

  const setupActionResult = runCli(
    ['setup-action', existingRepoDir, '--with-validate'],
    repoRoot,
  );
  assert.equal(setupActionResult.status, 0, setupActionResult.stderr);

  const markdownOnlySetupActionResult = runCli(
    ['setup-action', markdownOnlyRepoDir, '--with-validate'],
    repoRoot,
  );
  assert.equal(
    markdownOnlySetupActionResult.status,
    0,
    markdownOnlySetupActionResult.stderr,
  );

  const markdownOnlyValidateWorkflow = await readFile(
    path.join(markdownOnlyRepoDir, '.github', 'workflows', 'validate-skill.yml'),
    'utf8',
  );
  assert.equal(
    markdownOnlyValidateWorkflow.includes('skill-dir: ${{ steps.package.outputs.dir }}'),
    true,
    'Markdown-only skill repos must still generate a validate workflow that stages the package.',
  );
  assert.equal(
    markdownOnlyValidateWorkflow.includes('repo-skill-dir:'),
    true,
    'Markdown-only skill repos must pass canonical repo-skill-dir for status lookups.',
  );

  const validateWorkflow = await readFile(
    path.join(existingRepoDir, '.github', 'workflows', 'validate-skill.yml'),
    'utf8',
  );
  assert.equal(
    validateWorkflow.includes('id-token: write'),
    false,
    'Validate workflow must stay fork-safe by default and avoid OIDC on pull_request.',
  );
  assert.equal(
    validateWorkflow.includes('mode: validate'),
    true,
    'Validate workflow must call skill-publish in validate mode.',
  );
  assert.equal(
    validateWorkflow.includes('issues: write'),
    true,
    'Validate workflow must permit managed PR comment updates.',
  );
  assert.equal(
    validateWorkflow.includes('pull-requests: write'),
    true,
    'Validate workflow must permit managed PR comment updates.',
  );
  assert.equal(
    validateWorkflow.includes('Prepare skill package'),
    true,
    'Validate workflow must stage a canonical package before validation.',
  );
  assert.equal(
    validateWorkflow.includes('github-token: ${{ github.token }}'),
    true,
    'Validate workflow must pass the GitHub token through so the action can update a single managed PR comment.',
  );
  assert.equal(
    validateWorkflow.includes('comment-mode: "state-changes"'),
    true,
    'Validate workflow must publish scorecard comments in low-noise state-change mode.',
  );
  assert.equal(
    validateWorkflow.includes('repo-skill-dir:'),
    true,
    'Validate workflow must pass canonical repo-skill-dir when staging package folders.',
  );
  assert.equal(
    validateWorkflow.includes(
      'hashgraph-online/skill-publish@9742f4cab7ca48683d39dcd16f92ec7dfe565df7',
    ),
    true,
    'Validate workflow must pin the skill-publish action to an immutable commit SHA.',
  );
  assert.equal(
    validateWorkflow.includes('api-key:'),
    false,
    'Validate workflow must remain secretless.',
  );
  assert.equal(
    validateWorkflow.includes('.hol/skill-publish.yml'),
    false,
    'Validate workflow must not watch stale .hol/skill-publish.yml paths.',
  );

  const scaffoldResult = runCli(
    ['scaffold-repo', scaffoldRepoDir, '--name', 'catalog-skill'],
    repoRoot,
  );
  assert.equal(scaffoldResult.status, 0, scaffoldResult.stderr);

  const scaffoldedValidateWorkflow = await readFile(
    path.join(scaffoldRepoDir, '.github', 'workflows', 'validate-skill.yml'),
    'utf8',
  );
  const scaffoldedReadme = await readFile(
    path.join(scaffoldRepoDir, 'README.md'),
    'utf8',
  );
  const releaseWorkflow = await readFile(
    path.join(repoRoot, '.github', 'workflows', 'release.yml'),
    'utf8',
  );
  assert.equal(
    scaffoldedValidateWorkflow.includes('id-token: write'),
    false,
    'Scaffolded validate workflow must stay fork-safe by default.',
  );
  assert.equal(
    scaffoldedValidateWorkflow.includes('github-token: ${{ github.token }}'),
    true,
    'Scaffolded validate workflow must pass the GitHub token through for managed PR comments.',
  );
  assert.equal(
    scaffoldedValidateWorkflow.includes('comment-mode: "state-changes"'),
    true,
    'Scaffolded validate workflow must enable low-noise scorecard comment updates.',
  );
  assert.equal(
    scaffoldedValidateWorkflow.includes('repo-skill-dir:'),
    true,
    'Scaffolded validate workflow must pass canonical repo-skill-dir when staging package folders.',
  );
  assert.equal(
    scaffoldedValidateWorkflow.includes('Prepare skill package'),
    true,
    'Scaffolded validate workflow must stage a canonical package before validation.',
  );
  assert.equal(
    scaffoldedValidateWorkflow.includes(
      'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683',
    ),
    true,
    'Scaffolded validate workflow must pin checkout to an immutable commit SHA.',
  );
  assert.equal(
    scaffoldedValidateWorkflow.includes(
      'hashgraph-online/skill-publish@9742f4cab7ca48683d39dcd16f92ec7dfe565df7',
    ),
    true,
    'Scaffolded validate workflow must pin skill-publish to an immutable commit SHA.',
  );
  assert.equal(
    scaffoldedReadme.includes('Open a pull request to run fork-safe validate-only CI first.'),
    true,
    'Scaffolded repo README must direct maintainers through validate-first setup.',
  );
  assert.equal(
    scaffoldedReadme.includes('Add `RB_API_KEY` only when you are ready to quote and publish immutable releases.'),
    true,
    'Scaffolded repo README must keep publish credit/auth setup separate from validate-first setup.',
  );
  assert.equal(
    releaseWorkflow.includes("tags:\n      - 'v*.*.*'"),
    true,
    'Release workflow must only react to semver tags.',
  );
  assert.equal(
    releaseWorkflow.includes('Publish package from main release workflow'),
    true,
    'Release workflow must publish npm from the main release path instead of relying on a workflow-triggered tag push.',
  );
  const publishMonorepoWorkflow = await readFile(
    path.join(repoRoot, 'examples', 'workflows', 'publish-monorepo-paths.yml'),
    'utf8',
  );
  assert.equal(
    publishMonorepoWorkflow.includes(
      'hashgraph-online/skill-publish@9742f4cab7ca48683d39dcd16f92ec7dfe565df7',
    ),
    true,
    'Monorepo example must pin the skill-publish action to an immutable commit SHA.',
  );
  assert.equal(
    publishMonorepoWorkflow.includes('Prepare skill package'),
    true,
    'Monorepo example must stage a canonical package before publish.',
  );
  assert.equal(
    publishMonorepoWorkflow.includes('actions/checkout@v4'),
    false,
    'Monorepo example must not use a mutable checkout tag.',
  );
} finally {
  await rm(runtimeRoot, { recursive: true, force: true });
}

process.stdout.write('repo-workflows test passed\n');
