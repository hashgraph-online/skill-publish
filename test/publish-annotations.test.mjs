import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const fixtureRoot = path.join(repoRoot, 'test', 'fixtures');

const parseGithubOutput = (text) => {
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
};

const listenServer = async (handler) => {
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
};

const runPublish = async (options) => {
  const runtimeRoot = await mkdtemp(path.join(repoRoot, 'test-runtime-'));
  const githubOutputPath = path.join(runtimeRoot, 'github-output.txt');
  const githubSummaryPath = path.join(runtimeRoot, 'github-summary.md');
  const githubEventPath = path.join(runtimeRoot, 'github-event.json');
  const skillDir = path.join(fixtureRoot, 'valid-skill');
  const eventPayload = {
    release: {
      id: 99,
    },
  };
  await writeFile(githubEventPath, JSON.stringify(eventPayload, null, 2), 'utf8');

  try {
    const result = await execFileAsync('node', ['entrypoint.mjs'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        INPUT_MODE: 'publish',
        INPUT_API_BASE_URL: `${options.baseUrl}/api/v1`,
        INPUT_API_KEY: 'rb_test_key',
        INPUT_SKILL_DIR: skillDir,
        INPUT_ANNOTATE: 'true',
        INPUT_GITHUB_TOKEN: 'ghs_test_token',
        GITHUB_OUTPUT: githubOutputPath,
        GITHUB_STEP_SUMMARY: githubSummaryPath,
        GITHUB_EVENT_PATH: githubEventPath,
        GITHUB_EVENT_NAME: 'release',
        GITHUB_API_URL: options.baseUrl,
        GITHUB_REPOSITORY: 'hashgraph-online/valid-skill',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_SHA: 'abc123def456abc123def456abc123def456abcd',
        GITHUB_REF: 'refs/tags/v1.0.0',
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
};

const state = {
  releaseBody: 'Initial release notes',
  comments: [],
  createdComments: [],
  updatedComments: [],
  releasePatches: [],
  quoteSequence: 0,
  publishSequence: 0,
};

const server = await listenServer(async (request, response) => {
  const body = await new Promise((resolve) => {
    let chunks = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      chunks += chunk;
    });
    request.on('end', () => resolve(chunks));
  });

  if (
    request.method === 'GET' &&
    (request.url === '/api/v1/skills' || request.url?.startsWith('/api/v1/skills?'))
  ) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ items: [], nextCursor: null }));
    return;
  }

  if (request.url === '/api/v1/skills/config' && request.method === 'GET') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        enabled: true,
        maxFiles: 200,
        maxTotalSizeBytes: 2000000,
        allowedMimeTypes: ['text/markdown', 'application/json'],
      }),
    );
    return;
  }

  if (request.url === '/api/v1/skills/quote' && request.method === 'POST') {
    const payload = body ? JSON.parse(body) : {};
    const files = Array.isArray(payload.files) ? payload.files : [];
    state.quoteSequence += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        quoteId: `quote-${state.quoteSequence}`,
        name: 'valid-skill',
        version: '1.0.0',
        directoryTopicId: '0.0.600001',
        credits: 42,
        estimatedCostHbar: 0.42,
        usdCents: 84,
        expiresAt: '2026-04-08T00:00:00.000Z',
        files: files.map((file) => ({
          name: String(file.name ?? ''),
          mimeType: String(file.mimeType ?? 'application/octet-stream'),
          estimatedCostHbar: 0.21,
        })),
      }),
    );
    return;
  }

  if (request.url === '/api/v1/skills/publish' && request.method === 'POST') {
    state.publishSequence += 1;
    const now = `2026-04-07T12:00:0${state.publishSequence}.000Z`;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        jobId: `job-${state.publishSequence}`,
        status: 'in_progress',
        credits: 42,
        usdCents: 84,
        quoteId: `quote-${state.publishSequence}`,
        createdAt: now,
        updatedAt: now,
        network: 'testnet',
      }),
    );
    return;
  }

  if (request.url?.startsWith('/api/v1/skills/jobs/job-') && request.method === 'GET') {
    const normalizedJobId = request.url.split('/').at(-1) ?? 'job-0';
    const updatedAt = '2026-04-07T12:00:10.000Z';
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        jobId: normalizedJobId,
        status: 'completed',
        network: 'testnet',
        name: 'valid-skill',
        version: '1.0.0',
        directoryTopicId: '0.0.600001',
        packageTopicId: '0.0.600002',
        versionRegistryTopicId: '0.0.600002',
        manifestHrl: 'hcs://1/0.0.600002/manifest',
        skillJsonHrl: 'hcs://1/0.0.600002/skill.json',
        createdAt: '2026-04-07T12:00:09.000Z',
        updatedAt,
      }),
    );
    return;
  }

  if (
    request.url ===
      '/repos/hashgraph-online/valid-skill/commits/abc123def456abc123def456abc123def456abcd/pulls' &&
    request.method === 'GET'
  ) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify([
        {
          number: 9,
          merged_at: '2026-04-07T12:00:00.000Z',
          updated_at: '2026-04-07T12:01:00.000Z',
        },
      ]),
    );
    return;
  }

  if (request.url === '/repos/hashgraph-online/valid-skill/releases/99' && request.method === 'GET') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        id: 99,
        body: state.releaseBody,
        html_url: 'https://github.com/hashgraph-online/valid-skill/releases/tag/v1.0.0',
      }),
    );
    return;
  }

  if (request.url === '/repos/hashgraph-online/valid-skill/releases/99' && request.method === 'PATCH') {
    const payload = body ? JSON.parse(body) : {};
    state.releasePatches.push(payload.body ?? '');
    state.releaseBody = String(payload.body ?? '');
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        id: 99,
        body: state.releaseBody,
        html_url: 'https://github.com/hashgraph-online/valid-skill/releases/tag/v1.0.0',
      }),
    );
    return;
  }

  if (
    request.url?.startsWith('/repos/hashgraph-online/valid-skill/issues/9/comments') &&
    request.method === 'GET'
  ) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(state.comments));
    return;
  }

  if (request.url === '/repos/hashgraph-online/valid-skill/issues/9/comments' && request.method === 'POST') {
    const payload = body ? JSON.parse(body) : {};
    state.createdComments.push(payload.body ?? '');
    const comment = {
      id: 301,
      body: String(payload.body ?? ''),
      html_url: 'https://github.com/hashgraph-online/valid-skill/pull/9#issuecomment-301',
    };
    state.comments.splice(0, state.comments.length, comment);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        id: 301,
        html_url: 'https://github.com/hashgraph-online/valid-skill/pull/9#issuecomment-301',
      }),
    );
    return;
  }

  if (
    request.url === '/repos/hashgraph-online/valid-skill/issues/comments/301' &&
    request.method === 'PATCH'
  ) {
    const payload = body ? JSON.parse(body) : {};
    state.updatedComments.push(payload.body ?? '');
    const comment = {
      id: 301,
      body: String(payload.body ?? ''),
      html_url: 'https://github.com/hashgraph-online/valid-skill/pull/9#issuecomment-301',
    };
    state.comments.splice(0, state.comments.length, comment);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        id: 301,
        html_url: 'https://github.com/hashgraph-online/valid-skill/pull/9#issuecomment-301',
      }),
    );
    return;
  }

  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'not found', url: request.url, method: request.method }));
});

let firstRun = null;
let secondRun = null;

try {
  firstRun = await runPublish({ baseUrl: server.baseUrl });
  assert.equal(firstRun.error, undefined, firstRun.error?.stderr ?? firstRun.error?.message);
  const firstOutput = parseGithubOutput(await readFile(firstRun.githubOutputPath, 'utf8'));
  assert.equal(firstOutput.get('published'), 'true');
  assert.equal(firstOutput.get('annotation-target'), 'release:99');
  assert.equal(firstOutput.get('publish-comment-status'), 'created');
  assert.equal(firstOutput.get('release-annotation-status'), 'created');
  assert.equal(
    firstOutput.get('publish-comment-url'),
    'https://github.com/hashgraph-online/valid-skill/pull/9#issuecomment-301',
  );
  assert.equal(state.createdComments.length, 1);
  assert.match(state.createdComments[0], /## HOL skill-publish · 📦 Publish result/u);
  assert.match(state.createdComments[0], /Pinned SKILL\.md/u);
  assert.match(state.releaseBody, /<!-- skill-publish-release:valid-skill-1\.0\.0:start -->/u);
  assert.match(state.releaseBody, /This block is managed by skill-publish/u);

  secondRun = await runPublish({ baseUrl: server.baseUrl });
  assert.equal(secondRun.error, undefined, secondRun.error?.stderr ?? secondRun.error?.message);
  const secondOutput = parseGithubOutput(await readFile(secondRun.githubOutputPath, 'utf8'));
  assert.equal(secondOutput.get('published'), 'true');
  assert.equal(secondOutput.get('annotation-target'), 'release:99');
  assert.equal(secondOutput.get('publish-comment-status'), 'updated');
  assert.equal(secondOutput.get('release-annotation-status'), 'unchanged');
  assert.equal(state.createdComments.length, 1);
  assert.equal(state.updatedComments.length, 1);
  assert.match(state.updatedComments[0], /## HOL skill-publish · 📦 Publish result/u);
} finally {
  await server.close();
  if (firstRun?.runtimeRoot) {
    await rm(firstRun.runtimeRoot, { recursive: true, force: true });
  }
  if (secondRun?.runtimeRoot) {
    await rm(secondRun.runtimeRoot, { recursive: true, force: true });
  }
}

process.stdout.write('publish annotation integration test passed\n');
