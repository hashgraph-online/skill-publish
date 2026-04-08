import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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

async function runActionMode(fixtureName, mode, options = {}) {
  const runtimeRoot = await mkdtemp(path.join(repoRoot, 'test-runtime-'));
  const githubOutputPath = path.join(runtimeRoot, 'github-output.txt');
  const githubSummaryPath = path.join(runtimeRoot, 'github-summary.md');
  const githubEventPath = path.join(runtimeRoot, 'github-event.json');
  await mkdir(runtimeRoot, { recursive: true });
  let skillDir = path.join(fixtureRoot, fixtureName);
  if (options.packageInRuntime) {
    const packageDir = path.join(
      runtimeRoot,
      `publish-package-${fixtureName}-${Math.random().toString(36).slice(2, 8)}`,
    );
    await cp(skillDir, packageDir, { recursive: true });
    skillDir = packageDir;
  }
  if (options.eventPayload) {
    await writeFile(
      githubEventPath,
      JSON.stringify(options.eventPayload, null, 2),
      'utf8',
    );
  }
  const skillDirInput = options.relativeSkillDir
    ? path.relative(repoRoot, skillDir) || '.'
    : skillDir;

  try {
    const result = await execFileAsync('node', ['entrypoint.mjs'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        INPUT_MODE: mode,
        INPUT_API_BASE_URL: options.apiBaseUrl ?? 'https://hol.org/registry/api/v1',
        INPUT_SKILL_DIR: skillDirInput,
        INPUT_ANNOTATE: 'false',
        GITHUB_OUTPUT: githubOutputPath,
        GITHUB_STEP_SUMMARY: githubSummaryPath,
        GITHUB_REPOSITORY: 'hashgraph-online/valid-skill',
        GITHUB_SERVER_URL: 'https://github.com',
        ...(options.githubApiUrl ? { GITHUB_API_URL: options.githubApiUrl } : {}),
        GITHUB_SHA: 'abc123def456abc123def456abc123def456abcd',
        GITHUB_REF: 'refs/pull/5/merge',
        GITHUB_EVENT_NAME: 'pull_request',
        ...(options.eventPayload ? { GITHUB_EVENT_PATH: githubEventPath } : {}),
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

const validRun = await runActionMode('valid-skill', 'validate');
assert.equal(validRun.error, undefined, validRun.error?.stderr ?? validRun.error?.message);
const githubOutput = parseGithubOutput(await readFile(validRun.githubOutputPath, 'utf8'));
assert.equal(githubOutput.get('skill-name'), 'valid-skill');
assert.equal(githubOutput.get('skill-version'), '1.0.0');
assert.ok(githubOutput.has('preview-json'));
assert.ok(githubOutput.has('preview-json-path'));
assert.ok(githubOutput.has('next-actions'));
assert.ok(githubOutput.has('hcs28-json'));
assert.ok(githubOutput.has('hcs28-score-total'));
assert.equal(githubOutput.get('trust-tier'), 'validated');
assert.equal(githubOutput.get('publish-readiness'), 'ready');
assert.equal(githubOutput.get('missing-requirements'), '[]');
assert.equal(githubOutput.get('estimated-credits-range'), '');
assert.equal(githubOutput.get('managed-comment-url'), '');
assert.equal(githubOutput.get('managed-comment-status'), 'skipped');
assert.equal(githubOutput.get('managed-comment-reason'), 'missing-github-token');
assert.equal(githubOutput.get('publish-comment-url'), '');
assert.equal(githubOutput.get('publish-comment-status'), 'disabled');
assert.equal(githubOutput.get('release-annotation-status'), 'disabled');
const previewJson = JSON.parse(githubOutput.get('preview-json'));
const previewJsonPath = githubOutput.get('preview-json-path');
assert.ok(previewJsonPath);
const previewJsonOnDisk = JSON.parse(await readFile(previewJsonPath, 'utf8'));
assert.equal(previewJson.schema_version, 'skill-preview.v1');
assert.match(previewJson.preview_id, /^preview_[a-f0-9]{32}$/u);
assert.equal(previewJson.hcs_28?.profile?.id, 'hcs-28/baseline');
assert.equal(previewJson.hcs_28?.profile?.version, '0.1');
assert.ok(typeof previewJson.hcs_28?.trustScores?.total === 'number');
assert.equal(
  previewJson.workflow_run_url,
  'https://github.com/hashgraph-online/valid-skill/actions',
);
assert.equal(previewJson.name, 'valid-skill');
assert.equal(previewJson.validation_status, 'passed');
assert.deepEqual(previewJsonOnDisk, previewJson);
assert.equal(githubOutput.get('status-url'), '');

const quotePreviewRequests = [];
const statusByRepoRequests = [];
const versionLookupRequests = [];
let domainProofSkillLookupCount = 0;
const managedCommentRequests = [];
const managedCommentUpdates = [];
const storedManagedComments = [];
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

  if (requestPath === '/api/v1/skills/quote-preview') {
    quotePreviewRequests.push(body ? JSON.parse(body) : null);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        estimatedCredits: {
          min: 64,
          max: 76,
        },
        estimatedHbar: {
          min: 0.64,
          max: 0.76,
        },
        pricingVersion: 'heuristic-v1',
        assumptions: [
          'Estimate derived from package file count and total bytes.',
        ],
        purchaseUrl: 'https://hol.org/registry/skills/submit',
        publishUrl: 'https://hol.org/registry/skills/submit',
        verificationUrl: 'https://hol.org/registry/skills/submit',
      }),
    );
    return;
  }

  if (requestPath === '/api/v1/skills') {
    const name = requestUrl.searchParams.get('name') ?? '';
    const version = requestUrl.searchParams.get('version') ?? '';
    versionLookupRequests.push({ name, version });
    if (name === 'status-override-skill' && version === '1.0.0') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          items: [
            {
              jobId: 'job_status_override_skill',
              network: 'testnet',
              name: 'status-override-skill',
              version: '1.0.0',
              createdAt: '2026-04-06T12:00:00.000Z',
              directoryTopicId: '0.0.123',
              packageTopicId: '0.0.456',
              skillJsonHrl: 'hcs://1/0.0.456',
              repo: 'https://github.com/hashgraph-online/valid-skill',
              verificationSignals: {
                publisherBound: { ok: true },
                repoCommitIntegrity: { ok: true },
                manifestIntegrity: { ok: true },
                domainProof: { ok: false },
              },
            },
          ],
          nextCursor: null,
        }),
      );
      return;
    }
    if (name === 'domain-proof-skill' && version === '1.0.0') {
      domainProofSkillLookupCount += 1;
      const includePublishedSignals = domainProofSkillLookupCount > 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          items: includePublishedSignals
            ? [
                {
                  jobId: 'job_domain_proof_skill',
                  network: 'testnet',
                  name: 'domain-proof-skill',
                  version: '1.0.0',
                  createdAt: '2026-04-06T12:00:00.000Z',
                  directoryTopicId: '0.0.123',
                  packageTopicId: '0.0.456',
                  skillJsonHrl: 'hcs://1/0.0.456',
                  repo: 'https://github.com/hashgraph-online/valid-skill',
                  verificationSignals: {
                    publisherBound: { ok: true },
                    repoCommitIntegrity: { ok: true },
                    manifestIntegrity: { ok: true },
                    domainProof: { ok: true },
                  },
                },
              ]
            : [],
          nextCursor: null,
        }),
      );
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ items: [], nextCursor: null }));
    return;
  }

  if (requestPath === '/api/v1/skills/status/by-repo') {
    const skillDir = requestUrl.searchParams.get('skillDir') ?? '';
    statusByRepoRequests.push({
      repo: requestUrl.searchParams.get('repo'),
      skillDir,
      ref: requestUrl.searchParams.get('ref'),
    });
    if (skillDir.includes('status-override-skill')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          name: 'status-override-skill',
          version: '1.0.0',
          published: true,
          verifiedDomain: true,
          trustTier: 'verified',
          badgeMetric: 'tier',
          checks: {
            repoCommitIntegrity: true,
            manifestIntegrity: true,
            domainProof: true,
          },
          nextSteps: [],
          verificationSignals: {
            domainProof: true,
            publisherBound: true,
            verifiedDomain: true,
            previewValidated: true,
          },
          provenanceSignals: {
            repoCommitIntegrity: true,
            manifestIntegrity: true,
            canonicalRelease: true,
            previewAvailable: true,
            previewAuthoritative: false,
          },
          statusUrl: 'https://hol.org/registry/skills/status-override-skill',
        }),
      );
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        name: 'domain-proof-skill',
        version: '1.0.0',
        published: false,
        verifiedDomain: false,
        trustTier: 'validated',
        badgeMetric: 'status',
        checks: {
          repoCommitIntegrity: true,
          manifestIntegrity: true,
          domainProof: false,
        },
        nextSteps: [],
        verificationSignals: {
          domainProof: false,
          publisherBound: true,
          verifiedDomain: false,
          previewValidated: true,
        },
        provenanceSignals: {
          repoCommitIntegrity: true,
          manifestIntegrity: true,
          canonicalRelease: false,
          previewAvailable: true,
          previewAuthoritative: false,
        },
        statusUrl: null,
      }),
    );
    return;
  }

  if (
    requestPath.startsWith(
      '/repos/hashgraph-online/valid-skill/issues/5/comments',
    )
  ) {
    if (request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(storedManagedComments));
      return;
    }
    if (request.method === 'POST') {
      const payload = body ? JSON.parse(body) : null;
      managedCommentRequests.push(payload);
      storedManagedComments.splice(
        0,
        storedManagedComments.length,
        {
          id: 501,
          body: payload?.body ?? '',
          html_url:
            'https://github.com/hashgraph-online/valid-skill/pull/5#issuecomment-501',
        },
      );
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          id: 501,
          html_url:
            'https://github.com/hashgraph-online/valid-skill/pull/5#issuecomment-501',
        }),
      );
      return;
    }
  }

  if (requestPath === '/repos/hashgraph-online/valid-skill/issues/comments/501') {
    if (request.method === 'PATCH') {
      const payload = body ? JSON.parse(body) : null;
      managedCommentUpdates.push(payload);
      storedManagedComments.splice(
        0,
        storedManagedComments.length,
        {
          id: 501,
          body: payload?.body ?? '',
          html_url:
            'https://github.com/hashgraph-online/valid-skill/pull/5#issuecomment-501',
        },
      );
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          id: 501,
          html_url:
            'https://github.com/hashgraph-online/valid-skill/pull/5#issuecomment-501',
        }),
      );
      return;
    }
  }

  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'not found' }));
});

const monitorRun = await runActionMode('valid-skill', 'monitor');
assert.equal(monitorRun.error, undefined, monitorRun.error?.stderr ?? monitorRun.error?.message);
const monitorOutput = parseGithubOutput(await readFile(monitorRun.githubOutputPath, 'utf8'));
assert.equal(monitorOutput.get('trust-tier'), 'validated');
assert.equal(monitorOutput.get('publish-readiness'), 'ready');
assert.equal(monitorOutput.get('missing-requirements'), '[]');
assert.ok(monitorOutput.has('next-actions'));

const quotePreviewRun = await runActionMode('valid-skill', 'validate', {
  apiBaseUrl: `${apiServer.baseUrl}/api/v1`,
  extraEnv: {
    INPUT_QUOTE_PREVIEW: 'true',
  },
});
assert.equal(
  quotePreviewRun.error,
  undefined,
  quotePreviewRun.error?.stderr ?? quotePreviewRun.error?.message,
);
const quotePreviewOutput = parseGithubOutput(
  await readFile(quotePreviewRun.githubOutputPath, 'utf8'),
);
assert.equal(quotePreviewOutput.get('estimated-credits-range'), '64-76');
assert.equal(
  quotePreviewOutput.get('purchase-url'),
  'https://hol.org/registry/skills/submit',
);
assert.equal(quotePreviewRequests.length, 1);
assert.equal(quotePreviewRequests[0]?.name, 'valid-skill');
assert.equal(quotePreviewRequests[0]?.version, '1.0.0');

const managedCommentRun = await runActionMode('domain-proof-skill', 'monitor', {
  apiBaseUrl: `${apiServer.baseUrl}/api/v1`,
  relativeSkillDir: true,
  githubApiUrl: apiServer.baseUrl,
  eventPayload: {
    pull_request: {
      number: 5,
    },
  },
  extraEnv: {
    INPUT_COMMENT_MODE: 'always',
    INPUT_GITHUB_TOKEN: 'ghs_test_token',
  },
});
assert.equal(
  managedCommentRun.error,
  undefined,
  managedCommentRun.error?.stderr ?? managedCommentRun.error?.message,
);
const managedCommentOutput = parseGithubOutput(
  await readFile(managedCommentRun.githubOutputPath, 'utf8'),
);
assert.equal(
  managedCommentOutput.get('managed-comment-url'),
  'https://github.com/hashgraph-online/valid-skill/pull/5#issuecomment-501',
);
assert.equal(managedCommentOutput.get('managed-comment-status'), 'created');
assert.equal(managedCommentOutput.get('publish-comment-status'), 'disabled');
assert.equal(managedCommentOutput.get('release-annotation-status'), 'disabled');
assert.equal(managedCommentRequests.length, 1);
assert.match(
  managedCommentRequests[0]?.body ?? '',
  /## HOL skill-publish · ✅ Publish-ready/u,
);
assert.match(
  managedCommentRequests[0]?.body ?? '',
  /\| Metric \| Value \|/u,
);
assert.match(
  managedCommentRequests[0]?.body ?? '',
  /\*\*Recommended next step:\*\*/u,
);
assert.match(
  managedCommentRequests[0]?.body ?? '',
  /### How to improve this score/u,
);
assert.match(
  managedCommentRequests[0]?.body ?? '',
  /\[HOL Skills submit\]\(https:\/\/hol\.org\/registry\/skills\/submit\)/u,
);
assert.match(
  managedCommentRequests[0]?.body ?? '',
  /link your domain so HOL can verify the TXT record/u,
);
assert.equal(
  (managedCommentRequests[0]?.body ?? '').includes('### Links'),
  false,
);

const dedupeRun = await runActionMode('domain-proof-skill', 'validate', {
  apiBaseUrl: `${apiServer.baseUrl}/api/v1`,
  packageInRuntime: true,
  relativeSkillDir: true,
  githubApiUrl: apiServer.baseUrl,
  eventPayload: {
    pull_request: {
      number: 5,
    },
  },
  extraEnv: {
    INPUT_COMMENT_MODE: 'always',
    INPUT_GITHUB_TOKEN: 'ghs_test_token',
  },
});
assert.equal(
  dedupeRun.error,
  undefined,
  dedupeRun.error?.stderr ?? dedupeRun.error?.message,
);
const dedupeOutput = parseGithubOutput(
  await readFile(dedupeRun.githubOutputPath, 'utf8'),
);
assert.equal(
  dedupeOutput.get('managed-comment-url'),
  'https://github.com/hashgraph-online/valid-skill/pull/5#issuecomment-501',
);
assert.equal(
  managedCommentRequests.length,
  1,
  'A rerun for the same PR and skill should update the managed comment instead of creating a new one.',
);
assert.equal(managedCommentUpdates.length, 1);
assert.match(
  managedCommentUpdates[0]?.body ?? '',
  /## HOL skill-publish · ✅ Publish-ready/u,
);
assert.equal(
  (managedCommentUpdates[0]?.body ?? '').includes('link your domain so HOL can verify the TXT record'),
  false,
);
const dedupeHcs28 = JSON.parse(dedupeOutput.get('hcs28-json'));
assert.equal(
  dedupeHcs28?.trustScores?.['verification.domain-proof.score'],
  100,
);
assert.ok(
  statusByRepoRequests.some((entry) =>
    (entry?.skillDir ?? '').includes('publish-package-domain-proof-skill'),
  ),
);
assert.ok(
  versionLookupRequests.some((entry) =>
    entry?.name === 'domain-proof-skill' && entry?.version === '1.0.0',
  ),
);

const statusOverrideRun = await runActionMode('domain-proof-skill', 'validate', {
  apiBaseUrl: `${apiServer.baseUrl}/api/v1`,
  packageInRuntime: true,
  relativeSkillDir: true,
  extraEnv: {
    INPUT_NAME: 'status-override-skill',
  },
});
assert.equal(
  statusOverrideRun.error,
  undefined,
  statusOverrideRun.error?.stderr ?? statusOverrideRun.error?.message,
);
const statusOverrideOutput = parseGithubOutput(
  await readFile(statusOverrideRun.githubOutputPath, 'utf8'),
);
const statusOverrideHcs28 = JSON.parse(statusOverrideOutput.get('hcs28-json'));
assert.equal(
  statusOverrideHcs28?.trustScores?.['verification.domain-proof.score'],
  100,
);

const missingSkillMdRun = await runActionMode('missing-skill-md', 'validate');
assert.ok(missingSkillMdRun.error);
assert.match(
  `${missingSkillMdRun.error.stderr ?? ''}${missingSkillMdRun.error.message ?? ''}`,
  /Missing required file: .*SKILL\.md/u,
);

const missingSkillJsonRun = await runActionMode('missing-skill-json', 'validate');
assert.equal(
  missingSkillJsonRun.error,
  undefined,
  missingSkillJsonRun.error?.stderr ?? missingSkillJsonRun.error?.message,
);
const missingSkillJsonOutput = parseGithubOutput(
  await readFile(missingSkillJsonRun.githubOutputPath, 'utf8'),
);
assert.equal(missingSkillJsonOutput.get('skill-name'), 'missing-skill-json');
assert.equal(missingSkillJsonOutput.get('skill-version'), '1.0.0');
assert.ok(missingSkillJsonOutput.has('preview-json'));
assert.equal(missingSkillJsonOutput.get('trust-tier'), 'validated');
assert.equal(missingSkillJsonOutput.get('publish-readiness'), 'ready');

const invalidJsonRun = await runActionMode('invalid-skill-json', 'validate');
assert.ok(invalidJsonRun.error);
assert.match(
  `${invalidJsonRun.error.stderr ?? ''}${invalidJsonRun.error.message ?? ''}`,
  /skill\.json is not valid JSON/u,
);

await rm(validRun.runtimeRoot, { recursive: true, force: true });
await apiServer.close();
await rm(monitorRun.runtimeRoot, { recursive: true, force: true });
await rm(quotePreviewRun.runtimeRoot, { recursive: true, force: true });
await rm(managedCommentRun.runtimeRoot, { recursive: true, force: true });
await rm(dedupeRun.runtimeRoot, { recursive: true, force: true });
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
