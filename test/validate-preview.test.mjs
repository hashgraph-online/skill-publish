import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const fixtureRoot = path.join(repoRoot, 'test', 'fixtures');

function parseGithubOutput(text) {
  const lines = text.split('\n');
  const output = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) {
      continue;
    }
    const separatorIndex = line.indexOf('<<');
    if (separatorIndex === -1) {
      continue;
    }
    const key = line.slice(0, separatorIndex);
    const delimiter = line.slice(separatorIndex + 2);
    const valueLines = [];
    index += 1;
    while (index < lines.length && lines[index] !== delimiter) {
      valueLines.push(lines[index]);
      index += 1;
    }
    output.set(key, valueLines.join('\n'));
  }
  return output;
}

async function listenServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind test server');
  }
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

async function runValidate(fixtureName, options = {}) {
  const runtimeRoot = await mkdtemp(path.join(repoRoot, 'test-runtime-'));
  const githubOutputPath = path.join(runtimeRoot, 'github-output.txt');
  const githubSummaryPath = path.join(runtimeRoot, 'github-summary.md');
  await mkdir(runtimeRoot, { recursive: true });
  const skillDir = path.join(fixtureRoot, fixtureName);

  try {
    const result = await execFileAsync('node', ['entrypoint.mjs'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        INPUT_MODE: 'validate',
        INPUT_API_BASE_URL: options.apiBaseUrl ?? 'https://hol.org/registry/api/v1',
        INPUT_SKILL_DIR: skillDir,
        INPUT_ANNOTATE: 'false',
        INPUT_PREVIEW_UPLOAD: options.previewUpload ?? 'true',
        GITHUB_OUTPUT: githubOutputPath,
        GITHUB_STEP_SUMMARY: githubSummaryPath,
        GITHUB_REPOSITORY: 'hashgraph-online/valid-skill',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_SHA: 'abc123def456abc123def456abc123def456abcd',
        GITHUB_REF: 'refs/pull/5/merge',
        GITHUB_EVENT_NAME: 'pull_request',
        ...options.extraEnv,
      },
    });

    return {
      ...result,
      githubOutputPath,
      runtimeRoot,
    };
  } catch (error) {
    return {
      error,
      githubOutputPath,
      runtimeRoot,
    };
  }
}

const validRun = await runValidate('valid-skill');
assert.equal(validRun.error, undefined, validRun.error?.stderr ?? validRun.error?.message);
const githubOutput = parseGithubOutput(await readFile(validRun.githubOutputPath, 'utf8'));
assert.equal(githubOutput.get('skill-name'), 'valid-skill');
assert.equal(githubOutput.get('skill-version'), '1.0.0');
assert.ok(githubOutput.has('preview-json'));
assert.ok(githubOutput.has('preview-json-path'));
assert.ok(githubOutput.has('next-actions'));
const previewJson = JSON.parse(githubOutput.get('preview-json'));
const previewJsonPath = githubOutput.get('preview-json-path');
assert.ok(previewJsonPath);
const previewJsonOnDisk = JSON.parse(await readFile(previewJsonPath, 'utf8'));
assert.equal(previewJson.schema_version, 'skill-preview.v1');
assert.match(previewJson.preview_id, /^preview_[a-f0-9]{32}$/u);
assert.equal(
  previewJson.workflow_run_url,
  'https://github.com/hashgraph-online/valid-skill/actions',
);
assert.equal(previewJson.name, 'valid-skill');
assert.equal(previewJson.validation_status, 'passed');
assert.deepEqual(previewJsonOnDisk, previewJson);
assert.equal(githubOutput.get('status-url'), '');

const previewUploadRequests = [];
const oidcServer = await listenServer(async (request, response) => {
  const body = await new Promise((resolve) => {
    let chunks = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      chunks += chunk;
    });
    request.on('end', () => resolve(chunks));
  });

  if (request.url?.startsWith('/oidc')) {
    assert.equal(request.headers.authorization, 'Bearer broker-test-token');
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ value: 'github-oidc-token' }));
    return;
  }

  if (request.url === '/api/v1/skills/preview/github-oidc') {
    previewUploadRequests.push({
      authorization: request.headers.authorization,
      body: body ? JSON.parse(body) : null,
    });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        id: 'preview-record-1',
        source: 'github-oidc',
        generatedAt: '2026-04-04T10:00:00.000Z',
        expiresAt: '2026-04-11T10:00:00.000Z',
        statusUrl: 'https://hol.org/registry/skills/valid-skill',
        report: JSON.parse(body),
      }),
    );
    return;
  }

  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'not found' }));
});

const uploadedRun = await runValidate('valid-skill', {
  apiBaseUrl: `${oidcServer.baseUrl}/api/v1`,
  extraEnv: {
    ACTIONS_ID_TOKEN_REQUEST_URL: `${oidcServer.baseUrl}/oidc`,
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'broker-test-token',
  },
});
assert.equal(uploadedRun.error, undefined, uploadedRun.error?.stderr ?? uploadedRun.error?.message);
const uploadedOutput = parseGithubOutput(await readFile(uploadedRun.githubOutputPath, 'utf8'));
assert.equal(uploadedOutput.get('status-url'), 'https://hol.org/registry/skills/valid-skill');
assert.equal(previewUploadRequests.length, 1);
assert.equal(previewUploadRequests[0].authorization, 'Bearer github-oidc-token');
assert.equal(previewUploadRequests[0].body.name, 'valid-skill');

const missingSkillMdRun = await runValidate('missing-skill-md');
assert.ok(missingSkillMdRun.error);
assert.match(
  `${missingSkillMdRun.error.stderr ?? ''}${missingSkillMdRun.error.message ?? ''}`,
  /Missing required file: .*SKILL\.md/u,
);

const missingSkillJsonRun = await runValidate('missing-skill-json');
assert.ok(missingSkillJsonRun.error);
assert.match(
  `${missingSkillJsonRun.error.stderr ?? ''}${missingSkillJsonRun.error.message ?? ''}`,
  /Missing required file: .*skill\.json/u,
);

const invalidJsonRun = await runValidate('invalid-skill-json');
assert.ok(invalidJsonRun.error);
assert.match(
  `${invalidJsonRun.error.stderr ?? ''}${invalidJsonRun.error.message ?? ''}`,
  /skill\.json is not valid JSON/u,
);

await rm(validRun.runtimeRoot, { recursive: true, force: true });
await oidcServer.close();
await rm(uploadedRun.runtimeRoot, { recursive: true, force: true });
if (missingSkillMdRun.runtimeRoot) {
  await rm(missingSkillMdRun.runtimeRoot, { recursive: true, force: true });
}
if (missingSkillJsonRun.runtimeRoot) {
  await rm(missingSkillJsonRun.runtimeRoot, { recursive: true, force: true });
}
if (invalidJsonRun.runtimeRoot) {
  await rm(invalidJsonRun.runtimeRoot, { recursive: true, force: true });
}

process.stdout.write('validate preview integration test passed\n');
