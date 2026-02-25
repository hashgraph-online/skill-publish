import { readFile, readdir, stat, appendFile } from 'node:fs/promises';
import path from 'node:path';

const stdout = (message) => process.stdout.write(`${message}\n`);
const stderr = (message) => process.stderr.write(`${message}\n`);

class ActionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ActionError';
  }
}

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

const DEFAULT_API_BASE_URL = 'https://hol.org/registry/api/v1';

const normalizeApiBaseUrl = (value) => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return DEFAULT_API_BASE_URL;
  }
  const withoutTrailingSlash = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
  if (withoutTrailingSlash.endsWith('/api/v1')) {
    return withoutTrailingSlash;
  }
  if (withoutTrailingSlash.endsWith('/registry')) {
    return `${withoutTrailingSlash}/api/v1`;
  }
  return `${withoutTrailingSlash}/api/v1`;
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

const walkFiles = async (rootDir, relativeDir = '') => {
  const fullDir = relativeDir ? path.join(rootDir, relativeDir) : rootDir;
  const entries = await readdir(fullDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === '.git') {
      continue;
    }
    const childRelative = relativeDir
      ? path.posix.join(relativeDir, entry.name)
      : entry.name;
    const childFullPath = path.join(rootDir, childRelative);
    if (entry.isDirectory()) {
      const nested = await walkFiles(rootDir, childRelative);
      files.push(...nested);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    files.push({ relativePath: childRelative, absolutePath: childFullPath });
  }

  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
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

const requestJson = async (params) => {
  const {
    method,
    url,
    apiKey,
    body,
    signal,
  } = params;
  const response = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal,
  });
  if (!response.ok) {
    const bodySummary = await summarizeErrorBody(response);
    throw new ActionError(
      `${method} ${url} failed with ${response.status}${bodySummary ? `: ${bodySummary}` : ''}`,
    );
  }
  return response.json();
};

const findExistingSkillVersion = async (params) => {
  const { apiBaseUrl, apiKey, name, version } = params;
  const response = await requestJson({
    method: 'GET',
    url: buildApiUrl(apiBaseUrl, '/skills/list', {
      name,
      version,
      limit: 20,
    }),
    apiKey,
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
  if (result.published === false && result.skippedReason) {
    lines.push(`- Skip reason: \`${result.skippedReason}\``);
  }
  lines.push('');
  lines.push(`- Repo: \`${result.repoUrl ?? 'n/a'}\``);
  lines.push(`- Commit: \`${result.commitSha ?? 'n/a'}\``);
  return lines.join('\n');
};

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
  const stampRepoCommit = toBoolean(getEnv('INPUT_STAMP_REPO_COMMIT'), true);
  const pollTimeoutMs = parseNumber(getEnv('INPUT_POLL_TIMEOUT_MS'), 720000);
  const pollIntervalMs = parseNumber(getEnv('INPUT_POLL_INTERVAL_MS'), 4000);
  const shouldAnnotate = toBoolean(getEnv('INPUT_ANNOTATE'), true);
  const githubToken = getEnv('INPUT_GITHUB_TOKEN');

  if (!apiKey) {
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

  const discoveredFiles = await walkFiles(skillDir);
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
      published: false,
      skippedReason: 'version-exists',
    };

    stdout(`Skill version ${skillName}@${skillVersion} already exists. Skipping publish.`);

    const markdown = buildPublishMarkdown(result);
    await appendStepSummary(markdown);

    await setActionOutput('skill-name', result.skillName);
    await setActionOutput('skill-version', result.skillVersion);
    await setActionOutput('quote-id', '');
    await setActionOutput('job-id', '');
    await setActionOutput('directory-topic-id', result.directoryTopicId ?? '');
    await setActionOutput('package-topic-id', result.packageTopicId ?? '');
    await setActionOutput('skill-json-hrl', result.skillJsonHrl ?? '');
    await setActionOutput('annotation-target', 'none');
    await setActionOutput('result-json', JSON.stringify(result, null, 2));

    stdout(markdown);
    return;
  }

  const config = await requestJson({
    method: 'GET',
    url: buildApiUrl(apiBaseUrl, '/skills/config'),
    apiKey,
  });
  const maxFiles = Number(config?.maxFiles ?? 0);
  const maxTotalSizeBytes = Number(config?.maxTotalSizeBytes ?? 0);
  const allowedMimeTypes = Array.isArray(config?.allowedMimeTypes)
    ? new Set(config.allowedMimeTypes.map(value => String(value)))
    : null;

  if (maxFiles > 0 && discoveredFiles.length > maxFiles) {
    throw new ActionError(`Skill package has ${discoveredFiles.length} files but maxFiles is ${maxFiles}.`);
  }

  let totalBytes = 0;
  const files = [];
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
  }

  if (maxTotalSizeBytes > 0 && totalBytes > maxTotalSizeBytes) {
    throw new ActionError(`Skill package is ${totalBytes} bytes but maxTotalSizeBytes is ${maxTotalSizeBytes}.`);
  }

  stdout(`Validated skill package ${skillName}@${skillVersion} from ${skillDirInput}`);
  stdout(`Files: ${files.length}, Total bytes: ${totalBytes}`);

  const quote = await requestJson({
    method: 'POST',
    url: buildApiUrl(apiBaseUrl, '/skills/quote'),
    apiKey,
    body: {
      files,
      ...(accountId ? { accountId } : {}),
    },
  });

  const quoteId = String(quote?.quoteId ?? '').trim();
  if (!quoteId) {
    throw new ActionError('Quote response did not include quoteId.');
  }

  stdout(`Quote complete: ${quoteId} (${quote.credits} credits, ${quote.estimatedCostHbar} HBAR est)`);

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

  stdout(`Publish started: job ${jobId}`);

  const startedAt = Date.now();
  let lastStatus = '';
  let completedJob = null;
  while (Date.now() - startedAt < pollTimeoutMs) {
    const job = await requestJson({
      method: 'GET',
      url: buildApiUrl(apiBaseUrl, `/skills/jobs/${encodeURIComponent(jobId)}`, accountId ? { accountId } : null),
      apiKey,
    });
    const status = String(job?.status ?? '').trim();
    if (status && status !== lastStatus) {
      stdout(`Job status: ${status}`);
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
  };

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

  await setActionOutput('skill-name', result.skillName);
  await setActionOutput('skill-version', result.skillVersion);
  await setActionOutput('quote-id', result.quoteId);
  await setActionOutput('job-id', result.jobId);
  await setActionOutput('directory-topic-id', result.directoryTopicId ?? '');
  await setActionOutput('package-topic-id', result.packageTopicId ?? '');
  await setActionOutput('skill-json-hrl', result.skillJsonHrl ?? '');
  await setActionOutput('annotation-target', annotationTarget);
  await setActionOutput('result-json', JSON.stringify(result, null, 2));

  stdout(markdown);
};

run().catch(async error => {
  const message = error instanceof Error ? error.message : String(error);
  stderr(`Error: ${message}`);
  const outputPath = getEnv('GITHUB_OUTPUT');
  if (outputPath) {
    await setActionOutput('annotation-target', 'failed');
  }
  process.exit(1);
});
