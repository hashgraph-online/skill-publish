import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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

async function runActionMode(mode, options = {}) {
  const runtimeRoot = await mkdtemp(path.join(repoRoot, 'test-runtime-'));
  const githubOutputPath = path.join(runtimeRoot, 'github-output.txt');
  await mkdir(runtimeRoot, { recursive: true });
  const skillDir = path.join(fixtureRoot, 'valid-skill');

  try {
    const result = await execFileAsync('node', ['entrypoint.mjs'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        INPUT_MODE: mode,
        INPUT_API_BASE_URL: options.apiBaseUrl,
        INPUT_SKILL_DIR: skillDir,
        INPUT_PUBLISH_AUTH: options.publishAuth ?? 'api-key',
        INPUT_ANNOTATE: 'false',
        GITHUB_OUTPUT: githubOutputPath,
        GITHUB_REPOSITORY: 'hashgraph-online/valid-skill',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_SHA: 'abc123def456abc123def456abc123def456abcd',
        GITHUB_REF: options.githubRef ?? 'refs/heads/main',
        GITHUB_EVENT_NAME: options.githubEventName ?? 'workflow_dispatch',
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
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
      error,
      githubOutputPath,
      runtimeRoot,
    };
  }
}

const exchangeRequests = [];
const quoteRequests = [];

const apiServer = await listenServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
  const requestPath = requestUrl.pathname;
  const body = await new Promise((resolve) => {
    let chunks = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      chunks += chunk;
    });
    request.on('end', () => resolve(chunks));
  });

  if (requestPath === '/oidc') {
    assert.equal(request.headers.authorization, 'Bearer broker-test-token');
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ value: 'github-oidc-token' }));
    return;
  }

  if (requestPath === '/api/v1/skills/config') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        enabled: true,
        maxFiles: 100,
        maxTotalSizeBytes: 1048576,
        allowedMimeTypes: [
          'text/markdown',
          'application/json',
          'text/yaml',
          'text/plain',
          'image/svg+xml',
          'image/png',
          'image/jpeg',
          'image/webp',
          'image/x-icon',
          'application/octet-stream',
        ],
        network: 'testnet',
        publisher: {
          cliPackageUrl: 'https://www.npmjs.com/package/skill-publish',
          cliCommand: 'npx skill-publish',
          actionMarketplaceUrl: 'https://github.com/marketplace/actions/skill-publish',
          repositoryUrl: 'https://github.com/hashgraph-online/skill-publish',
          guideUrl: 'https://hol.org/docs/skills/publish',
          docsUrl: 'https://hol.org/docs/registry-broker/api/client',
          submitUrl: 'https://hol.org/registry/skills/submit',
          skillsIndexUrl: 'https://hol.org/registry/skills',
          quickstartCommands: [],
          templatePresets: [],
        },
      }),
    );
    return;
  }

  if (requestPath === '/api/v1/publish/github-oidc/exchange') {
    exchangeRequests.push(body ? JSON.parse(body) : null);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        apiKey: 'rbk_temp_publish_key',
        accountId: '0.0.456',
        expiresAt: '2026-04-09T00:00:00.000Z',
        repoUrl: 'https://github.com/hashgraph-online/valid-skill',
        repository: 'hashgraph-online/valid-skill',
        repositoryOwner: 'hashgraph-online',
        ref: 'refs/heads/main',
        eventName: 'workflow_dispatch',
        workflow: 'Trusted Publish',
        sponsoredCreditsGranted: 0,
        creditGrantReference: null,
      }),
    );
    return;
  }

  if (requestPath === '/api/v1/skills/quote') {
    const parsedBody = body ? JSON.parse(body) : null;
    quoteRequests.push({
      apiKey: request.headers['x-api-key'],
      accountId: request.headers['x-account-id'],
      body: parsedBody,
    });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        quoteId: 'quote_123',
        name: parsedBody?.name ?? 'valid-skill',
        version: parsedBody?.version ?? '1.0.0',
        directoryTopicId: '0.0.777',
        estimatedCostHbar: 0.42,
        credits: 42,
        usdCents: 12,
        expiresAt: '2026-04-09T00:00:00.000Z',
        files: Array.isArray(parsedBody?.files)
          ? parsedBody.files.map((file) => ({
            name: String(file?.name ?? 'unknown'),
            mimeType: String(file?.mimeType ?? 'application/octet-stream'),
            estimatedCostHbar: 0.21,
          }))
          : [],
      }),
    );
    return;
  }

  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'not found' }));
});

const trustedQuoteRun = await runActionMode('quote', {
  apiBaseUrl: `${apiServer.baseUrl}/api/v1`,
  publishAuth: 'github-oidc',
  githubEventName: 'workflow_dispatch',
  githubRef: 'refs/heads/main',
  extraEnv: {
    ACTIONS_ID_TOKEN_REQUEST_URL: `${apiServer.baseUrl}/oidc`,
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'broker-test-token',
  },
});
assert.equal(
  trustedQuoteRun.error,
  undefined,
  trustedQuoteRun.stderr || trustedQuoteRun.error?.message,
);
const trustedQuoteOutput = parseGithubOutput(await readFile(trustedQuoteRun.githubOutputPath, 'utf8'));
assert.equal(trustedQuoteOutput.get('quote-id'), 'quote_123');
assert.equal(exchangeRequests.length, 1);
assert.equal(exchangeRequests[0]?.token, 'github-oidc-token');
assert.equal(quoteRequests.length, 1);
assert.equal(quoteRequests[0]?.apiKey, 'rbk_temp_publish_key');
assert.equal(quoteRequests[0]?.accountId, '0.0.456');

const unsafeQuoteRun = await runActionMode('quote', {
  apiBaseUrl: `${apiServer.baseUrl}/api/v1`,
  publishAuth: 'github-oidc',
  githubEventName: 'pull_request',
  githubRef: 'refs/pull/5/merge',
  extraEnv: {
    ACTIONS_ID_TOKEN_REQUEST_URL: `${apiServer.baseUrl}/oidc`,
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'broker-test-token',
  },
});
assert.ok(unsafeQuoteRun.error);
assert.match(
  `${unsafeQuoteRun.stderr}${unsafeQuoteRun.stdout}${unsafeQuoteRun.error?.message ?? ''}`,
  /publish-auth=github-oidc is only allowed from trusted repo-owned workflows/u,
);
assert.equal(
  exchangeRequests.length,
  1,
  'Unsafe pull_request runs must fail before exchanging GitHub OIDC for publish credentials.',
);

await apiServer.close();
await rm(trustedQuoteRun.runtimeRoot, { recursive: true, force: true });
await rm(unsafeQuoteRun.runtimeRoot, { recursive: true, force: true });

process.stdout.write('publish oidc test passed\n');
