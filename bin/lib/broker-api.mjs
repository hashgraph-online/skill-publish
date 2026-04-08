import { RegistryBrokerClient, RegistryBrokerError } from '@hol-org/rb-client';

const DEFAULT_BASE_URL = 'https://hol.org/registry/api/v1';

export function normalizeBaseUrl(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return DEFAULT_BASE_URL;
  }
  const withoutTrailing = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
  if (withoutTrailing.endsWith('/api/v1')) {
    return withoutTrailing;
  }
  if (withoutTrailing.endsWith('/registry')) {
    return `${withoutTrailing}/api/v1`;
  }
  return `${withoutTrailing}/api/v1`;
}

function createClient(params = {}) {
  const apiKey = String(params.apiKey ?? '').trim();
  const accountId = String(params.accountId ?? '').trim();
  const defaultHeaders = {};
  if (apiKey) {
    defaultHeaders['x-api-key'] = apiKey;
  }
  if (accountId) {
    defaultHeaders['x-account-id'] = accountId;
  }
  return new RegistryBrokerClient({
    baseUrl: normalizeBaseUrl(params.baseUrl),
    defaultHeaders,
    ...(params.fetchImplementation ? { fetchImplementation: params.fetchImplementation } : {}),
  });
}

function splitRequestUrl(value) {
  const url = new URL(String(value));
  const apiIndex = url.pathname.indexOf('/api/v1');
  if (apiIndex === -1) {
    throw new Error(`Request URL must include /api/v1: ${url.toString()}`);
  }
  const baseOriginPath = url.pathname.slice(0, apiIndex);
  const baseUrl = `${url.origin}${baseOriginPath}/api/v1`;
  const requestPath = `${url.pathname.slice(apiIndex + '/api/v1'.length)}${url.search}`;
  return {
    baseUrl,
    requestPath: requestPath || '/',
  };
}

function summarizeErrorBody(body) {
  if (!body) {
    return '';
  }
  if (typeof body === 'string') {
    return body;
  }
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

function toBrokerError(label, error) {
  if (error instanceof RegistryBrokerError) {
    const bodySummary = summarizeErrorBody(error.body);
    const message =
      `${label} failed with ${error.status}` + (bodySummary ? `: ${bodySummary}` : '');
    const nextError = new Error(message);
    nextError.statusCode = error.status;
    return nextError;
  }
  if (error instanceof Error) {
    return error;
  }
  return new Error(`${label} failed: ${String(error)}`);
}

export async function requestJson(params) {
  const derivedTarget = params.path
    ? {
      baseUrl: normalizeBaseUrl(params.baseUrl),
      requestPath: params.path,
    }
    : splitRequestUrl(params.url);
  const client = createClient({
    ...params,
    baseUrl: derivedTarget.baseUrl,
  });
  try {
    return await client.requestJson(derivedTarget.requestPath, {
      method: params.method,
      ...(params.headers ? { headers: params.headers } : {}),
      ...(params.body ? { body: params.body } : {}),
      ...(params.signal ? { signal: params.signal } : {}),
    });
  } catch (error) {
    throw toBrokerError(`${params.method} ${derivedTarget.baseUrl}`, error);
  }
}

export async function requestJsonWithTimeout(
  url,
  headers = {},
  timeoutMs = 8000,
  fetchImplementation,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await requestJson({
      method: 'GET',
      url,
      headers,
      signal: controller.signal,
      ...(fetchImplementation ? { fetchImplementation } : {}),
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchBalance(baseUrl, apiKey, accountId) {
  const client = createClient({ baseUrl, apiKey, accountId });
  try {
    const query = new URLSearchParams();
    if (String(accountId ?? '').trim()) {
      query.set('accountId', String(accountId).trim());
    }
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    const response = await client.requestJson(`/credits/balance${suffix}`, {
      method: 'GET',
    });
    const balance = Number(response?.balance ?? 0);
    return Number.isFinite(balance) ? balance : 0;
  } catch (error) {
    throw toBrokerError('GET /credits/balance', error);
  }
}

export async function fetchBalanceDetails(baseUrl, apiKey, accountId) {
  const client = createClient({ baseUrl, apiKey, accountId });
  try {
    const query = new URLSearchParams();
    if (String(accountId ?? '').trim()) {
      query.set('accountId', String(accountId).trim());
    }
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    return await client.requestJson(`/credits/balance${suffix}`, {
      method: 'GET',
    });
  } catch (error) {
    throw toBrokerError('GET /credits/balance', error);
  }
}

export async function fetchProviders(baseUrl, apiKey = '', accountId = '') {
  const client = createClient({ baseUrl, apiKey, accountId });
  try {
    return await client.requestJson('/credits/providers', {
      method: 'GET',
    });
  } catch (error) {
    throw toBrokerError('GET /credits/providers', error);
  }
}

export async function createLedgerChallenge(params) {
  const client = createClient({ baseUrl: params.baseUrl });
  try {
    return await client.createLedgerChallenge({
      accountId: params.accountId,
      network: params.network,
    });
  } catch (error) {
    throw toBrokerError('POST /auth/ledger/challenge', error);
  }
}

export async function verifyLedgerChallenge(params) {
  const client = createClient({ baseUrl: params.baseUrl });
  try {
    return await client.verifyLedgerChallenge({
      challengeId: params.challengeId,
      accountId: params.accountId,
      network: params.network,
      signature: params.signature,
      signatureKind: params.signatureKind,
      ...(params.publicKey ? { publicKey: params.publicKey } : {}),
      ...(typeof params.expiresInMinutes === 'number'
        ? { expiresInMinutes: params.expiresInMinutes }
        : {}),
    });
  } catch (error) {
    throw toBrokerError('POST /auth/ledger/verify', error);
  }
}

export async function createHbarPurchaseIntent(params) {
  const client = createClient({
    baseUrl: params.baseUrl,
    apiKey: params.apiKey,
    accountId: params.accountId,
  });
  try {
    return await client.requestJson('/credits/payments/hbar/intent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: {
        accountId: params.accountId,
        ...(params.credits ? { credits: params.credits } : {}),
        ...(params.hbarAmount ? { hbarAmount: params.hbarAmount } : {}),
        ...(params.memo ? { memo: params.memo } : {}),
      },
    });
  } catch (error) {
    throw toBrokerError('POST /credits/payments/hbar/intent', error);
  }
}

export async function fetchSkillsConfig(baseUrl, apiKey = '', accountId = '') {
  const client = createClient({ baseUrl, apiKey, accountId });
  try {
    return await client.skillsConfig();
  } catch (error) {
    throw toBrokerError('GET /skills/config', error);
  }
}

export async function listSkillReleases(params) {
  const client = createClient(params);
  try {
    return await client.listSkills(params.query ?? {});
  } catch (error) {
    throw toBrokerError('GET /skills', error);
  }
}

export async function fetchSkillStatusByRepo(params) {
  const client = createClient(params);
  try {
    return await client.getSkillStatusByRepo({
      repo: params.repoUrl,
      skillDir: params.skillDir,
      ...(params.ref ? { ref: params.ref } : {}),
    });
  } catch (error) {
    throw toBrokerError('GET /skills/status/by-repo', error);
  }
}

export async function fetchSkillQuotePreview(params) {
  const client = createClient(params);
  try {
    return await client.quoteSkillPublishPreview({
      fileCount: params.fileCount,
      totalBytes: params.totalBytes,
      ...(params.skillName ? { name: params.skillName } : {}),
      ...(params.skillVersion ? { version: params.skillVersion } : {}),
      ...(params.repoUrl ? { repoUrl: params.repoUrl } : {}),
      ...(params.skillDir ? { skillDir: params.skillDir } : {}),
    });
  } catch (error) {
    throw toBrokerError('POST /skills/quote-preview', error);
  }
}

export async function uploadSkillPreviewFromGithubOidc(params) {
  const client = createClient(params);
  try {
    return await client.uploadSkillPreviewFromGithubOidc({
      token: params.token,
      report: params.report,
    });
  } catch (error) {
    throw toBrokerError('POST /skills/preview/github-oidc', error);
  }
}

export async function exchangeSkillPublishApiKeyFromGithubOidc(params) {
  try {
    return await requestJson({
      method: 'POST',
      baseUrl: params.baseUrl,
      path: '/publish/github-oidc/exchange',
      headers: { 'content-type': 'application/json' },
      body: {
        token: params.token,
      },
      ...(params.fetchImplementation ? { fetchImplementation: params.fetchImplementation } : {}),
    });
  } catch (error) {
    throw toBrokerError('POST /publish/github-oidc/exchange', error);
  }
}

export async function quoteSkillPublish(params) {
  const client = createClient(params);
  try {
    return await client.quoteSkillPublish({
      files: params.files,
      ...(params.accountId ? { accountId: params.accountId } : {}),
    });
  } catch (error) {
    throw toBrokerError('POST /skills/quote', error);
  }
}

export async function publishSkill(params) {
  const client = createClient(params);
  try {
    return await client.publishSkill({
      files: params.files,
      quoteId: params.quoteId,
      ...(params.accountId ? { accountId: params.accountId } : {}),
    });
  } catch (error) {
    throw toBrokerError('POST /skills/publish', error);
  }
}

export async function fetchSkillPublishJob(params) {
  const client = createClient(params);
  try {
    return await client.getSkillPublishJob(params.jobId, {
      ...(params.accountId ? { accountId: params.accountId } : {}),
    });
  } catch (error) {
    throw toBrokerError(`GET /skills/jobs/${params.jobId}`, error);
  }
}
