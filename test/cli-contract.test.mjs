import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, copyFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const fixtureSkillDir = path.join(repoRoot, 'test', 'fixtures', 'valid-skill');
const cliSourcePath = path.join(repoRoot, 'bin', 'cli.mjs');
const cliLibPath = path.join(repoRoot, 'bin', 'lib');

async function createCliRuntime() {
  const runtimeRoot = await mkdtemp(path.join(repoRoot, 'test-runtime-cli-'));
  await mkdir(path.join(runtimeRoot, 'bin'), { recursive: true });
  await copyFile(cliSourcePath, path.join(runtimeRoot, 'bin', 'cli.mjs'));
  await cp(cliLibPath, path.join(runtimeRoot, 'bin', 'lib'), { recursive: true });
  await writeFile(
    path.join(runtimeRoot, 'entrypoint.mjs'),
    [
      "process.stdout.write(JSON.stringify({",
      "  mode: process.env.INPUT_MODE ?? null,",
      "  apiKey: process.env.INPUT_API_KEY ?? null,",
      "  skillDir: process.env.INPUT_SKILL_DIR ?? null,",
      "}) + '\\n');",
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    path.join(runtimeRoot, 'package.json'),
    JSON.stringify({ version: '9.9.9-test' }, null, 2),
    'utf8',
  );
  return runtimeRoot;
}

async function runCli(args, options = {}) {
  const runtimeRoot = await createCliRuntime();
  try {
    const result = await execFileAsync('node', ['bin/cli.mjs', ...args], {
      cwd: runtimeRoot,
      env: {
        ...process.env,
        INPUT_ANNOTATE: 'false',
        ...options.env,
      },
    });
    return {
      ...result,
      code: 0,
      runtimeRoot,
    };
  } catch (error) {
    return {
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
      code: error.code ?? 1,
      error,
      runtimeRoot,
    };
  }
}

const validateCommand = await runCli(['validate', '--skill-dir', fixtureSkillDir], {
  env: {
    INPUT_API_BASE_URL: 'https://hol.org/registry/api/v1',
  },
});
assert.equal(validateCommand.code, 0, validateCommand.stderr || validateCommand.error?.message);
assert.deepEqual(JSON.parse(validateCommand.stdout.trim()), {
  mode: 'validate',
  apiKey: null,
  skillDir: fixtureSkillDir,
});

const validateFlag = await runCli(['--mode', 'validate', '--skill-dir', fixtureSkillDir], {
  env: {
    INPUT_API_BASE_URL: 'https://hol.org/registry/api/v1',
  },
});
assert.equal(validateFlag.code, 0, validateFlag.stderr || validateFlag.error?.message);
assert.deepEqual(JSON.parse(validateFlag.stdout.trim()), {
  mode: 'validate',
  apiKey: null,
  skillDir: fixtureSkillDir,
});

const monitorFlag = await runCli(['--mode', 'monitor', '--skill-dir', fixtureSkillDir], {
  env: {
    INPUT_API_BASE_URL: 'https://hol.org/registry/api/v1',
  },
});
assert.equal(monitorFlag.code, 0, monitorFlag.stderr || monitorFlag.error?.message);
assert.deepEqual(JSON.parse(monitorFlag.stdout.trim()), {
  mode: 'monitor',
  apiKey: null,
  skillDir: fixtureSkillDir,
});

const quoteWithoutKey = await runCli(['quote', '--skill-dir', fixtureSkillDir]);
assert.notEqual(quoteWithoutKey.code, 0);
assert.match(
  `${quoteWithoutKey.stderr}${quoteWithoutKey.stdout}`,
  /Missing API key/u,
);

const helpResult = await runCli(['--help']);
assert.equal(helpResult.code, 0, helpResult.stderr || helpResult.error?.message);
assert.match(helpResult.stdout, /monitor \[dir\]/u);
assert.match(helpResult.stdout, /validate \[dir\]/u);
assert.match(helpResult.stdout, /publish \[dir\]/u);

await Promise.all(
  [
    validateCommand.runtimeRoot,
    validateFlag.runtimeRoot,
    monitorFlag.runtimeRoot,
    quoteWithoutKey.runtimeRoot,
    helpResult.runtimeRoot,
  ].map((runtimeRoot) => rm(runtimeRoot, { recursive: true, force: true })),
);

process.stdout.write('cli contract test passed\n');
