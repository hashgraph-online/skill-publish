import {
  buildPreviewCommentMarker,
  buildStateSignature,
  decodeCommentMetadata,
  encodeCommentMetadata,
  extractLegacyStateSignature,
} from './comment-metadata.mjs';
import { renderPreviewComment } from './comment-renderer.mjs';
import { normalizeText } from './text-utils.mjs';

const DEFAULT_HINT_LEVEL = 'soft';

const normalizeArray = (value) =>
  Array.isArray(value)
    ? value.map((entry) => normalizeText(entry)).filter((entry) => entry.length > 0)
    : [];

const normalizeNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const normalizeNextAction = (value) => {
  if (typeof value === 'string') {
    const label = normalizeText(value);
    return label ? { label, description: '', href: '' } : null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const label = normalizeText(value.label);
  if (!label) {
    return null;
  }
  return {
    label,
    description: normalizeText(value.description),
    href: normalizeText(value.href || value.url),
  };
};

const signalScore = (hcs28, key) => normalizeNumber(hcs28?.trustScores?.[key]);

const normalizeHintLevel = (value) => {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'off' || normalized === 'detailed') {
    return normalized;
  }
  return DEFAULT_HINT_LEVEL;
};

export function buildManagedCommentMarker(groupKey) {
  return buildPreviewCommentMarker(groupKey);
}

export function extractManagedCommentState(body) {
  return extractLegacyStateSignature(body);
}

export function buildPreviewCommentMetadata(params) {
  const packageSummary = params.packageSummary ?? {};
  const hcs28 = params.hcs28 ?? {};
  const metadata = {
    surface: 'preview',
    mode: normalizeText(params.mode),
    groupKey: normalizeText(params.groupKey),
    skillName: normalizeText(params.skillName),
    skillVersion: normalizeText(params.skillVersion),
    skillDir: normalizeText(params.skillDir),
    trustTier: normalizeText(params.trustTier),
    publishReadiness: normalizeText(params.publishReadiness),
    missingRequirements: normalizeArray(params.missingRequirements),
    estimatedCreditsRange: normalizeText(params.estimatedCreditsRange),
    hcs28Total: signalScore(hcs28, 'total'),
    signalScores: {
      domainProof: signalScore(hcs28, 'verification.domain-proof.score'),
      manifestIntegrity: signalScore(hcs28, 'verification.manifest-integrity.score'),
      repoCommitIntegrity: signalScore(hcs28, 'verification.repo-commit-integrity.score'),
      ciscoScan: signalScore(hcs28, 'safety.cisco-scan.score'),
      repositoryHealth: signalScore(hcs28, 'repository.health.score'),
    },
    packageSummary: {
      includedFileCount: normalizeNumber(packageSummary.includedFileCount),
      excludedFileCount: normalizeNumber(packageSummary.excludedFileCount),
      totalBytes: normalizeNumber(packageSummary.totalBytes),
    },
    statusUrl: normalizeText(params.statusUrl),
    purchaseUrl: normalizeText(params.purchaseUrl),
    publishUrl: normalizeText(params.publishUrl),
    verificationUrl: normalizeText(params.verificationUrl),
    workflowRunUrl: normalizeText(params.workflowRunUrl),
    nextActions: Array.isArray(params.nextActions)
      ? params.nextActions.map(normalizeNextAction).filter(Boolean)
      : [],
    conversionHintLevel: normalizeHintLevel(params.conversionHintLevel),
    renderedAt: normalizeText(params.renderedAt || new Date().toISOString()),
  };
  return metadata;
}

export function buildManagedCommentStateSignature(params) {
  const metadata = buildPreviewCommentMetadata(params);
  return buildStateSignature(metadata);
}

export function shouldPublishManagedComment(params) {
  const commentMode = normalizeText(params.commentMode || 'off').toLowerCase();
  if (commentMode === 'off') {
    return false;
  }
  if (commentMode === 'always') {
    return true;
  }
  const readiness = normalizeText(params.publishReadiness).toLowerCase();
  const hasFailures = readiness !== 'ready';
  if (commentMode === 'failures-only') {
    return hasFailures;
  }
  if (commentMode === 'state-changes') {
    return hasFailures || params.commentOnSuccess === true;
  }
  return false;
}

export function buildManagedCommentBody(params) {
  const currentMetadata =
    params.currentMetadata && typeof params.currentMetadata === 'object'
      ? params.currentMetadata
      : buildPreviewCommentMetadata(params);
  const encodedMetadata = encodeCommentMetadata(currentMetadata);
  const previousMetadata =
    params.previousMetadata && typeof params.previousMetadata === 'object'
      ? params.previousMetadata
      : null;
  return renderPreviewComment({
    marker: params.marker,
    stateSignature: params.stateSignature || buildStateSignature(currentMetadata),
    encodedMetadata,
    currentMetadata,
    previousMetadata,
    mode: currentMetadata.mode,
    skillName: currentMetadata.skillName,
    skillVersion: currentMetadata.skillVersion,
    trustTier: currentMetadata.trustTier,
    publishReadiness: currentMetadata.publishReadiness,
    missingRequirements: currentMetadata.missingRequirements,
    estimatedCreditsRange: currentMetadata.estimatedCreditsRange,
    hcs28Total: currentMetadata.hcs28Total,
    hcs28: params.hcs28 ?? {},
    signalScores: currentMetadata.signalScores,
    packageSummary: currentMetadata.packageSummary,
    statusUrl: currentMetadata.statusUrl,
    purchaseUrl: currentMetadata.purchaseUrl,
    publishUrl: currentMetadata.publishUrl,
    verificationUrl: currentMetadata.verificationUrl,
    workflowRunUrl: currentMetadata.workflowRunUrl,
    nextActions: currentMetadata.nextActions,
    conversionHintLevel: currentMetadata.conversionHintLevel,
  });
}

export function extractManagedCommentMetadata(body) {
  return decodeCommentMetadata(body);
}
