import { readFile, stat, appendFile } from 'node:fs/promises';
import path from 'node:path';
import {
  fetchSkillPublishJob,
  fetchSkillQuotePreview,
  fetchSkillStatusByRepo,
  fetchSkillsConfig,
  listSkillReleases,
  publishSkill as publishSkillRequest,
  quoteSkillPublish as quoteSkillPublishRequest,
} from './bin/lib/broker-api.mjs';
import { buildDistributionKit, normalizeApiBaseUrl } from './bin/lib/distribution-kit.mjs';
import { buildHcs28Fallback, computeHcs28TrustPreview } from './bin/lib/hcs-28.mjs';
import { submitToIndexNow } from './bin/lib/indexnow.mjs';
import { discoverSkillPackageFiles } from './bin/lib/package-files.mjs';
import { writeSkillPreviewReport } from './bin/lib/preview-output.mjs';
import {
  buildSkillPreviewReport,
  formatPreviewNextActions,
} from './bin/lib/preview-report.mjs';
import {
  readSkillPackageState,
  resolveSkillPackageMetadata,
} from './bin/lib/skill-package.mjs';
import {
  buildManagedCommentBody,
  buildManagedCommentMarker,
  buildPreviewCommentMetadata,
  buildManagedCommentStateSignature,
  extractManagedCommentMetadata,
  extractManagedCommentState,
  shouldPublishManagedComment,
} from './bin/lib/managed-comments.mjs';
import {
  buildPublishCommentMarker,
  buildReleaseBlockMarker,
  buildStateSignature,
  decodeCommentMetadata,
  encodeCommentMetadata,
} from './bin/lib/comment-metadata.mjs';
import {
  renderPublishComment,
  renderReleaseBlock,
} from './bin/lib/comment-renderer.mjs';
import {
  createAnnotationResult,
  createGitHubApiRequest,
  findExistingCommentByMarker,
  listIssueComments,
  resolveAssociatedPullRequest,
  upsertIssueComment,
  upsertReleaseBodyBlock,
} from './bin/lib/github-annotations.mjs';
import { normalizeText } from './bin/lib/text-utils.mjs';

const stdout = (message) => process.stdout.write(`${message}\n`);
const stderr = (message) => process.stderr.write(`${message}\n`);
const printJson = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
const packageJsonPath = new URL('./package.json', import.meta.url);
let cachedToolVersion = null;

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

const getToolVersion = async () => {
  if (cachedToolVersion) {
    return cachedToolVersion;
  }
  try {
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
    const version = String(packageJson?.version ?? '').trim();
    cachedToolVersion = version || '0.0.0';
  } catch {
    cachedToolVersion = '0.0.0';
  }
  return cachedToolVersion;
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

const executeWithRetry = async (params) => {
  const attempts =
    Number.isFinite(params.attempts) && params.attempts > 0
      ? Math.floor(params.attempts)
      : 1;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await params.operation();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetryableRequestError(error)) {
        throw error;
      }
      const delayMs = Math.min(10_000, 1_000 * attempt);
      stderr(
        `Transient request failure on ${params.label}; retrying in ${delayMs}ms (retry ${attempt}/${attempts - 1}).`,
      );
      await sleep(delayMs);
    }
  }
  throw lastError instanceof Error ? lastError : new ActionError('Request failed');
};

const findExistingSkillVersion = async (params) => {
  const { apiBaseUrl, apiKey, accountId, name, version } = params;
  const response = await executeWithRetry({
    label: 'GET /skills',
    attempts: 3,
    operation: () =>
      listSkillReleases({
        baseUrl: apiBaseUrl,
        apiKey,
        accountId,
        query: {
          name,
          version,
          limit: 20,
        },
      }),
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

const normalizeMarkerSegment = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');

const buildDefaultManagedCommentGroupKey = (params) => {
  const repositorySegment = normalizeMarkerSegment(
    String(params.repository ?? '').replace(/\//gu, '-'),
  );
  const skillSegment =
    normalizeMarkerSegment(params.skillName) ||
    normalizeMarkerSegment(params.skillDir) ||
    'skill';
  const prNumber = Number(params.pullNumber);
  if (Number.isFinite(prNumber) && prNumber > 0) {
    return `pr-${prNumber}-${skillSegment}`;
  }
  if (repositorySegment) {
    return `${repositorySegment}-${skillSegment}`;
  }
  return skillSegment || 'default';
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

const getWorkflowRunUrl = () => {
  const repository = getEnv('GITHUB_REPOSITORY');
  const serverUrl = getEnv('GITHUB_SERVER_URL', 'https://github.com');
  const runId = getEnv('GITHUB_RUN_ID');
  if (!repository) {
    return '';
  }
  if (runId) {
    return `${serverUrl}/${repository}/actions/runs/${runId}`;
  }
  return `${serverUrl}/${repository}/actions`;
};

const normalizeSkillDirCandidate = (value) => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return '';
  }
  const normalized = trimmed.replace(/\\/gu, '/').replace(/\/+$/u, '');
  if (!normalized || normalized === '.') {
    return '.';
  }
  return normalized.replace(/^\.\/+/u, '');
};

const isStagedPackageDirectory = (value) => {
  const normalized = normalizeSkillDirCandidate(value);
  if (!normalized) {
    return false;
  }
  return /(^|\/)publish-package-[^/]+/u.test(normalized);
};

const parseVerificationSignal = (value) => {
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.ok === 'boolean') {
    return value.ok;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return null;
};

const mergeVerificationSignals = (...values) => {
  let sawFalse = false;
  for (const value of values) {
    const parsed = parseVerificationSignal(value);
    if (parsed === true) {
      return true;
    }
    if (parsed === false) {
      sawFalse = true;
    }
  }
  return sawFalse ? false : null;
};

const tryFetchStatusByRepo = async (params) => {
  const skillDir = normalizeSkillDirCandidate(params.skillDir);
  if (!params.repoUrl || !skillDir || path.isAbsolute(skillDir)) {
    return null;
  }
  try {
    return await executeWithRetry({
      label: 'GET /skills/status/by-repo',
      attempts: 1,
      operation: () =>
        fetchSkillStatusByRepo({
          baseUrl: params.apiBaseUrl,
          repoUrl: params.repoUrl,
          skillDir,
          ...(params.ref ? { ref: params.ref } : {}),
        }),
    });
  } catch {
    return null;
  }
};

const getTrustTierPriority = (value) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'verified') {
    return 4;
  }
  if (normalized === 'published') {
    return 3;
  }
  if (normalized === 'validated') {
    return 2;
  }
  if (normalized === 'unclaimed') {
    return 1;
  }
  return 0;
};

const scoreStatusByRepo = (status) => {
  if (!status || typeof status !== 'object' || Array.isArray(status)) {
    return 0;
  }
  const trustTierPriority = getTrustTierPriority(status.trustTier);
  const verificationSignals =
    status.verificationSignals &&
    typeof status.verificationSignals === 'object' &&
    !Array.isArray(status.verificationSignals)
      ? status.verificationSignals
      : {};
  const provenanceSignals =
    status.provenanceSignals &&
    typeof status.provenanceSignals === 'object' &&
    !Array.isArray(status.provenanceSignals)
      ? status.provenanceSignals
      : {};
  const domainProof = mergeVerificationSignals(
    verificationSignals.domainProof,
    status.domainProof,
    status.verifiedDomain,
  );
  const manifestIntegrity = mergeVerificationSignals(
    provenanceSignals.manifestIntegrity,
    status.checks?.manifestIntegrity,
  );
  const repoCommitIntegrity = mergeVerificationSignals(
    provenanceSignals.repoCommitIntegrity,
    status.checks?.repoCommitIntegrity,
  );
  return (
    trustTierPriority * 1000 +
    (domainProof === true ? 200 : 0) +
    (manifestIntegrity === true ? 40 : 0) +
    (repoCommitIntegrity === true ? 20 : 0)
  );
};

const resolveStatusByRepo = async (params) => {
  const candidates = [];
  const addCandidate = (value) => {
    const normalized = normalizeSkillDirCandidate(value);
    if (!normalized || candidates.includes(normalized)) {
      return;
    }
    candidates.push(normalized);
  };

  const repoSkillDir = normalizeSkillDirCandidate(params.repoSkillDir);
  const shouldUseRepositoryFallbacks = Boolean(repoSkillDir) || isStagedPackageDirectory(params.skillDir);

  addCandidate(params.skillDir);
  addCandidate(repoSkillDir);
  if (shouldUseRepositoryFallbacks) {
    addCandidate(params.skillName);
    addCandidate('.');
  }

  const resolvedStatuses = await Promise.all(
    candidates.map((candidate) =>
      tryFetchStatusByRepo({
        apiBaseUrl: params.apiBaseUrl,
        repoUrl: params.repoUrl,
        skillDir: candidate,
        ...(params.ref ? { ref: params.ref } : {}),
      }),
    ),
  );

  let preferred = null;
  for (const status of resolvedStatuses) {
    if (!status || typeof status !== 'object' || Array.isArray(status)) {
      continue;
    }
    if (!preferred || scoreStatusByRepo(status) > scoreStatusByRepo(preferred)) {
      preferred = status;
    }
  }
  return preferred;
};

const tryFetchPublishedSkill = async (params) => {
  if (!params.skillName || !params.skillVersion) {
    return null;
  }
  try {
    return await findExistingSkillVersion({
      apiBaseUrl: params.apiBaseUrl,
      apiKey: '',
      accountId: '',
      name: params.skillName,
      version: params.skillVersion,
    });
  } catch {
    return null;
  }
};

const tryListRepoCandidates = async (params) => {
  if (!params.repoUrl) {
    return [];
  }
  try {
    const response = await executeWithRetry({
      label: 'GET /skills',
      attempts: 1,
      operation: () =>
        listSkillReleases({
          baseUrl: params.apiBaseUrl,
          query: {
            limit: 50,
          },
        }),
    });
    const items = Array.isArray(response?.items) ? response.items : [];
    const repos = items
      .map((item) =>
        item && typeof item === 'object' && !Array.isArray(item) && typeof item.repo === 'string'
          ? item.repo.trim()
          : '',
      )
      .filter(Boolean);
    return [...new Set([params.repoUrl, ...repos])];
  } catch {
    return params.repoUrl ? [params.repoUrl] : [];
  }
};

const tryFetchQuotePreview = async (params) => {
  if (!params.shouldRequestQuotePreview) {
    return null;
  }
  if (!Number.isFinite(params.fileCount) || params.fileCount <= 0) {
    return null;
  }
  if (!Number.isFinite(params.totalBytes) || params.totalBytes <= 0) {
    return null;
  }

  try {
    return await executeWithRetry({
      label: 'POST /skills/quote-preview',
      attempts: 1,
      operation: () =>
        fetchSkillQuotePreview({
          baseUrl: params.apiBaseUrl,
          fileCount: params.fileCount,
          totalBytes: params.totalBytes,
          ...(params.skillName ? { skillName: params.skillName } : {}),
          ...(params.skillVersion ? { skillVersion: params.skillVersion } : {}),
          ...(params.repoUrl ? { repoUrl: params.repoUrl } : {}),
          ...(params.skillDir ? { skillDir: params.skillDir } : {}),
        }),
    });
  } catch {
    return null;
  }
};

const formatEstimatedCreditsRange = (estimate) => {
  const min = Number(estimate?.estimatedCredits?.min);
  const max = Number(estimate?.estimatedCredits?.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return '';
  }
  return min === max ? `${min}` : `${min}-${max}`;
};

const buildMissingRequirements = (params) => {
  const missing = [];
  if (!params.repoUrl) {
    missing.push('repo_url');
  }
  if (!params.commitSha) {
    missing.push('commit_sha');
  }
  if (!params.isStableVersion) {
    missing.push('stable_version');
  }
  return missing;
};

const resolvePublishReadiness = (missingRequirements) =>
  missingRequirements.length === 0 ? 'ready' : 'blocked';

const setLifecycleOutputs = async (params) => {
  await setActionOutput('preview-json', params.previewJson ?? '');
  await setActionOutput('hcs28-json', params.hcs28Json ?? '');
  await setActionOutput('hcs28-score-total', params.hcs28ScoreTotal ?? '');
  await setActionOutput('preview-json-path', params.previewJsonPath ?? '');
  await setActionOutput('status-url', params.statusUrl ?? '');
  await setActionOutput('trust-tier', params.trustTier ?? '');
  await setActionOutput('publish-readiness', params.publishReadiness ?? '');
  await setActionOutput(
    'missing-requirements',
    JSON.stringify(params.missingRequirements ?? []),
  );
  await setActionOutput('estimated-credits-range', params.estimatedCreditsRange ?? '');
  await setActionOutput('managed-comment-url', params.managedCommentUrl ?? '');
  await setActionOutput('managed-comment-status', params.managedCommentStatus ?? '');
  await setActionOutput('managed-comment-reason', params.managedCommentReason ?? '');
  await setActionOutput('publish-comment-url', params.publishCommentUrl ?? '');
  await setActionOutput('publish-comment-status', params.publishCommentStatus ?? '');
  await setActionOutput('release-annotation-status', params.releaseAnnotationStatus ?? '');
  await setActionOutput('purchase-url', params.purchaseUrl ?? '');
  await setActionOutput('publish-url', params.publishUrl ?? '');
  await setActionOutput('verification-url', params.verificationUrl ?? '');
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

const maybeSubmitIndexNow = async (distribution, enabled) => {
  if (!enabled) {
    return null;
  }
  return submitToIndexNow(distribution.indexing.urls);
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

const resolveCommentModeState = (params) => {
  if (!params.token) {
    return createAnnotationResult({ status: 'skipped', reason: 'missing-github-token' });
  }
  if (params.eventName !== 'pull_request' || !params.pullNumber) {
    return createAnnotationResult({ status: 'skipped', reason: 'non-pr-event' });
  }
  if (params.commentMode === 'off') {
    return createAnnotationResult({ status: 'disabled', reason: 'comment-mode-off' });
  }
  if (
    !shouldPublishManagedComment({
      commentMode: params.commentMode,
      commentOnSuccess: params.commentOnSuccess,
      publishReadiness: params.publishReadiness,
    })
  ) {
    return createAnnotationResult({
      status: 'skipped',
      reason: 'comment-mode-gated',
    });
  }
  return null;
};

const syncManagedComment = async (params) => {
  const commentState = resolveCommentModeState(params);
  if (commentState) {
    return commentState;
  }
  const comments = await listIssueComments({
    githubApiRequest: params.githubApiRequest,
    owner: params.owner,
    repo: params.repo,
    pullNumber: params.pullNumber,
    token: params.token,
  });
  const existingComment = findExistingCommentByMarker(comments, params.marker);
  const previousMetadata = existingComment
    ? extractManagedCommentMetadata(existingComment.body) || decodeCommentMetadata(existingComment.body)
    : null;
  if (
    params.commentMode === 'state-changes' &&
    existingComment &&
    extractManagedCommentState(existingComment.body) === params.stateSignature
  ) {
    return createAnnotationResult({
      status: 'unchanged',
      reason: 'state-unchanged',
      url: String(existingComment.html_url ?? ''),
      id: Number(existingComment.id ?? 0) || null,
      previousBody: String(existingComment.body ?? ''),
      updatedBody: String(existingComment.body ?? ''),
    });
  }
  const body = buildManagedCommentBody({
    ...params,
    previousMetadata,
    currentMetadata: params.currentMetadata,
  });
  return upsertIssueComment({
    githubApiRequest: params.githubApiRequest,
    owner: params.owner,
    repo: params.repo,
    pullNumber: params.pullNumber,
    token: params.token,
    body,
    existingComment,
    skipIfUnchanged: params.commentMode === 'state-changes',
  });
};

const buildPublishCommentMetadata = (params) => ({
  surface: 'publish',
  mode: 'publish',
  groupKey: normalizeText(params.groupKey),
  skillName: normalizeText(params.skillName),
  skillVersion: normalizeText(params.skillVersion),
  trustTier: normalizeText(params.trustTier || 'published'),
  publishReadiness: normalizeText(params.publishReadiness || 'published'),
  missingRequirements: [],
  estimatedCreditsRange: '',
  statusUrl: normalizeText(params.statusUrl),
  hcs28Total: null,
  signalScores: {},
  packageSummary: {
    includedFileCount: null,
    excludedFileCount: Array.isArray(params.excludedFiles) ? params.excludedFiles.length : null,
    totalBytes: null,
  },
  published: params.published === true,
  skipReason: normalizeText(params.skipReason),
  workflowRunUrl: normalizeText(params.workflowRunUrl),
  quoteId: normalizeText(params.quoteId),
  jobId: normalizeText(params.jobId),
  skillPageUrl: normalizeText(params.skillPageUrl),
  renderedAt: new Date().toISOString(),
});

const isAnnotationWritten = (result) =>
  result?.status === 'created' || result?.status === 'updated' || result?.status === 'unchanged';

const syncPublishAnnotations = async (params) => {
  if (!params.shouldAnnotate) {
    return {
      annotationTarget: 'none',
      publishComment: createAnnotationResult({ status: 'disabled', reason: 'annotate-disabled' }),
      releaseBlock: createAnnotationResult({ status: 'disabled', reason: 'annotate-disabled' }),
    };
  }
  if (!params.token) {
    return {
      annotationTarget: 'none',
      publishComment: createAnnotationResult({ status: 'skipped', reason: 'missing-github-token' }),
      releaseBlock: createAnnotationResult({ status: 'skipped', reason: 'missing-github-token' }),
    };
  }

  const releaseResult = (() =>
    createAnnotationResult({ status: 'skipped', reason: 'not-release-event' }))();
  const publishResult = (() =>
    createAnnotationResult({ status: 'skipped', reason: 'associated-pr-not-found' }))();
  const eventName = normalizeText(params.eventName);
  let associatedPullNumber = null;

  if (eventName === 'release' && Number.isFinite(params.releaseId) && params.releaseId > 0) {
    const releaseIdentity = `${params.skillName}@${params.skillVersion}`;
    const releaseMarker = buildReleaseBlockMarker(releaseIdentity);
    const releaseContent = renderReleaseBlock({
      skillName: params.skillName,
      skillVersion: params.skillVersion,
      skillPageUrl: params.distribution?.urls?.skillPageUrl,
      pinnedSkillMdUrl: params.distribution?.urls?.pinnedSkillMdUrl,
      badgeMarkdown: params.distribution?.snippets?.badgeMarkdown,
      skillJsonHrl: params.skillJsonHrl,
      directoryTopicId: params.directoryTopicId,
      packageTopicId: params.packageTopicId,
    });
    try {
      const releaseUpsert = await upsertReleaseBodyBlock({
        githubApiRequest: params.githubApiRequest,
        owner: params.owner,
        repo: params.repo,
        releaseId: params.releaseId,
        token: params.token,
        marker: releaseMarker,
        content: releaseContent,
      });
      Object.assign(releaseResult, releaseUpsert);
    } catch (error) {
      Object.assign(
        releaseResult,
        createAnnotationResult({
          status: 'failed',
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  try {
    const associatedPr = await resolveAssociatedPullRequest({
      githubApiRequest: params.githubApiRequest,
      owner: params.owner,
      repo: params.repo,
      token: params.token,
      eventName,
      eventPayload: params.eventPayload,
      commitSha: params.commitSha,
    });
    if (associatedPr?.number) {
      associatedPullNumber = Number(associatedPr.number);
      const groupKey = params.groupKey || `${params.skillName}-${params.skillVersion}`;
      const marker = buildPublishCommentMarker(groupKey);
      const comments = await listIssueComments({
        githubApiRequest: params.githubApiRequest,
        owner: params.owner,
        repo: params.repo,
        pullNumber: associatedPr.number,
        token: params.token,
      });
      const existingComment = findExistingCommentByMarker(comments, marker);
      const previousMetadata = existingComment
        ? decodeCommentMetadata(existingComment.body)
        : null;
      const currentMetadata = buildPublishCommentMetadata({
        groupKey,
        skillName: params.skillName,
        skillVersion: params.skillVersion,
        published: params.published,
        skipReason: params.skipReason,
        statusUrl: params.distribution?.urls?.skillPageUrl,
        excludedFiles: params.excludedFiles,
        workflowRunUrl: params.workflowRunUrl,
        quoteId: params.quoteId,
        jobId: params.jobId,
        skillPageUrl: params.distribution?.urls?.skillPageUrl,
      });
      const encodedMetadata = encodeCommentMetadata(currentMetadata);
      const stateSignature = buildStateSignature(currentMetadata);
      const body = renderPublishComment({
        marker,
        encodedMetadata,
        stateSignature,
        previousMetadata,
        currentMetadata,
        skillName: params.skillName,
        skillVersion: params.skillVersion,
        trustTier: 'published',
        published: params.published,
        skipReason: params.skipReason,
        credits: params.credits,
        estimatedCostHbar: params.estimatedCostHbar,
        quoteId: params.quoteId,
        jobId: params.jobId,
        skillJsonHrl: params.skillJsonHrl,
        directoryTopicId: params.directoryTopicId,
        packageTopicId: params.packageTopicId,
        repoUrl: params.repoUrl,
        commitSha: params.commitSha,
        workflowRunUrl: params.workflowRunUrl,
        distribution: params.distribution,
        skillPageUrl: params.distribution?.urls?.skillPageUrl,
        pinnedSkillMdUrl: params.distribution?.urls?.pinnedSkillMdUrl,
        latestSkillMdUrl: params.distribution?.urls?.latestSkillMdUrl,
        pinnedManifestUrl: params.distribution?.urls?.pinnedManifestUrl,
        installMetadataPinnedUrl: params.distribution?.urls?.installMetadataPinnedUrl,
      });
      const publishUpsert = await upsertIssueComment({
        githubApiRequest: params.githubApiRequest,
        owner: params.owner,
        repo: params.repo,
        pullNumber: associatedPr.number,
        token: params.token,
        body,
        existingComment,
        skipIfUnchanged: true,
      });
      Object.assign(publishResult, publishUpsert);
    }
  } catch (error) {
    Object.assign(
      publishResult,
      createAnnotationResult({
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  const annotationTarget = (() => {
    if (isAnnotationWritten(releaseResult) && Number.isFinite(params.releaseId) && params.releaseId > 0) {
      return `release:${params.releaseId}`;
    }
    if (isAnnotationWritten(publishResult) && Number.isFinite(associatedPullNumber) && associatedPullNumber > 0) {
      return `pr:${associatedPullNumber}`;
    }
    if (releaseResult.status === 'failed' || publishResult.status === 'failed') {
      return 'failed';
    }
    return 'none';
  })();

  return {
    annotationTarget,
    publishComment: publishResult,
    releaseBlock: releaseResult,
    associatedPullNumber,
  };
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
  const shouldSubmitIndexNow = toBoolean(getEnv('INPUT_SUBMIT_INDEXNOW'), false);
  const shouldRequestQuotePreview = toBoolean(getEnv('INPUT_QUOTE_PREVIEW'), false);
  const repoSkillDirInput = getEnv('INPUT_REPO_SKILL_DIR');
  const commentMode = String(getEnv('INPUT_COMMENT_MODE', 'state-changes')).trim().toLowerCase();
  const commentOnSuccess = toBoolean(getEnv('INPUT_COMMENT_ON_SUCCESS'), true);
  const conversionHintLevel = String(getEnv('INPUT_CONVERSION_HINT_LEVEL', 'soft')).trim().toLowerCase();
  const explicitGroupKey = String(getEnv('INPUT_GROUP_KEY')).trim();
  const githubToken = getEnv('INPUT_GITHUB_TOKEN');
  const mode = String(getEnv('INPUT_MODE', 'publish')).trim().toLowerCase() || 'publish';
  const jsonOutput = toBoolean(getEnv('INPUT_JSON'), false);
  const githubApiRequest = createGitHubApiRequest(
    getEnv('GITHUB_API_URL', 'https://api.github.com'),
  );
  const log = (message) => {
    if (!jsonOutput) {
      stdout(message);
    }
  };

  if (!['publish', 'validate', 'monitor', 'quote'].includes(mode)) {
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
  if (!relativePaths.includes('SKILL.md')) {
    throw new ActionError(`Missing required file: ${path.posix.join(skillDirInput, 'SKILL.md')}`);
  }

  const skillPackageState = await readSkillPackageState(skillDir);
  if (skillPackageState.invalidSkillJson) {
    throw new ActionError(
      `skill.json is not valid JSON: ${skillPackageState.skillJsonError}`,
    );
  }
  let parsedSkillJson = resolveSkillPackageMetadata({
    skillDir,
    skillMdText: skillPackageState.skillMdText,
    parsedSkillJson: skillPackageState.parsedSkillJson,
  });

  if (overrideName) {
    parsedSkillJson.name = overrideName;
  }
  if (overrideVersion) {
    parsedSkillJson.version = overrideVersion;
  }

  const repository = getEnv('GITHUB_REPOSITORY');
  const serverUrl = getEnv('GITHUB_SERVER_URL', 'https://github.com');
  const commitSha = getEnv('GITHUB_SHA');
  const githubRef = getEnv('GITHUB_REF');
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
      accountId,
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
      await setActionOutput('hcs28-json', '');
      await setActionOutput('hcs28-score-total', '');
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
      await setLifecycleOutputs({
        previewJson: '',
        previewJsonPath: '',
        statusUrl: result.distribution.urls.skillPageUrl,
        trustTier: 'published',
        publishReadiness: 'published',
        missingRequirements: [],
        estimatedCreditsRange: '',
        managedCommentUrl: '',
        managedCommentStatus: 'disabled',
        managedCommentReason: 'publish-mode',
        publishCommentUrl: '',
        publishCommentStatus: 'disabled',
        releaseAnnotationStatus: 'disabled',
        purchaseUrl: '',
        publishUrl: result.distribution.urls.skillPageUrl,
        verificationUrl: result.distribution.urls.skillPageUrl,
      });
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
    const config = await executeWithRetry({
      label: 'GET /skills/config',
      attempts: 3,
      operation: () => fetchSkillsConfig(apiBaseUrl, apiKey, accountId),
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

  if (!relativePaths.includes('skill.json')) {
    const mimeType = guessMimeType('skill.json');
    files.push({
      name: 'skill.json',
      base64: rewrittenSkillJsonBuffer.toString('base64'),
      mimeType,
      role: resolveRole('skill.json'),
    });
    previewFiles.push({
      name: 'skill.json',
      mimeType,
      role: resolveRole('skill.json'),
      sizeBytes: rewrittenSkillJsonBuffer.byteLength,
    });
    totalBytes += rewrittenSkillJsonBuffer.byteLength;
  }

  if (maxTotalSizeBytes > 0 && totalBytes > maxTotalSizeBytes) {
    throw new ActionError(`Skill package is ${totalBytes} bytes but maxTotalSizeBytes is ${maxTotalSizeBytes}.`);
  }

  const validationResult = {
    mode,
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

  if (mode === 'validate' || mode === 'monitor') {
    const distribution = buildDistribution(apiBaseUrl, skillName, skillVersion, parsedSkillJson);
    const eventPayload = await parseEventPayload();
    const generatedAt = new Date().toISOString();
    const toolVersion = await getToolVersion();
    const previewFiles = files.map((file) => ({
      ...file,
      sizeBytes: Buffer.byteLength(file.base64, 'base64'),
    }));
    const publishedSkill = await tryFetchPublishedSkill({
      apiBaseUrl,
      skillName,
      skillVersion,
    });
    const previewReport = buildSkillPreviewReport({
      toolVersion,
      repository,
      repoUrl,
      commitSha,
      ref: githubRef,
      eventName,
      workflowRunUrl: getWorkflowRunUrl(),
      skillDir: skillDirInput,
      skillName,
      skillVersion,
      generatedAt,
      eventPayload,
      files: previewFiles,
      excludedFiles,
      totalBytes,
    });
    const statusByRepo = await resolveStatusByRepo({
      apiBaseUrl,
      repoUrl,
      skillDir: skillDirInput,
      repoSkillDir: repoSkillDirInput,
      skillName,
      ref: githubRef,
    });
    const repoCandidates =
      mode === 'monitor'
        ? await tryListRepoCandidates({
            apiBaseUrl,
            repoUrl,
          })
        : repoUrl
          ? [repoUrl]
          : [];
    const hcs28BaseParams = {
      mode,
      includeExternal: mode === 'monitor',
      computedAt: generatedAt,
      githubToken: githubToken || getEnv('GITHUB_TOKEN'),
      packageState: {
        skillName,
        skillVersion,
        skillDescription: parsedSkillJson?.description,
        repoUrl,
        commitSha,
        homepage: parsedSkillJson?.homepage,
        tags: Array.isArray(parsedSkillJson?.tags) ? parsedSkillJson.tags : [],
        languages: Array.isArray(parsedSkillJson?.languages) ? parsedSkillJson.languages : [],
        category: parsedSkillJson?.category,
        files: previewReport.package_summary.included_files,
      },
      publishedSkill: {
        ...(publishedSkill && typeof publishedSkill === 'object' ? publishedSkill : {}),
        verificationSignals: {
          ...(
            publishedSkill?.verificationSignals &&
            typeof publishedSkill.verificationSignals === 'object' &&
            !Array.isArray(publishedSkill.verificationSignals)
              ? publishedSkill.verificationSignals
              : {}
          ),
          publisherBound: mergeVerificationSignals(
            statusByRepo?.verificationSignals?.publisherBound,
            publishedSkill?.verificationSignals?.publisherBound,
          ),
          repoCommitIntegrity: mergeVerificationSignals(
            statusByRepo?.provenanceSignals?.repoCommitIntegrity,
            publishedSkill?.verificationSignals?.repoCommitIntegrity,
          ),
          manifestIntegrity: mergeVerificationSignals(
            statusByRepo?.provenanceSignals?.manifestIntegrity,
            publishedSkill?.verificationSignals?.manifestIntegrity,
          ),
          domainProof: mergeVerificationSignals(
            statusByRepo?.verificationSignals?.domainProof,
            statusByRepo?.domainProof,
            statusByRepo?.verifiedDomain,
            publishedSkill?.verificationSignals?.domainProof,
          ),
        },
        repo: publishedSkill?.repo ?? repoUrl,
        commit: publishedSkill?.commit ?? commitSha,
        homepage: publishedSkill?.homepage ?? parsedSkillJson?.homepage,
      },
      repoCandidates,
    };
    const hcs28 = await computeHcs28TrustPreview(hcs28BaseParams).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      stderr(`HCS-28 scoring failed: ${message}`);
      return buildHcs28Fallback({
        ...hcs28BaseParams,
        errorMessage: message,
      });
    });
    const previewReportWithHcs28 = buildSkillPreviewReport({
      ...previewReport,
      toolVersion,
      repository,
      repoUrl,
      commitSha,
      ref: githubRef,
      eventName,
      workflowRunUrl: getWorkflowRunUrl(),
      skillDir: skillDirInput,
      skillName,
      skillVersion,
      generatedAt,
      eventPayload,
      files: previewFiles,
      excludedFiles,
      totalBytes,
      hcs28,
    });
    const previewJsonPath = await writeSkillPreviewReport({
      workspaceDir: process.cwd(),
      report: previewReportWithHcs28,
    });
    const previewJson = JSON.stringify(previewReportWithHcs28, null, 2);
    const quotePreview = await tryFetchQuotePreview({
      shouldRequestQuotePreview,
      apiBaseUrl,
      fileCount: files.length,
      totalBytes,
      skillName,
      skillVersion,
      repoUrl,
      skillDir: skillDirInput,
    });
    const missingRequirements = buildMissingRequirements({
      repoUrl,
      commitSha,
      isStableVersion: !nonstableVersion,
    });
    const brokerTrustTier = String(statusByRepo?.trustTier ?? '').trim().toLowerCase();
    const trustTier =
      brokerTrustTier && brokerTrustTier !== 'unclaimed'
        ? brokerTrustTier
        : publishedSkill
          ? publishedSkill.verified === true
            ? 'verified'
            : 'published'
          : 'validated';
    const publishReadiness = resolvePublishReadiness(missingRequirements);
    const fallbackStatusUrl = statusByRepo?.statusUrl ?? '';
    const statusUrl = String(
      (publishedSkill ? distribution.urls.skillPageUrl : '') || fallbackStatusUrl,
    );
    const purchaseUrl = String(
      quotePreview?.purchaseUrl ??
        statusByRepo?.publisher?.submitUrl ??
        '',
    );
    const publishUrl = String(
      quotePreview?.publishUrl ??
        statusByRepo?.publisher?.actionMarketplaceUrl ??
        statusByRepo?.publisher?.submitUrl ??
        '',
    );
    const verificationUrl = String(
      quotePreview?.verificationUrl ??
        statusByRepo?.publisher?.submitUrl ??
        '',
    );
    const estimatedCreditsRange = formatEstimatedCreditsRange(quotePreview);
    const [owner = '', repo = ''] = repository.split('/', 2);
    const pullNumber = Number(eventPayload?.pull_request?.number ?? 0) || null;
    const groupKey =
      explicitGroupKey ||
      buildDefaultManagedCommentGroupKey({
        repository,
        pullNumber,
        skillName,
        skillDir: skillDirInput,
      });
    const packageSummary = {
      includedFileCount: Number(previewReportWithHcs28?.package_summary?.included_file_count ?? files.length),
      excludedFileCount: Number(previewReportWithHcs28?.package_summary?.excluded_file_count ?? excludedFiles.length),
      totalBytes: Number(previewReportWithHcs28?.package_summary?.total_bytes ?? totalBytes),
    };
    const previewCommentMetadata = buildPreviewCommentMetadata({
      mode,
      groupKey,
      skillDir: skillDirInput,
      skillName,
      skillVersion,
      trustTier,
      publishReadiness,
      missingRequirements,
      estimatedCreditsRange,
      packageSummary,
      statusUrl,
      purchaseUrl,
      publishUrl,
      verificationUrl,
      workflowRunUrl: getWorkflowRunUrl(),
      conversionHintLevel,
      nextActions: previewReportWithHcs28.suggested_next_steps,
      hcs28,
    });
    const stateSignature = buildManagedCommentStateSignature({
      ...previewCommentMetadata,
      hcs28,
    });
    const marker = buildManagedCommentMarker(groupKey);
    const managedCommentResult = await syncManagedComment({
      githubApiRequest,
      token: githubToken,
      eventName: getEnv('GITHUB_EVENT_NAME'),
      owner,
      repo,
      pullNumber,
      commentMode,
      commentOnSuccess,
      publishReadiness,
      marker,
      stateSignature,
      mode,
      currentMetadata: previewCommentMetadata,
      skillName,
      skillVersion,
      hcs28,
      workflowRunUrl: getWorkflowRunUrl(),
      conversionHintLevel,
      packageSummary,
    }).catch((error) => {
      stderr(`Managed comment update failed: ${error instanceof Error ? error.message : String(error)}`);
      return createAnnotationResult({
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error),
      });
    });
    validationResult.distribution = distribution;
    validationResult.previewReport = previewReportWithHcs28;
    validationResult.hcs28 = hcs28;
    validationResult.trustTier = trustTier;
    validationResult.publishReadiness = publishReadiness;
    validationResult.missingRequirements = missingRequirements;
    validationResult.statusUrl = statusUrl;
    await setActionOutput('published', 'false');
    await setActionOutput('skip-reason', 'validation-only');
    await setActionOutput('skill-name', skillName);
    await setActionOutput('skill-version', skillVersion);
    await setActionOutput('preview-json', previewJson);
    await setActionOutput('hcs28-json', JSON.stringify(hcs28, null, 2));
    await setActionOutput('hcs28-score-total', String(hcs28.trustScores.total));
    await setActionOutput('preview-json-path', previewJsonPath);
    await setActionOutput('status-url', statusUrl);
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
    await setLifecycleOutputs({
      previewJson,
      hcs28Json: JSON.stringify(hcs28, null, 2),
      hcs28ScoreTotal: String(hcs28.trustScores.total),
      previewJsonPath,
      statusUrl,
      trustTier,
      publishReadiness,
      missingRequirements,
      estimatedCreditsRange,
      managedCommentUrl: managedCommentResult.url,
      managedCommentStatus: managedCommentResult.status,
      managedCommentReason: managedCommentResult.reason,
      publishCommentUrl: '',
      publishCommentStatus: 'disabled',
      releaseAnnotationStatus: 'disabled',
      purchaseUrl,
      publishUrl,
      verificationUrl,
    });
    await setActionOutput('result-json', JSON.stringify(validationResult, null, 2));
    await appendStepSummary(
      [
        `### ${mode === 'monitor' ? 'Monitor' : 'Validate'} result`,
        '',
        `- Skill: \`${skillName}@${skillVersion}\``,
        `- Trust tier: \`${trustTier}\``,
        `- HCS-28 total: \`${hcs28.trustScores.total}\``,
        `- Publish readiness: \`${publishReadiness}\``,
        `- Missing requirements: \`${missingRequirements.length}\``,
        statusUrl ? `- Status page: ${statusUrl}` : '- Status page: not available yet',
        '',
        formatPreviewNextActions(previewReportWithHcs28),
      ].join('\n'),
    );
    if (jsonOutput) {
      printJson({
        ...validationResult,
        preview: {
          report: previewReportWithHcs28,
          path: previewJsonPath,
          statusUrl,
        },
      });
    } else {
      stdout(
        `${mode === 'monitor' ? 'Monitor' : 'Validation'} complete for ${skillName}@${skillVersion}.`,
      );
    }
    return;
  }

  const quote = await executeWithRetry({
    label: 'POST /skills/quote',
    attempts: 3,
    operation: () =>
      quoteSkillPublishRequest({
        baseUrl: apiBaseUrl,
        apiKey,
        accountId,
        files,
      }),
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
    const eventPayload = await parseEventPayload();
    const [owner = '', repo = ''] = repository.split('/', 2);
    const pullNumber = Number(eventPayload?.pull_request?.number ?? 0) || null;
    const groupKey =
      explicitGroupKey ||
      buildDefaultManagedCommentGroupKey({
        repository,
        pullNumber,
        skillName,
        skillDir: skillDirInput,
      });
    const quoteCommentMetadata = buildPreviewCommentMetadata({
      mode: 'quote',
      groupKey,
      skillDir: skillDirInput,
      skillName,
      skillVersion,
      trustTier: '',
      publishReadiness: 'quoted',
      missingRequirements: [],
      estimatedCreditsRange: `${quoteResult.credits} credits`,
      packageSummary: {
        includedFileCount: files.length,
        excludedFileCount: excludedFiles.length,
        totalBytes,
      },
      statusUrl: distribution.urls.skillPageUrl,
      purchaseUrl: distribution.urls.skillPageUrl,
      publishUrl: distribution.urls.skillPageUrl,
      verificationUrl: distribution.urls.skillPageUrl,
      workflowRunUrl: getWorkflowRunUrl(),
      conversionHintLevel,
      nextActions: [],
      hcs28: {},
    });
    const quoteStateSignature = buildManagedCommentStateSignature({
      ...quoteCommentMetadata,
      hcs28: {},
    });
    const quoteMarker = buildManagedCommentMarker(groupKey);
    const quoteCommentResult = await syncManagedComment({
      githubApiRequest,
      token: githubToken,
      eventName: getEnv('GITHUB_EVENT_NAME'),
      owner,
      repo,
      pullNumber,
      commentMode,
      commentOnSuccess,
      publishReadiness: 'quoted',
      marker: quoteMarker,
      stateSignature: quoteStateSignature,
      mode: 'quote',
      currentMetadata: quoteCommentMetadata,
      skillName,
      skillVersion,
      hcs28: {},
      workflowRunUrl: getWorkflowRunUrl(),
      conversionHintLevel,
      packageSummary: quoteCommentMetadata.packageSummary,
    }).catch((error) =>
      createAnnotationResult({
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error),
      }));
    quoteResult.distribution = distribution;
    await setActionOutput('published', 'false');
    await setActionOutput('skip-reason', 'quote-only');
    await setActionOutput('skill-name', skillName);
    await setActionOutput('skill-version', skillVersion);
    await setActionOutput('preview-json', '');
    await setActionOutput('hcs28-json', '');
    await setActionOutput('hcs28-score-total', '');
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
    await setLifecycleOutputs({
      previewJson: '',
      previewJsonPath: '',
      statusUrl: distribution.urls.skillPageUrl,
      trustTier: '',
      publishReadiness: 'quoted',
      missingRequirements: [],
      estimatedCreditsRange: `${quoteResult.credits} credits`,
      managedCommentUrl: quoteCommentResult.url,
      managedCommentStatus: quoteCommentResult.status,
      managedCommentReason: quoteCommentResult.reason,
      publishCommentUrl: '',
      publishCommentStatus: 'disabled',
      releaseAnnotationStatus: 'disabled',
      purchaseUrl: distribution.urls.skillPageUrl,
      publishUrl: distribution.urls.skillPageUrl,
      verificationUrl: distribution.urls.skillPageUrl,
    });
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

  const publish = await publishSkillRequest({
    baseUrl: apiBaseUrl,
    apiKey,
    accountId,
    files,
    quoteId,
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
    const job = await executeWithRetry({
      label: `GET /skills/jobs/${jobId}`,
      attempts: 3,
      operation: () =>
        fetchSkillPublishJob({
          baseUrl: apiBaseUrl,
          apiKey,
          accountId,
          jobId,
        }),
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
  const [owner = '', repo = ''] = repository.split('/', 2);
  const explicitPublishGroupKey =
    explicitGroupKey ||
    buildDefaultManagedCommentGroupKey({
      repository,
      pullNumber: Number(eventPayload?.pull_request?.number ?? 0) || null,
      skillName: result.skillName,
      skillDir: skillDirInput,
    });
  const releaseId = Number(eventPayload?.release?.id ?? 0);
  const annotationResult = await syncPublishAnnotations({
    githubApiRequest,
    shouldAnnotate,
    token: githubToken || getEnv('GITHUB_TOKEN'),
    owner,
    repo,
    eventName,
    eventPayload,
    releaseId,
    commitSha,
    groupKey: explicitPublishGroupKey,
    skillName: result.skillName,
    skillVersion: result.skillVersion,
    published: true,
    skipReason: '',
    credits: String(result.credits ?? ''),
    estimatedCostHbar: String(result.estimatedCostHbar ?? ''),
    quoteId: result.quoteId,
    jobId: result.jobId,
    skillJsonHrl: result.skillJsonHrl,
    directoryTopicId: result.directoryTopicId,
    packageTopicId: result.packageTopicId,
    repoUrl: result.repoUrl,
    excludedFiles: result.excludedFiles,
    workflowRunUrl: getWorkflowRunUrl(),
    distribution: result.distribution,
  }).catch(error => {
    stderr(`Annotation failed: ${error instanceof Error ? error.message : String(error)}`);
    return {
      annotationTarget: 'failed',
      publishComment: createAnnotationResult({
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error),
      }),
      releaseBlock: createAnnotationResult({
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error),
      }),
    };
  });
  const annotationTarget = annotationResult.annotationTarget;

  await appendStepSummary(markdown);

  await setActionOutput('published', 'true');
  await setActionOutput('skip-reason', '');
  await setActionOutput('skill-name', result.skillName);
  await setActionOutput('skill-version', result.skillVersion);
  await setActionOutput('preview-json', '');
  await setActionOutput('hcs28-json', '');
  await setActionOutput('hcs28-score-total', '');
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
  await setLifecycleOutputs({
    previewJson: '',
    previewJsonPath: '',
    statusUrl: result.distribution.urls.skillPageUrl,
    trustTier: 'published',
    publishReadiness: 'published',
    missingRequirements: [],
    estimatedCreditsRange: '',
    managedCommentUrl: '',
    managedCommentStatus: 'disabled',
    managedCommentReason: 'publish-mode',
    publishCommentUrl: annotationResult.publishComment?.url ?? '',
    publishCommentStatus: annotationResult.publishComment?.status ?? '',
    releaseAnnotationStatus: annotationResult.releaseBlock?.status ?? '',
    purchaseUrl: '',
    publishUrl: result.distribution.urls.skillPageUrl,
    verificationUrl: result.distribution.urls.skillPageUrl,
  });
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
    await setActionOutput('hcs28-json', '');
    await setActionOutput('hcs28-score-total', '');
    await setActionOutput('preview-json-path', '');
    await setActionOutput('status-url', '');
    await setActionOutput('managed-comment-status', 'failed');
    await setActionOutput('managed-comment-reason', message);
    await setActionOutput('publish-comment-status', 'failed');
    await setActionOutput('release-annotation-status', 'failed');
    await setActionOutput('annotation-target', 'failed');
  }
  process.exit(1);
});
