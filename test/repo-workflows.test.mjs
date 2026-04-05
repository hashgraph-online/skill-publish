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

  const setupActionResult = runCli(
    ['setup-action', existingRepoDir, '--with-validate'],
    repoRoot,
  );
  assert.equal(setupActionResult.status, 0, setupActionResult.stderr);

  const validateWorkflow = await readFile(
    path.join(existingRepoDir, '.github', 'workflows', 'validate-skill.yml'),
    'utf8',
  );
  assert.equal(
    validateWorkflow.includes('id-token: write'),
    true,
    'Validate workflow must request OIDC so preview upload works without secrets.',
  );
  assert.equal(
    validateWorkflow.includes('mode: validate'),
    true,
    'Validate workflow must call skill-publish in validate mode.',
  );
  assert.equal(
    validateWorkflow.includes('api-key:'),
    false,
    'Validate workflow must remain secretless.',
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
    true,
    'Scaffolded validate workflow must request OIDC permissions.',
  );
  assert.equal(
    scaffoldedReadme.includes('Open a pull request to run validate-only CI first.'),
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
} finally {
  await rm(runtimeRoot, { recursive: true, force: true });
}

process.stdout.write('repo-workflows test passed\n');
