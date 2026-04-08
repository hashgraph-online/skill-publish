import { normalizeText } from './text-utils.mjs';

const PREVIEW_MARKER_PREFIX = 'skill-publish-managed';
const PUBLISH_MARKER_PREFIX = 'skill-publish-publish';
const RELEASE_MARKER_PREFIX = 'skill-publish-release';
const METADATA_PREFIX = 'skill-publish-meta';
const METADATA_SCHEMA_VERSION = '1';

const normalizeArray = (value) =>
  Array.isArray(value)
    ? value.map((entry) => normalizeText(entry)).filter((entry) => entry.length > 0)
    : [];

const normalizeNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const base64UrlEncode = (input) => Buffer.from(input, 'utf8').toString('base64url');

const base64UrlDecode = (input) => Buffer.from(input, 'base64url').toString('utf8');

const normalizeGroupKey = (groupKey) => normalizeText(groupKey) || 'default';

export const normalizeReleaseIdentity = (identity) =>
  normalizeText(identity).replace(/[^a-z0-9_.:-]/giu, '-').slice(0, 180) || 'default';

export function buildPreviewCommentMarker(groupKey) {
  return `<!-- ${PREVIEW_MARKER_PREFIX}:${normalizeGroupKey(groupKey)} -->`;
}

export function buildPublishCommentMarker(groupKey) {
  return `<!-- ${PUBLISH_MARKER_PREFIX}:${normalizeGroupKey(groupKey)} -->`;
}

export function buildReleaseBlockMarker(identity) {
  return `${RELEASE_MARKER_PREFIX}:${normalizeReleaseIdentity(identity)}`;
}

export function buildReleaseBlockStart(marker) {
  return `<!-- ${marker}:start -->`;
}

export function buildReleaseBlockEnd(marker) {
  return `<!-- ${marker}:end -->`;
}

export function encodeCommentMetadata(metadata) {
  const payload = {
    schemaVersion: METADATA_SCHEMA_VERSION,
    ...metadata,
  };
  return base64UrlEncode(JSON.stringify(payload));
}

export function decodeCommentMetadata(body) {
  const text = normalizeText(body);
  const match = text.match(/<!-- skill-publish-meta:([A-Za-z0-9_-]+) -->/u);
  if (!match?.[1]) {
    return null;
  }
  try {
    const parsed = JSON.parse(base64UrlDecode(match[1]));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function extractLegacyStateSignature(body) {
  const text = normalizeText(body);
  const match = text.match(/<!-- skill-publish-state:(.+?) -->/u);
  return match?.[1]?.trim() ?? null;
}

export function buildStateSignature(metadata) {
  const signalScores =
    metadata && typeof metadata === 'object' && metadata.signalScores && typeof metadata.signalScores === 'object'
      ? metadata.signalScores
      : {};
  const packageSummary =
    metadata && typeof metadata === 'object' && metadata.packageSummary && typeof metadata.packageSummary === 'object'
      ? metadata.packageSummary
      : {};
  return JSON.stringify({
    surface: normalizeText(metadata?.surface),
    mode: normalizeText(metadata?.mode),
    trustTier: normalizeText(metadata?.trustTier),
    publishReadiness: normalizeText(metadata?.publishReadiness),
    missingRequirements: normalizeArray(metadata?.missingRequirements).sort(),
    estimatedCreditsRange: normalizeText(metadata?.estimatedCreditsRange),
    statusUrl: normalizeText(metadata?.statusUrl),
    hcs28Total: normalizeNumber(metadata?.hcs28Total),
    signalScores: {
      domainProof: normalizeNumber(signalScores.domainProof),
      manifestIntegrity: normalizeNumber(signalScores.manifestIntegrity),
      repoCommitIntegrity: normalizeNumber(signalScores.repoCommitIntegrity),
      ciscoScan: normalizeNumber(signalScores.ciscoScan),
      repositoryHealth: normalizeNumber(signalScores.repositoryHealth),
    },
    packageSummary: {
      includedFileCount: normalizeNumber(packageSummary.includedFileCount),
      excludedFileCount: normalizeNumber(packageSummary.excludedFileCount),
      totalBytes: normalizeNumber(packageSummary.totalBytes),
    },
    published: metadata?.published === true,
    skipReason: normalizeText(metadata?.skipReason),
  });
}

export function buildMetadataComment(encodedMetadata) {
  const value = normalizeText(encodedMetadata);
  return value ? `<!-- ${METADATA_PREFIX}:${value} -->` : '';
}
