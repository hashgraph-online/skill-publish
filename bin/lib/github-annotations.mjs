import { normalizeText } from './text-utils.mjs';

const USER_AGENT = 'hashgraph-online-skill-publish';

const normalizeBody = (body) =>
  String(body ?? '')
    .replace(/\r\n/gu, '\n')
    .trimEnd();

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

const sortPullRequests = (pulls) => {
  const toTimestamp = (value) => {
    const timestamp = Date.parse(normalizeText(value));
    return Number.isFinite(timestamp) ? timestamp : 0;
  };
  return [...pulls].sort((left, right) => {
    const leftMerged = normalizeText(left?.merged_at);
    const rightMerged = normalizeText(right?.merged_at);
    if (leftMerged && rightMerged) {
      return toTimestamp(rightMerged) - toTimestamp(leftMerged);
    }
    if (leftMerged) {
      return -1;
    }
    if (rightMerged) {
      return 1;
    }
    const leftUpdated = toTimestamp(left?.updated_at);
    const rightUpdated = toTimestamp(right?.updated_at);
    return rightUpdated - leftUpdated;
  });
};

export const createAnnotationResult = (values = {}) => ({
  status: values.status || 'skipped',
  reason: values.reason || '',
  url: values.url || '',
  id: values.id ?? null,
  previousBody: values.previousBody || '',
  updatedBody: values.updatedBody || '',
});

export const createGitHubApiRequest = (baseUrl) => async (params) => {
  const { method, endpoint, token, body, accept } = params;
  const url = `${normalizeText(baseUrl).replace(/\/+$/u, '')}${endpoint}`;
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: accept ?? 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': USER_AGENT,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const details = await summarizeErrorBody(response);
    throw new Error(
      `GitHub API ${method} ${endpoint} failed with ${response.status}${details ? `: ${details}` : ''}`,
    );
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
};

export const listIssueComments = async (params) => {
  const comments = [];
  for (let page = 1; page <= 10; page += 1) {
    const pageComments = await params.githubApiRequest({
      method: 'GET',
      endpoint: `/repos/${params.owner}/${params.repo}/issues/${params.pullNumber}/comments?per_page=100&page=${page}`,
      token: params.token,
    });
    if (!Array.isArray(pageComments) || pageComments.length === 0) {
      break;
    }
    comments.push(...pageComments);
    if (pageComments.length < 100) {
      break;
    }
  }
  return comments;
};

export const findExistingCommentByMarker = (comments, marker) =>
  Array.isArray(comments)
    ? comments.find((comment) => normalizeText(comment?.body).includes(marker))
    : null;

export const upsertIssueComment = async (params) => {
  const normalizedBody = normalizeBody(params.body);
  const existingComment = params.existingComment ?? null;
  if (existingComment?.id) {
    const previousBody = normalizeBody(existingComment.body);
    if (params.skipIfUnchanged && previousBody === normalizedBody) {
      return createAnnotationResult({
        status: 'unchanged',
        reason: 'body-unchanged',
        url: String(existingComment.html_url ?? ''),
        id: existingComment.id,
        previousBody,
        updatedBody: normalizedBody,
      });
    }
    const updated = await params.githubApiRequest({
      method: 'PATCH',
      endpoint: `/repos/${params.owner}/${params.repo}/issues/comments/${existingComment.id}`,
      token: params.token,
      body: { body: normalizedBody },
    });
    return createAnnotationResult({
      status: 'updated',
      reason: '',
      url: String(updated?.html_url ?? ''),
      id: Number(updated?.id ?? existingComment.id) || null,
      previousBody,
      updatedBody: normalizedBody,
    });
  }
  const created = await params.githubApiRequest({
    method: 'POST',
    endpoint: `/repos/${params.owner}/${params.repo}/issues/${params.pullNumber}/comments`,
    token: params.token,
    body: { body: normalizedBody },
  });
  return createAnnotationResult({
    status: 'created',
    reason: '',
    url: String(created?.html_url ?? ''),
    id: Number(created?.id ?? 0) || null,
    previousBody: '',
    updatedBody: normalizedBody,
  });
};

export const upsertReleaseBodyBlock = async (params) => {
  const marker = normalizeText(params.marker);
  const start = `<!-- ${marker}:start -->`;
  const end = `<!-- ${marker}:end -->`;
  const replacement = `${start}\n${params.content}\n${end}`;
  const release = await params.githubApiRequest({
    method: 'GET',
    endpoint: `/repos/${params.owner}/${params.repo}/releases/${params.releaseId}`,
    token: params.token,
  });
  const existingBody = normalizeText(release?.body);
  const blockPattern = new RegExp(`<!-- ${marker}:start -->[\\s\\S]*?<!-- ${marker}:end -->`, 'u');
  const hasBlock = blockPattern.test(existingBody);
  const mergedBody = hasBlock
    ? existingBody.replace(blockPattern, replacement)
    : existingBody
      ? `${existingBody}\n\n${replacement}`
      : replacement;
  if (normalizeBody(existingBody) === normalizeBody(mergedBody)) {
    return createAnnotationResult({
      status: 'unchanged',
      reason: 'release-block-unchanged',
      url: String(release?.html_url ?? ''),
      id: Number(release?.id ?? params.releaseId) || null,
      previousBody: existingBody,
      updatedBody: mergedBody,
    });
  }
  const updated = await params.githubApiRequest({
    method: 'PATCH',
    endpoint: `/repos/${params.owner}/${params.repo}/releases/${params.releaseId}`,
    token: params.token,
    body: { body: mergedBody },
  });
  return createAnnotationResult({
    status: hasBlock ? 'updated' : 'created',
    reason: '',
    url: String(updated?.html_url ?? ''),
    id: Number(updated?.id ?? params.releaseId) || null,
    previousBody: existingBody,
    updatedBody: mergedBody,
  });
};

export const resolveAssociatedPullRequest = async (params) => {
  const pullNumberFromEvent = Number(params.eventPayload?.pull_request?.number ?? 0);
  if (Number.isFinite(pullNumberFromEvent) && pullNumberFromEvent > 0) {
    return {
      number: pullNumberFromEvent,
      source: 'event',
    };
  }
  const commitSha = normalizeText(params.commitSha);
  if (!commitSha) {
    return null;
  }
  const pulls = await params.githubApiRequest({
    method: 'GET',
    endpoint: `/repos/${params.owner}/${params.repo}/commits/${commitSha}/pulls`,
    token: params.token,
    accept: 'application/vnd.github+json',
  });
  if (!Array.isArray(pulls) || pulls.length === 0) {
    return null;
  }
  const preferred = sortPullRequests(pulls).find(
    (pull) => Number.isFinite(Number(pull?.number)) && Number(pull.number) > 0,
  );
  if (!preferred) {
    return null;
  }
  return {
    number: Number(preferred.number),
    source: 'commit',
  };
};
