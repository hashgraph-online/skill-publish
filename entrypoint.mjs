import { readFile, stat, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { buildDistributionKit, normalizeApiBaseUrl } from './bin/lib/distribution-kit.mjs';
import { submitToIndexNow } from './bin/lib/indexnow.mjs';
import { discoverSkillPackageFiles } from './bin/lib/package-files.mjs';
import { buildSkillPreviewReport, formatPreviewNextActions } from './bin/lib/preview-report.mjs';
import { writeSkillPreviewReport } from './bin/lib/preview-output.mjs';

const stdout = (message) => process.stdout.write(`${message}\n`);
const stderr = (message) => process.stderr.write(`${message}\n`);
const printJson = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

class ActionError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ActionError';
    this.statusCode =
      typeof options.statusCode === 'number' && Number.isFinite(options.statusCode)
        ? options.statusCode
        : undefined;
    this.code =
      typeof options.code === 'string' && options.code.trim().length > 0
        ? options.code.trim().toUpperCase()
        : undefined;
  }
}

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ERR_NETWORK',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_CONNECT_ERROR',
]);
const RETRYABLE_ERROR_MARKERS = [
  'gateway time-out',
  'gateway timeout',
  'timed out',
  'timeout',
  'service unavailable',
  'temporarily unavailable',
  'too many requests',
  'rate limit',
  'network error',
  'fetch failed',
  'connection reset',
];
const INTEGER_VERSION_PATTERN = /^\d+$/;
const SEMVER_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/;
const SEMVER_PRERELEASE_PATTERN = /^\d+\.\d+\.\d+-[0-9A-Za-z.-]+(?:\+[0-9A-Za-z.-]+)?$/;

const getEnv = (name, fallback = '') => {
  const value = process.env[name];
  return typeof value === 'string' ? value : fallback;
};

const toBoolean = (value, defaultValue) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
};

const parseNumber = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const isStableRegistryVersion = (value) => {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return false;
  }
  if (INTEGER_VERSION_PATTERN.test(normalized)) {
    return true;
  }
  if (SEMVER_PRERELEASE_PATTERN.test(normalized)) {
    return false;
  }
  return SEMVER_VERSION_PATTERN.test(normalized);
};

const isProductionRegistryBase = (value) => {
  try {
    const url = new URL(String(value ?? '').trim());
    const hostname = url.hostname.toLowerCase();
    return hostname === 'hol.org' || hostname === 'registry.hashgraphonline.com';
  } catch {
    return false;
  }
};

const guessMimeType = (filePath) => {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return 'text/markdown';
  }
  if (lower.endsWith('.json')) {
    return 'application/json';
  }
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) {
    return 'text/yaml';
  }
  if (lower.endsWith('.txt')) {
    return 'text/plain';
  }
  if (lower.endsWith('.svg')) {
    return 'image/svg+xml';
  }
  if (lower.endsWith('.png')) {
    return 'image/png';
  }
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  if (lower.endsWith('.webp')) {
    return 'image/webp';
  }
  if (lower.endsWith('.ico')) {
    return 'image/x-icon';
  }
  return 'application/octet-stream';
};

const resolveRole = (filePath) => {
  if (filePath === 'SKILL.md') {
    return 'skill-md';
  }
  if (filePath === 'skill.json') {
    return 'skill-json';
  }
  const base = path.posix.basename(filePath).toLowerCase();
  if (
    /^logo\.(png|jpe?g|webp|svg|ico)$/u.test(base) ||
    /^icon\.(png|jpe?g|webp|svg|ico)$/u.test(base)
  ) {
    return 'skill-icon';
  }
  return 'file';
};

const buildApiUrl = (baseUrl, endpointPath, query = null) => {
  const sanitizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
  const url = new URL(`${sanitizedBase}${normalizedPath}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === null || value === undefined || value === '') {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
};

const summarizeErrorBody = async (response) => {
  const text = await response.text();
  if (!text) {
    return '';
  }
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed);
  } catch {
    return text;
  }
};

const sleep = (delayMs) =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

const extractErrorCode = (error) => {
  if (!error || typeof error !== 'object') {
    return '';
  }
  if (typeof error.code === 'string') {
    return error.code.trim().toUpperCase();
  }
  if (error.cause && typeof error.cause === 'object' && typeof error.cause.code === 'string') {
    return error.cause.code.trim().toUpperCase();
  }
  return '';
};

const isRetryableRequestError = (error) => {
  if (error instanceof ActionError && typeof error.statusCode === 'number') {
    if (RETRYABLE_STATUS_CODES.has(error.statusCode)) {
      return true;
    }
    if (error.statusCode >= 400 && error.statusCode < 500) {
      return false;
    }
  }

  const code = extractErrorCode(error);
  if (code && RETRYABLE_ERROR_CODES.has(code)) {
    return true;
  }

  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error ?? '').toLowerCase();
  return RETRYABLE_ERROR_MARKERS.some((marker) => message.includes(marker));
};

const requestJson = async (params) => {
  const {
    method,
    url,
    apiKey,
    body,
    signal,
  } = params;
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal,
    });
  } catch (error) {
    throw new ActionError(
      `${method} ${url} failed: ${error instanceof Error ? error.message : String(error)}`,
      {
        code: extractErrorCode(error),
      },
    );
  }
  if (!response.ok) {
    const bodySummary = await summarizeErrorBody(response);
    throw new ActionError(
      `${method} ${url} failed with ${response.status}${bodySummary ? `: ${bodySummary}` : ''}`,
      {
        statusCode: response.status,
      },
    );
  }
  return response.json();
};

const requestBearerJson = async (params) => {
  const { method, url, token, body, signal } = params;
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal,
    });
  } catch (error) {
    throw new ActionError(
      `${method} ${url} failed: ${error instanceof Error ? error.message : String(error)}`,
      {
        code: extractErrorCode(error),
      },
    );
  }
  if (!response.ok) {
    const bodySummary = await summarizeErrorBody(response);
    throw new ActionError(
      `${method} ${url} failed with ${response.status}${bodySummary ? `: ${bodySummary}` : ''}`,
      {
        statusCode: response.status,
      },
    );
  }
  return response.json();
};

const requestJsonWithRetry = async (params) => {
  const attempts = Number.isFinite(params.attempts) && params.attempts > 0 ? Math.floor(params.attempts) : 1;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await requestJson(params);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetryableRequestError(error)) {
        throw error;
      }
      const delayMs = Math.min(10_000, 1_000 * attempt);
      stderr(
        `Transient request failure on ${params.method} ${params.url}; retrying in ${delayMs}ms (retry ${attempt}/${attempts - 1}).`,
      );
      await sleep(delayMs);
    }
  }
  throw lastError instanceof Error ? lastError : new ActionError('Request failed');
};

const requestBearerJsonWithRetry = async (params) => {
  const attempts = Number.isFinite(params.attempts) && params.attempts > 0 ? Math.floor(params.attempts) : 1;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await requestBearerJson(params);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetryableRequestError(error)) {
        throw error;
      }
      const delayMs = Math.min(10_000, 1_000 * attempt);
      stderr(
        `Transient bearer request failure on ${params.method} ${params.url}; retrying in ${delayMs}ms (retry ${attempt}/${attempts - 1}).`,
      );
      await sleep(delayMs);
    }
  }
  throw lastError instanceof Error ? lastError : new ActionError('Request failed');
};

const findExistingSkillVersion = async (params) => {
  const { apiBaseUrl, apiKey, name, version } = params;
  const response = await requestJsonWithRetry({
    method: 'GET',
    url: buildApiUrl(apiBaseUrl, '/skills', {
      name,
      version,
      limit: 20,
    }),
    apiKey,
    attempts: 3,
  });

  const items = Array.isArray(response?.items) ? response.items : [];
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    const itemName = typeof item.name === 'string' ? item.name.trim() : '';
    const itemVersion = typeof item.version === 'string' ? item.version.trim() : '';
    if (itemName === name && itemVersion === version) {
      return item;
    }
  }

  return null;
};

const parseEventPayload = async () => {
  const eventPath = getEnv('GITHUB_EVENT_PATH');
  if (!eventPath) {
    return null;
  }
  try {
    const raw = await readFile(eventPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const readPackageVersion = async () => {
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  try {
    const raw = await readFile(packageJsonPath, 'utf8');
    const parsed = JSON.parse(raw);
    return typeof parsed?.version === 'string' && parsed.version.trim()
      ? parsed.version.trim()
      : '0.0.0';
  } catch {
    return '0.0.0';
  }
};

const setActionOutput = async (name, value) => {
  const outputPath = getEnv('GITHUB_OUTPUT');
  if (!outputPath) {
    return;
  }
  const text = String(value ?? '');
  const delimiter = `EOF_${name.toUpperCase().replace(/[^A-Z0-9_]/gu, '_')}_${Date.now()}`;
  await appendFile(outputPath, `${name}<<${delimiter}\n${text}\n${delimiter}\n`);
};

const appendStepSummary = async (markdown) => {
  const summaryPath = getEnv('GITHUB_STEP_SUMMARY');
  if (!summaryPath) {
    return;
  }
  await appendFile(summaryPath, `${markdown}\n`);
};

const setDistributionOutputs = async (distribution) => {
  await setActionOutput('skill-page-url', distribution.urls.skillPageUrl);
  await setActionOutput('entity-url', distribution.urls.entityUrl);
  await setActionOutput('docs-url', distribution.urls.docsUrl);
  await setActionOutput('openapi-url', distribution.urls.openapiUrl);
  await setActionOutput(
    'install-url-pinned-skill-md',
    distribution.urls.pinnedSkillMdUrl,
  );
  await setActionOutput(
    'install-url-latest-skill-md',
    distribution.urls.latestSkillMdUrl,
  );
  await setActionOutput(
    'install-url-pinned-manifest',
    distribution.urls.pinnedManifestUrl,
  );
  await setActionOutput(
    'install-url-latest-manifest',
    distribution.urls.latestManifestUrl,
  );
  await setActionOutput(
    'install-metadata-pinned-url',
    distribution.urls.installMetadataPinnedUrl,
  );
  await setActionOutput(
    'install-metadata-latest-url',
    distribution.urls.installMetadataLatestUrl,
  );
  await setActionOutput('badge-markdown', distribution.snippets.badgeMarkdown);
  await setActionOutput('badge-html', distribution.snippets.badgeHtml);
  await setActionOutput('markdown-link', distribution.snippets.markdownLink);
  await setActionOutput('html-link', distribution.snippets.htmlLink);
  await setActionOutput('readme-snippet', distribution.snippets.readmeSnippet);
  await setActionOutput('docs-snippet', distribution.snippets.docsSnippet);
  await setActionOutput('citation-snippet', distribution.snippets.citationSnippet);
  await setActionOutput('release-notes', distribution.snippets.releaseNotes);
  await setActionOutput('package-metadata-json', distribution.snippets.packageMetadataJson);
  await setActionOutput(
    'codemeta-json',
    JSON.stringify(distribution.machineReadable.codemeta, null, 2),
  );
  await setActionOutput('attested-kit-json', JSON.stringify(distribution, null, 2));
  await setActionOutput('next-actions', distribution.snippets.nextActions);
};

const getWorkflowRunUrl = () => {
  const serverUrl = getEnv('GITHUB_SERVER_URL', 'https://github.com');
  const repository = getEnv('GITHUB_REPOSITORY');
  const runId = getEnv('GITHUB_RUN_ID');
  if (!repository) {
    return '';
  }
  if (runId) {
    return `${serverUrl}/${repository}/actions/runs/${runId}`;
  }
  return `${serverUrl}/${repository}/actions`;
};

const getGitHubOidcToken = async () => {
  const requestUrl = getEnv('ACTIONS_ID_TOKEN_REQUEST_URL');
  const requestToken = getEnv('ACTIONS_ID_TOKEN_REQUEST_TOKEN');
  if (!requestUrl || !requestToken) {
    return '';
  }
  const response = await requestBearerJsonWithRetry({
    method: 'GET',
    url: requestUrl,
    token: requestToken,
    attempts: 3,
  });
  const token = typeof response?.value === 'string' ? response.value.trim() : '';
  if (!token) {
    throw new ActionError('GitHub OIDC token response did not include a token value.');
  }
  return token;
};

const uploadPreviewReport = async (params) => {
  const oidcToken = await getGitHubOidcToken();
  if (!oidcToken) {
    return null;
  }
  return requestBearerJsonWithRetry({
    method: 'POST',
    url: buildApiUrl(params.apiBaseUrl, '/skills/preview/github-oidc'),
    token: oidcToken,
    body: params.report,
    attempts: 3,
  });
};

const maybeSubmitIndexNow = async (distribution, enabled) => {
  if (!enabled) {
    return null;
  }
  return submitToIndexNow(distribution.indexing.urls);
};

const githubApiRequest = async (params) => {
  const { method, endpoint, token, body, accept } = params;
  const apiBaseUrl = getEnv('GITHUB_API_URL', 'https://api.github.com');
  const url = `${apiBaseUrl}${endpoint}`;
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: accept ?? 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const details = await summarizeErrorBody(response);
    throw new ActionError(
      `GitHub API ${method} ${endpoint} failed with ${response.status}${details ? `: ${details}` : ''}`,
    );
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
};

const buildPublishMarkdown = (result) => {
  const lines = [];
  lines.push('### HCS-26 skill publish result');
  lines.push('');
  lines.push(`- Status: \`${result.published === false ? 'skipped' : 'published'}\``);
  lines.push(`- Name: \`${result.skillName}\``);
  lines.push(`- Version: \`${result.skillVersion}\``);
  lines.push(`- Quote ID: \`${result.quoteId || 'n/a'}\``);
  lines.push(`- Job ID: \`${result.jobId || 'n/a'}\``);
  lines.push(`- Directory Topic: \`${result.directoryTopicId ?? 'n/a'}\``);
  lines.push(`- Package Topic: \`${result.packageTopicId ?? 'n/a'}\``);
  lines.push(`- skill.json HRL: \`${result.skillJsonHrl ?? 'n/a'}\``);
  lines.push(`- Credits: \`${result.credits ?? 0}\``);
  lines.push(`- Estimated Cost: \`${result.estimatedCostHbar ?? '0'} HBAR\``);
  if (Array.isArray(result.excludedFiles) && result.excludedFiles.length > 0) {
    lines.push(`- Excluded paths: \`${result.excludedFiles.length}\``);
  }
  if (result.published === false && result.skippedReason) {
    lines.push(`- Skip reason: \`${result.skippedReason}\``);
  }
  lines.push('');
  lines.push(`- Repo: \`${result.repoUrl ?? 'n/a'}\``);
  lines.push(`- Commit: \`${result.commitSha ?? 'n/a'}\``);
  if (result.distribution) {
    lines.push('');
    lines.push(`- Skill page: ${result.distribution.urls.skillPageUrl}`);
    lines.push(`- Pinned SKILL.md: ${result.distribution.urls.pinnedSkillMdUrl}`);
    lines.push(`- Latest SKILL.md: ${result.distribution.urls.latestSkillMdUrl}`);
    lines.push(`- Badge: ${result.distribution.snippets.badgeMarkdown}`);
    lines.push('');
    lines.push(result.distribution.snippets.nextActions);
  }
  return lines.join('\n');
};

const buildDistribution = (apiBaseUrl, name, version, skillJson = {}) =>
  buildDistributionKit({
    apiBaseUrl,
    name,
    version,
    style: 'for-the-badge',
    metric: 'version',
    label: name,
    skillJson,
  });

const annotateResult = async (params) => {
  const {
    shouldAnnotate,
    token,
    markdown,
    jobId,
    eventPayload,
  } = params;
  if (!shouldAnnotate || !token) {
    return 'none';
  }

  const repository = getEnv('GITHUB_REPOSITORY');
  if (!repository || !repository.includes('/')) {
    return 'none';
  }
  const [owner, repo] = repository.split('/');
  const eventName = getEnv('GITHUB_EVENT_NAME');
  const marker = `<!-- skills-publish:${jobId} -->`;
  const content = `${marker}\n${markdown}`;

  if (eventName === 'release' && eventPayload?.release?.id) {
    const releaseId = Number(eventPayload.release.id);
    const existingBody = typeof eventPayload.release.body === 'string' ? eventPayload.release.body : '';
    if (existingBody.includes(marker)) {
      return `release:${releaseId}`;
    }
    const mergedBody = existingBody.trim().length > 0
      ? `${existingBody}\n\n${content}`
      : content;
    await githubApiRequest({
      method: 'PATCH',
      endpoint: `/repos/${owner}/${repo}/releases/${releaseId}`,
      token,
      body: { body: mergedBody },
    });
    return `release:${releaseId}`;
  }

  if (eventName === 'push') {
    const sha = getEnv('GITHUB_SHA');
    if (!sha) {
      return 'none';
    }
    const pulls = await githubApiRequest({
      method: 'GET',
      endpoint: `/repos/${owner}/${repo}/commits/${sha}/pulls`,
      token,
      accept: 'application/vnd.github+json',
    });
    if (!Array.isArray(pulls) || pulls.length === 0) {
      return 'none';
    }
    const pull = pulls[0];
    const pullNumber = typeof pull?.number === 'number' ? pull.number : null;
    if (!pullNumber) {
      return 'none';
    }
    await githubApiRequest({
      method: 'POST',
      endpoint: `/repos/${owner}/${repo}/issues/${pullNumber}/comments`,
      token,
      body: { body: content },
    });
    return `pr:${pullNumber}`;
  }

  return 'none';
};

const run = async () => {
  const apiBaseUrl = normalizeApiBaseUrl(getEnv('INPUT_API_BASE_URL'));
  const apiKey = getEnv('INPUT_API_KEY');
  const accountId = getEnv('INPUT_ACCOUNT_ID');
  const skillDirInput = getEnv('INPUT_SKILL_DIR');
  const overrideName = getEnv('INPUT_NAME');
  const overrideVersion = getEnv('INPUT_VERSION');
  const allowNonstableProductionVersion = toBoolean(
    getEnv('INPUT_ALLOW_NONSTABLE_PRODUCTION_VERSION'),
    false,
  );
  const stampRepoCommit = toBoolean(getEnv('INPUT_STAMP_REPO_COMMIT'), true);
  const pollTimeoutMs = parseNumber(getEnv('INPUT_POLL_TIMEOUT_MS'), 720000);
  const pollIntervalMs = parseNumber(getEnv('INPUT_POLL_INTERVAL_MS'), 4000);
  const shouldAnnotate = toBoolean(getEnv('INPUT_ANNOTATE'), true);
  const shouldUploadPreview = toBoolean(getEnv('INPUT_PREVIEW_UPLOAD'), true);
  const shouldSubmitIndexNow = toBoolean(getEnv('INPUT_SUBMIT_INDEXNOW'), false);
  const githubToken = getEnv('INPUT_GITHUB_TOKEN');
  const mode = String(getEnv('INPUT_MODE', 'publish')).trim().toLowerCase() || 'publish';
  const jsonOutput = toBoolean(getEnv('INPUT_JSON'), false);
  const log = (message) => {
    if (!jsonOutput) {
      stdout(message);
    }
  };

  if (!['publish', 'validate', 'quote'].includes(mode)) {
    throw new ActionError(`Unsupported mode: ${mode}`);
  }
  if ((mode === 'publish' || mode === 'quote') && !apiKey) {
    throw new ActionError('Missing api-key input. Configure RB_API_KEY in repository secrets.');
  }
  if (!skillDirInput) {
    throw new ActionError('Missing skill-dir input.');
  }

  const skillDir = path.resolve(process.cwd(), skillDirInput);
  const skillDirStat = await stat(skillDir).catch(() => null);
  if (!skillDirStat || !skillDirStat.isDirectory()) {
    throw new ActionError(`Skill directory not found: ${skillDirInput}`);
  }

  const { includedFiles: discoveredFiles, excludedFiles } = await discoverSkillPackageFiles(skillDir);
  const relativePaths = discoveredFiles.map(item => item.relativePath);
  if (!relativePaths.includes('skill.json')) {
    throw new ActionError(`Missing required file: ${path.posix.join(skillDirInput, 'skill.json')}`);
  }
  if (!relativePaths.includes('SKILL.md')) {
    throw new ActionError(`Missing required file: ${path.posix.join(skillDirInput, 'SKILL.md')}`);
  }

  const skillJsonAbsolutePath = path.join(skillDir, 'skill.json');
  const rawSkillJson = await readFile(skillJsonAbsolutePath, 'utf8');
  let parsedSkillJson;
  try {
    parsedSkillJson = JSON.parse(rawSkillJson);
  } catch (error) {
    throw new ActionError(`skill.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof parsedSkillJson !== 'object' || parsedSkillJson === null || Array.isArray(parsedSkillJson)) {
    throw new ActionError('skill.json must be a JSON object.');
  }

  if (overrideName) {
    parsedSkillJson.name = overrideName;
  }
  if (overrideVersion) {
    parsedSkillJson.version = overrideVersion;
  }

  const repository = getEnv('GITHUB_REPOSITORY');
  const serverUrl = getEnv('GITHUB_SERVER_URL', 'https://github.com');
  const commitSha = getEnv('GITHUB_SHA');
  const gitRef = getEnv('GITHUB_REF');
  const eventName = getEnv('GITHUB_EVENT_NAME');
  const repoUrl = repository ? `${serverUrl}/${repository}` : '';

  if (stampRepoCommit) {
    if (repoUrl) {
      parsedSkillJson.repo = repoUrl;
      if (
        typeof parsedSkillJson.metadata === 'object' &&
        parsedSkillJson.metadata !== null &&
        !Array.isArray(parsedSkillJson.metadata)
      ) {
        parsedSkillJson.metadata.repo = repoUrl;
      }
    }
    if (commitSha) {
      parsedSkillJson.commit = commitSha;
      if (
        typeof parsedSkillJson.metadata === 'object' &&
        parsedSkillJson.metadata !== null &&
        !Array.isArray(parsedSkillJson.metadata)
      ) {
        parsedSkillJson.metadata.commit = commitSha;
      }
    }
  }

  const skillName = String(parsedSkillJson.name ?? '').trim();
  const skillVersion = String(parsedSkillJson.version ?? '').trim();
  const skillDescription = String(parsedSkillJson.description ?? '').trim();
  if (!skillName) {
    throw new ActionError('skill.json must include name.');
  }
  if (!skillVersion) {
    throw new ActionError('skill.json must include version.');
  }
  if (!skillDescription) {
    throw new ActionError('skill.json must include description.');
  }
  const nonstableVersion = !isStableRegistryVersion(skillVersion);
  if (
    nonstableVersion &&
    isProductionRegistryBase(apiBaseUrl) &&
    !allowNonstableProductionVersion
  ) {
    throw new ActionError(
      `Refusing to publish ${skillName}@${skillVersion} to the production registry because it is not a stable release version. Use staging instead, or set allow-nonstable-production-version=true if this is intentional.`,
    );
  }
  if (nonstableVersion) {
    stderr(
      `Publishing ${skillName}@${skillVersion} as a custom prerelease version. The registry will not use this release as the public stable default unless it is explicitly recommended.`,
    );
  }

  if (mode === 'publish') {
    const existingVersion = await findExistingSkillVersion({
      apiBaseUrl,
      apiKey,
      name: skillName,
      version: skillVersion,
    });

    if (existingVersion) {
      const result = {
        skillName,
        skillVersion,
        quoteId: '',
        jobId: '',
        directoryTopicId:
          typeof existingVersion.directoryTopicId === 'string'
            ? existingVersion.directoryTopicId
            : null,
        packageTopicId:
          typeof existingVersion.packageTopicId === 'string'
            ? existingVersion.packageTopicId
            : typeof existingVersion.versionRegistryTopicId === 'string'
              ? existingVersion.versionRegistryTopicId
              : null,
        skillJsonHrl:
          typeof existingVersion.skillJsonHrl === 'string'
            ? existingVersion.skillJsonHrl
            : typeof existingVersion.manifestHrl === 'string'
              ? existingVersion.manifestHrl
              : null,
        credits: 0,
        estimatedCostHbar: '0',
        repoUrl: repoUrl || null,
        commitSha: commitSha || null,
        excludedFiles,
        published: false,
        skippedReason: 'version-exists',
        distribution: buildDistribution(apiBaseUrl, skillName, skillVersion, parsedSkillJson),
      };

      log(`Skill version ${skillName}@${skillVersion} already exists. Skipping publish.`);

      const markdown = buildPublishMarkdown(result);
      await appendStepSummary(markdown);

      await setActionOutput('published', 'false');
      await setActionOutput('skip-reason', result.skippedReason);
      await setActionOutput('skill-name', result.skillName);
      await setActionOutput('skill-version', result.skillVersion);
      await setActionOutput('preview-json', '');
      await setActionOutput('preview-json-path', '');
      await setActionOutput('status-url', result.distribution.urls.skillPageUrl);
      await setActionOutput('quote-id', '');
      await setActionOutput('job-id', '');
      await setActionOutput('directory-topic-id', result.directoryTopicId ?? '');
      await setActionOutput('package-topic-id', result.packageTopicId ?? '');
      await setActionOutput('skill-json-hrl', result.skillJsonHrl ?? '');
      await setActionOutput('credits', '0');
      await setActionOutput('estimated-cost-hbar', '0');
      await setActionOutput('annotation-target', 'none');
      const indexNowResult = await maybeSubmitIndexNow(
        result.distribution,
        shouldSubmitIndexNow,
      );
      await setActionOutput(
        'indexnow-result',
        indexNowResult ? JSON.stringify(indexNowResult, null, 2) : '',
      );
      await setDistributionOutputs(result.distribution);
      await setActionOutput('result-json', JSON.stringify(result, null, 2));

      if (jsonOutput) {
        printJson(result);
      } else {
        stdout(markdown);
      }
      return;
    }
  }

  let maxFiles = 0;
  let maxTotalSizeBytes = 0;
  let allowedMimeTypes = null;
  if (mode === 'publish' || mode === 'quote') {
    const config = await requestJsonWithRetry({
      method: 'GET',
      url: buildApiUrl(apiBaseUrl, '/skills/config'),
      apiKey,
      attempts: 3,
    });
    maxFiles = Number(config?.maxFiles ?? 0);
    maxTotalSizeBytes = Number(config?.maxTotalSizeBytes ?? 0);
    allowedMimeTypes = Array.isArray(config?.allowedMimeTypes)
      ? new Set(config.allowedMimeTypes.map(value => String(value)))
      : null;
  }

  if (maxFiles > 0 && discoveredFiles.length > maxFiles) {
    throw new ActionError(`Skill package has ${discoveredFiles.length} files but maxFiles is ${maxFiles}.`);
  }

  let totalBytes = 0;
  const files = [];
  const previewFiles = [];
  const rewrittenSkillJsonBuffer = Buffer.from(`${JSON.stringify(parsedSkillJson, null, 2)}\n`, 'utf8');
  for (const file of discoveredFiles) {
    const bodyBuffer =
      file.relativePath === 'skill.json'
        ? rewrittenSkillJsonBuffer
        : await readFile(file.absolutePath);
    totalBytes += bodyBuffer.byteLength;
    const mimeType = guessMimeType(file.relativePath);
    if (allowedMimeTypes && !allowedMimeTypes.has(mimeType)) {
      throw new ActionError(`Unsupported mime type for ${file.relativePath}: ${mimeType}`);
    }
    files.push({
      name: file.relativePath,
      base64: bodyBuffer.toString('base64'),
      mimeType,
      role: resolveRole(file.relativePath),
    });
    previewFiles.push({
      name: file.relativePath,
      mimeType,
      role: resolveRole(file.relativePath),
      sizeBytes: bodyBuffer.byteLength,
    });
  }

  if (maxTotalSizeBytes > 0 && totalBytes > maxTotalSizeBytes) {
    throw new ActionError(`Skill package is ${totalBytes} bytes but maxTotalSizeBytes is ${maxTotalSizeBytes}.`);
  }

  const validationResult = {
    mode: 'validate',
    skillName,
    skillVersion,
    skillDir: skillDirInput,
    files: files.length,
    excludedFiles,
    totalBytes,
    valid: true,
  };

  log(`Validated skill package ${skillName}@${skillVersion} from ${skillDirInput}`);
  log(`Files: ${files.length}, Total bytes: ${totalBytes}`);
  if (excludedFiles.length > 0) {
    log(
      `Excluded ${excludedFiles.length} path${excludedFiles.length === 1 ? '' : 's'} from package discovery.`,
    );
  }

  if (mode === 'validate') {
    const distribution = buildDistribution(apiBaseUrl, skillName, skillVersion, parsedSkillJson);
    const previewReport = buildSkillPreviewReport({
      toolVersion: await readPackageVersion(),
      repository,
      repoUrl,
      commitSha,
      ref: gitRef,
      eventName,
      workflowRunUrl: getWorkflowRunUrl(),
      skillDir: skillDirInput,
      skillName,
      skillVersion,
      generatedAt: new Date().toISOString(),
      eventPayload: await parseEventPayload(),
      files: previewFiles,
      excludedFiles,
      totalBytes,
    });
    const previewJsonPath = await writeSkillPreviewReport({
      workspaceDir: process.cwd(),
      report: previewReport,
    });
    const uploadedPreview =
      shouldUploadPreview && getEnv('GITHUB_ACTIONS') !== 'false'
        ? await uploadPreviewReport({
            apiBaseUrl,
            report: previewReport,
          }).catch((error) => {
            stderr(
              `Preview upload failed: ${error instanceof Error ? error.message : String(error)}`,
            );
            return null;
          })
        : null;
    validationResult.distribution = distribution;
    await setActionOutput('published', 'false');
    await setActionOutput('skip-reason', 'validation-only');
    await setActionOutput('skill-name', skillName);
    await setActionOutput('skill-version', skillVersion);
    await setActionOutput('preview-json', JSON.stringify(previewReport, null, 2));
    await setActionOutput('preview-json-path', previewJsonPath);
    await setActionOutput('status-url', uploadedPreview?.statusUrl ?? '');
    await setActionOutput('quote-id', '');
    await setActionOutput('job-id', '');
    await setActionOutput('directory-topic-id', '');
    await setActionOutput('package-topic-id', '');
    await setActionOutput('skill-json-hrl', '');
    await setActionOutput('credits', '0');
    await setActionOutput('estimated-cost-hbar', '0');
    await setActionOutput('annotation-target', 'none');
    await setActionOutput('indexnow-result', '');
    await setDistributionOutputs(distribution);
    await setActionOutput('next-actions', formatPreviewNextActions(previewReport));
    await setActionOutput('result-json', JSON.stringify(validationResult, null, 2));
    if (jsonOutput) {
      printJson({
        ...validationResult,
        preview: {
          report: previewReport,
          path: previewJsonPath,
          statusUrl: uploadedPreview?.statusUrl ?? '',
        },
      });
    } else {
      stdout(`Validation complete for ${skillName}@${skillVersion}.`);
    }
    return;
  }

  const quote = await requestJsonWithRetry({
    method: 'POST',
    url: buildApiUrl(apiBaseUrl, '/skills/quote'),
    apiKey,
    body: {
      files,
      ...(accountId ? { accountId } : {}),
    },
    attempts: 3,
  });

  const quoteId = String(quote?.quoteId ?? '').trim();
  if (!quoteId) {
    throw new ActionError('Quote response did not include quoteId.');
  }

  const quoteResult = {
    mode: 'quote',
    skillName,
    skillVersion,
    quoteId,
    credits: Number(quote?.credits ?? 0),
    estimatedCostHbar: String(quote?.estimatedCostHbar ?? ''),
    files: files.length,
    excludedFiles,
    totalBytes,
  };

  log(`Quote complete: ${quoteId} (${quote.credits} credits, ${quote.estimatedCostHbar} HBAR est)`);

  if (mode === 'quote') {
    const distribution = buildDistribution(apiBaseUrl, skillName, skillVersion, parsedSkillJson);
    quoteResult.distribution = distribution;
    await setActionOutput('published', 'false');
    await setActionOutput('skip-reason', 'quote-only');
    await setActionOutput('skill-name', skillName);
    await setActionOutput('skill-version', skillVersion);
    await setActionOutput('preview-json', '');
    await setActionOutput('preview-json-path', '');
    await setActionOutput('status-url', distribution.urls.skillPageUrl);
    await setActionOutput('quote-id', quoteId);
    await setActionOutput('job-id', '');
    await setActionOutput('directory-topic-id', '');
    await setActionOutput('package-topic-id', '');
    await setActionOutput('skill-json-hrl', '');
    await setActionOutput('credits', String(quoteResult.credits));
    await setActionOutput('estimated-cost-hbar', quoteResult.estimatedCostHbar);
    await setActionOutput('annotation-target', 'none');
    await setActionOutput('indexnow-result', '');
    await setDistributionOutputs(distribution);
    await setActionOutput('result-json', JSON.stringify(quoteResult, null, 2));
    if (jsonOutput) {
      printJson(quoteResult);
    } else {
      stdout(
        `Quote summary: ${quoteResult.credits} credits, ${quoteResult.estimatedCostHbar} HBAR est (${quoteResult.files} files).`,
      );
    }
    return;
  }

  const publish = await requestJson({
    method: 'POST',
    url: buildApiUrl(apiBaseUrl, '/skills/publish'),
    apiKey,
    body: {
      files,
      quoteId,
      ...(accountId ? { accountId } : {}),
    },
  });

  const jobId = String(publish?.jobId ?? '').trim();
  if (!jobId) {
    throw new ActionError('Publish response did not include jobId.');
  }

  log(`Publish started: job ${jobId}`);

  const startedAt = Date.now();
  let lastStatus = '';
  let completedJob = null;
  while (Date.now() - startedAt < pollTimeoutMs) {
    const job = await requestJsonWithRetry({
      method: 'GET',
      url: buildApiUrl(apiBaseUrl, `/skills/jobs/${encodeURIComponent(jobId)}`, accountId ? { accountId } : null),
      apiKey,
      attempts: 3,
    });
    const status = String(job?.status ?? '').trim();
    if (status && status !== lastStatus) {
      log(`Job status: ${status}`);
      lastStatus = status;
    }
    if (status === 'completed') {
      completedJob = job;
      break;
    }
    if (status === 'failed') {
      throw new ActionError(`Publish job failed: ${String(job?.failureReason ?? 'unknown reason')}`);
    }
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  if (!completedJob) {
    throw new ActionError(`Publish job ${jobId} did not complete within ${pollTimeoutMs}ms.`);
  }

  const result = {
    skillName: String(completedJob.name ?? skillName),
    skillVersion: String(completedJob.version ?? skillVersion),
    quoteId,
    jobId,
    directoryTopicId: completedJob.directoryTopicId ?? null,
    packageTopicId: completedJob.packageTopicId ?? null,
    skillJsonHrl: completedJob.skillJsonHrl ?? null,
    credits: Number(quote?.credits ?? 0),
    estimatedCostHbar: String(quote?.estimatedCostHbar ?? ''),
    repoUrl: repoUrl || null,
    commitSha: commitSha || null,
    excludedFiles,
  };
  result.distribution = buildDistribution(
    apiBaseUrl,
    result.skillName,
    result.skillVersion,
    parsedSkillJson,
  );

  const markdown = buildPublishMarkdown(result);
  const eventPayload = await parseEventPayload();
  const annotationTarget = await annotateResult({
    shouldAnnotate,
    token: githubToken,
    markdown,
    jobId,
    eventPayload,
  }).catch(error => {
    stderr(`Annotation failed: ${error instanceof Error ? error.message : String(error)}`);
    return 'failed';
  });

  await appendStepSummary(markdown);

  await setActionOutput('published', 'true');
  await setActionOutput('skip-reason', '');
  await setActionOutput('skill-name', result.skillName);
  await setActionOutput('skill-version', result.skillVersion);
  await setActionOutput('preview-json', '');
  await setActionOutput('preview-json-path', '');
  await setActionOutput('status-url', result.distribution.urls.skillPageUrl);
  await setActionOutput('quote-id', result.quoteId);
  await setActionOutput('job-id', result.jobId);
  await setActionOutput('directory-topic-id', result.directoryTopicId ?? '');
  await setActionOutput('package-topic-id', result.packageTopicId ?? '');
  await setActionOutput('skill-json-hrl', result.skillJsonHrl ?? '');
  await setActionOutput('credits', String(result.credits ?? 0));
  await setActionOutput('estimated-cost-hbar', String(result.estimatedCostHbar ?? ''));
  await setActionOutput('annotation-target', annotationTarget);
  const indexNowResult = await maybeSubmitIndexNow(
    result.distribution,
    shouldSubmitIndexNow,
  );
  await setActionOutput(
    'indexnow-result',
    indexNowResult ? JSON.stringify(indexNowResult, null, 2) : '',
  );
  await setDistributionOutputs(result.distribution);
  await setActionOutput('result-json', JSON.stringify(result, null, 2));

  if (jsonOutput) {
    printJson({
      ...result,
      annotationTarget,
      published: true,
    });
  } else {
    stdout(markdown);
  }
};

run().catch(async error => {
  const message = error instanceof Error ? error.message : String(error);
  stderr(`Error: ${message}`);
  const outputPath = getEnv('GITHUB_OUTPUT');
  if (outputPath) {
    await setActionOutput('preview-json', '');
    await setActionOutput('preview-json-path', '');
    await setActionOutput('status-url', '');
    await setActionOutput('annotation-target', 'failed');
  }
  process.exit(1);
});
