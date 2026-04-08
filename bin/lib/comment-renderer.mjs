import { buildMetadataComment } from './comment-metadata.mjs';
import { normalizeText } from './text-utils.mjs';

const DEFAULT_SUBMIT_URL = 'https://hol.org/registry/skills/submit';

const normalizeNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const formatNumber = (value, decimals = 1) => {
  const numeric = normalizeNumber(value);
  if (numeric === null) {
    return 'n/a';
  }
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(decimals);
};

const formatDelta = (value) => {
  const numeric = normalizeNumber(value);
  if (numeric === null || numeric === 0) {
    return null;
  }
  const sign = numeric > 0 ? '+' : '';
  return `${sign}${Number.isInteger(numeric) ? numeric : numeric.toFixed(1)}`;
};

const formatLink = (label, href) => {
  const normalizedHref = normalizeText(href);
  return normalizedHref ? `[${label}](${normalizedHref})` : label;
};

const appendQueryParam = (rawUrl, key, value) => {
  const normalized = normalizeText(rawUrl);
  if (!normalized) {
    return '';
  }
  try {
    const url = new URL(normalized);
    url.searchParams.set(key, value);
    return url.toString();
  } catch {
    return normalized;
  }
};

const normalizeHintLevel = (value) => {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'off' || normalized === 'detailed') {
    return normalized;
  }
  return 'soft';
};

const readSignalScore = (params, key) => {
  const scoreFromMetadata =
    params?.signalScores && typeof params.signalScores === 'object'
      ? normalizeNumber(params.signalScores[key] ?? null)
      : null;
  if (scoreFromMetadata !== null) {
    return scoreFromMetadata;
  }
  const hcs28Value = params?.hcs28?.trustScores?.[key];
  return normalizeNumber(hcs28Value);
};

const buildMissingRequirementSet = (value) =>
  new Set(
    Array.isArray(value)
      ? value.map((entry) => normalizeText(entry)).filter((entry) => entry.length > 0)
      : [],
  );

export function humanizePublishReadiness(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'ready') {
    return 'Publish-ready';
  }
  if (normalized === 'quoted') {
    return 'Quote available';
  }
  if (normalized === 'published') {
    return 'Published';
  }
  if (normalized === 'blocked') {
    return 'Publish blocked';
  }
  return normalized || 'Unknown';
}

export function humanizeTrustTier(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return 'Unscored';
  }
  if (normalized === 'validated') {
    return 'Validated';
  }
  if (normalized === 'published') {
    return 'Published';
  }
  if (normalized === 'verified') {
    return 'Verified';
  }
  if (normalized === 'hardened') {
    return 'Hardened';
  }
  return normalized[0].toUpperCase() + normalized.slice(1);
}

export function humanizeMissingRequirement(code, context = {}) {
  const normalized = normalizeText(code).toLowerCase();
  if (normalized === 'repo_url') {
    return {
      title: 'Repository provenance missing',
      detail:
        'Publish from GitHub or provide repository metadata so HOL can bind the release to a canonical repository.',
    };
  }
  if (normalized === 'commit_sha') {
    return {
      title: 'Commit provenance missing',
      detail:
        'Publish with commit stamping enabled so HOL can verify the exact commit that produced this package.',
    };
  }
  if (normalized === 'stable_version') {
    return {
      title: 'Stable version required',
      detail:
        'Production publishes require stable semver by default. Use a stable version or explicitly allow a prerelease override.',
    };
  }
  const fallback = normalizeText(context.fallbackMessage);
  return {
    title: normalized || 'Requirement missing',
    detail: fallback || 'Address this requirement before publish can proceed.',
  };
}

const buildSignalRows = (params) => {
  const signals = [
    ['Domain proof', 'verification.domain-proof.score'],
    ['Manifest integrity', 'verification.manifest-integrity.score'],
    ['Repo + commit integrity', 'verification.repo-commit-integrity.score'],
    ['Cisco safety scan', 'safety.cisco-scan.score'],
    ['Repository health', 'repository.health.score'],
  ];
  return signals.map(([label, key]) => {
    const score = readSignalScore(params, key);
    const status = (() => {
      if (score === null) {
        return 'Pending';
      }
      if (key === 'verification.domain-proof.score') {
        return score >= 100 ? 'Verified' : 'Link domain on HOL';
      }
      if (key === 'verification.manifest-integrity.score') {
        return score >= 100 ? 'Pinned' : 'Republish package';
      }
      if (key === 'verification.repo-commit-integrity.score') {
        return score >= 100 ? 'Bound to repo' : 'Align repo commit';
      }
      if (key === 'safety.cisco-scan.score') {
        if (score >= 90) {
          return 'Strong';
        }
        if (score >= 70) {
          return 'Review findings';
        }
        return 'Needs hardening';
      }
      if (key === 'repository.health.score') {
        if (score >= 80) {
          return 'Healthy';
        }
        if (score >= 60) {
          return 'Watchlist';
        }
        return 'Needs cleanup';
      }
      return score >= 100 ? 'Passed' : 'In progress';
    })();
    return `| ${label} | ${formatNumber(score)} | ${status} |`;
  });
};

export function buildPackageSummaryLines(packageSummary) {
  const included = normalizeNumber(packageSummary?.includedFileCount);
  const excluded = normalizeNumber(packageSummary?.excludedFileCount);
  const totalBytes = normalizeNumber(packageSummary?.totalBytes);
  return [
    `- Included files: \`${included ?? 0}\``,
    `- Excluded files: \`${excluded ?? 0}\``,
    `- Total bytes: \`${totalBytes ?? 0}\``,
  ];
}

export function buildPreviewDelta(previousMetadata, currentMetadata) {
  if (!previousMetadata || typeof previousMetadata !== 'object') {
    return 'First preview comment for this PR.';
  }
  const changes = [];
  const hcsDelta = normalizeNumber(currentMetadata.hcs28Total) !== null &&
    normalizeNumber(previousMetadata.hcs28Total) !== null
      ? normalizeNumber(currentMetadata.hcs28Total) - normalizeNumber(previousMetadata.hcs28Total)
      : null;
  const hcsDeltaText = formatDelta(hcsDelta);
  if (hcsDeltaText) {
    changes.push(`HCS-28 ${hcsDeltaText}`);
  }
  if (normalizeText(previousMetadata.trustTier) !== normalizeText(currentMetadata.trustTier)) {
    changes.push(
      `trust tier ${normalizeText(previousMetadata.trustTier) || 'n/a'} \u2192 ${normalizeText(currentMetadata.trustTier) || 'n/a'}`,
    );
  }
  if (
    normalizeText(previousMetadata.publishReadiness) !== normalizeText(currentMetadata.publishReadiness)
  ) {
    changes.push(
      `readiness ${normalizeText(previousMetadata.publishReadiness) || 'n/a'} \u2192 ${normalizeText(currentMetadata.publishReadiness) || 'n/a'}`,
    );
  }
  const previousRequirements = buildMissingRequirementSet(previousMetadata.missingRequirements);
  const currentRequirements = buildMissingRequirementSet(currentMetadata.missingRequirements);
  const addedRequirements = [...currentRequirements].filter((entry) => !previousRequirements.has(entry));
  const removedRequirements = [...previousRequirements].filter((entry) => !currentRequirements.has(entry));
  if (addedRequirements.length > 0) {
    changes.push(`blockers added: ${addedRequirements.join(', ')}`);
  }
  if (removedRequirements.length > 0) {
    changes.push(`blockers removed: ${removedRequirements.join(', ')}`);
  }
  if (
    normalizeText(previousMetadata.estimatedCreditsRange) !==
    normalizeText(currentMetadata.estimatedCreditsRange)
  ) {
    changes.push(
      `estimated credits ${normalizeText(previousMetadata.estimatedCreditsRange) || 'n/a'} \u2192 ${normalizeText(currentMetadata.estimatedCreditsRange) || 'n/a'}`,
    );
  }
  const packageKeys = ['includedFileCount', 'excludedFileCount', 'totalBytes'];
  const packageChanged = packageKeys.some(
    (key) =>
      normalizeNumber(previousMetadata.packageSummary?.[key]) !==
      normalizeNumber(currentMetadata.packageSummary?.[key]),
  );
  if (packageChanged) {
    changes.push('package summary changed');
  }
  if (changes.length === 0) {
    return 'No meaningful change from the previous preview run.';
  }
  return `Compared with the previous preview run on this PR: ${changes.join(', ')}.`;
}

export function buildPublishDelta(previousMetadata, currentMetadata) {
  if (!previousMetadata || typeof previousMetadata !== 'object') {
    return 'First publish annotation for this surface.';
  }
  const changes = [];
  if (normalizeText(previousMetadata.published) !== normalizeText(currentMetadata.published)) {
    changes.push(`published ${normalizeText(previousMetadata.published)} \u2192 ${normalizeText(currentMetadata.published)}`);
  }
  if (normalizeText(previousMetadata.skipReason) !== normalizeText(currentMetadata.skipReason)) {
    changes.push(
      `skip reason ${normalizeText(previousMetadata.skipReason) || 'none'} \u2192 ${normalizeText(currentMetadata.skipReason) || 'none'}`,
    );
  }
  if (normalizeText(previousMetadata.jobId) !== normalizeText(currentMetadata.jobId)) {
    changes.push('job id updated');
  }
  if (changes.length === 0) {
    return 'No meaningful change from the previous publish result.';
  }
  return `Compared with the previous publish annotation: ${changes.join(', ')}.`;
}

export function buildTrustUpgradeTips(params) {
  const tips = [];
  const domainProofScore = readSignalScore(params, 'verification.domain-proof.score');
  const repoIntegrityScore = readSignalScore(params, 'verification.repo-commit-integrity.score');
  const manifestIntegrityScore = readSignalScore(params, 'verification.manifest-integrity.score');
  const ciscoScore = readSignalScore(params, 'safety.cisco-scan.score');
  const repositoryHealthScore = readSignalScore(params, 'repository.health.score');
  const submitUrl = normalizeText(params.purchaseUrl || params.submitUrl || DEFAULT_SUBMIT_URL);
  const publishUrl = normalizeText(params.publishUrl || submitUrl || DEFAULT_SUBMIT_URL);
  const securityUrl = appendQueryParam(params.statusUrl, 'tab', 'security-breakdown');
  if (domainProofScore !== null && domainProofScore < 100) {
    tips.push(
      `- Domain proof: open ${formatLink('HOL Skills submit', submitUrl)}, submit or manage this skill there, and link your domain so HOL can verify the TXT record.`,
    );
  }
  if (repoIntegrityScore !== null && repoIntegrityScore < 100) {
    tips.push(
      `- Repo + commit integrity: use ${formatLink('the publish workflow', publishUrl)} so HOL can stamp this release to the exact repository commit.`,
    );
  }
  if (manifestIntegrityScore !== null && manifestIntegrityScore < 100) {
    tips.push(
      '- Manifest integrity: republish from the packaged skill directory so HOL can pin a manifest that matches shipped files.',
    );
  }
  if (ciscoScore !== null && ciscoScore < 100) {
    const securityTarget = normalizeText(securityUrl || params.statusUrl || publishUrl);
    tips.push(
      `- Cisco safety scan: review ${formatLink('the security breakdown', securityTarget)} and harden flagged files before the next publish.`,
    );
  }
  if (repositoryHealthScore !== null && repositoryHealthScore < 80) {
    const statusTarget = normalizeText(params.statusUrl || submitUrl || publishUrl);
    tips.push(
      `- Repository health: clean up stale metadata, docs, and workflow drift, then re-run validate from ${formatLink('the status page', statusTarget)}.`,
    );
  }
  return tips;
}

export function renderLinksBlock(params) {
  const lines = [];
  const statusUrl = normalizeText(params.statusUrl);
  const purchaseUrl = normalizeText(params.purchaseUrl || params.submitUrl);
  const publishUrl = normalizeText(params.publishUrl);
  const verificationUrl = normalizeText(params.verificationUrl);
  if (statusUrl) {
    lines.push(`- Status page: ${formatLink('Open on HOL', statusUrl)}`);
  }
  if (purchaseUrl) {
    lines.push(`- Manage on HOL: ${formatLink('Open submit flow', purchaseUrl)}`);
  }
  if (publishUrl) {
    lines.push(`- Publish guide: ${formatLink('Review publish flow', publishUrl)}`);
  }
  if (verificationUrl) {
    lines.push(`- Verification flow: ${formatLink('Set up verification', verificationUrl)}`);
  }
  return lines;
}

const renderPreviewVerdict = (params) => {
  if (normalizeText(params.mode).toLowerCase() === 'quote') {
    return 'HOL skill-publish · 🧾 Quote available';
  }
  return normalizeText(params.publishReadiness).toLowerCase() === 'ready'
    ? 'HOL skill-publish · ✅ Publish-ready'
    : 'HOL skill-publish · ⚠ Publish blocked';
};

const renderBlockers = (params) => {
  const blockers = Array.isArray(params.missingRequirements) ? params.missingRequirements : [];
  if (blockers.length === 0) {
    return ['No blocking requirements detected.'];
  }
  return blockers.map((entry) => {
    const detail = humanizeMissingRequirement(entry);
    return `- **${detail.title}**: ${detail.detail}`;
  });
};

export function renderPreviewComment(params) {
  const hintLevel = normalizeHintLevel(params.conversionHintLevel);
  const metadataComment = buildMetadataComment(params.encodedMetadata);
  const packageSummary = params.packageSummary ?? {};
  const lines = [];
  lines.push(params.marker);
  lines.push(`<!-- skill-publish-state:${params.stateSignature} -->`);
  if (metadataComment) {
    lines.push(metadataComment);
  }
  lines.push(`## ${renderPreviewVerdict(params)}`);
  lines.push('');
  lines.push(
    `\`${params.skillName}@${params.skillVersion}\` checked in \`${params.mode}\` mode and is currently **${humanizePublishReadiness(params.publishReadiness)}**.`,
  );
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Trust tier | \`${humanizeTrustTier(params.trustTier)}\` |`);
  lines.push(`| HCS-28 total | \`${formatNumber(params.hcs28Total ?? readSignalScore(params, 'total'))}\` |`);
  lines.push(`| Publish readiness | \`${humanizePublishReadiness(params.publishReadiness)}\` |`);
  lines.push(`| Missing requirements | \`${Array.isArray(params.missingRequirements) ? params.missingRequirements.length : 0}\` |`);
  lines.push(`| Estimated credits | \`${normalizeText(params.estimatedCreditsRange) || 'n/a'}\` |`);
  lines.push(`| Included files | \`${normalizeNumber(packageSummary.includedFileCount) ?? 0}\` |`);
  lines.push(`| Excluded files | \`${normalizeNumber(packageSummary.excludedFileCount) ?? 0}\` |`);
  lines.push(`| Total bytes | \`${normalizeNumber(packageSummary.totalBytes) ?? 0}\` |`);
  if (normalizeText(params.workflowRunUrl)) {
    lines.push(`| Workflow run | ${formatLink('Open run', params.workflowRunUrl)} |`);
  }
  lines.push('');
  lines.push('### Blockers');
  lines.push('');
  lines.push(...renderBlockers(params));
  lines.push('');
  lines.push('### Delta');
  lines.push('');
  lines.push(buildPreviewDelta(params.previousMetadata, params.currentMetadata));
  lines.push('');
  lines.push('### Signal breakdown');
  lines.push('');
  lines.push('| Signal | Score | Status |');
  lines.push('| --- | --- | --- |');
  lines.push(...buildSignalRows(params));
  const linkLines = renderLinksBlock(params);
  if (linkLines.length > 0) {
    lines.push('');
    lines.push('### Links');
    lines.push('');
    lines.push(...linkLines);
  }
  if (hintLevel !== 'off') {
    const tips = buildTrustUpgradeTips(params);
    if (tips.length > 0) {
      lines.push('');
      lines.push('### How to improve this score');
      lines.push('');
      lines.push(...tips);
    }
  }
  if (Array.isArray(params.nextActions) && params.nextActions.length > 0) {
    const first = params.nextActions.find((entry) => normalizeText(entry?.label)) ?? null;
    if (first) {
      lines.push('');
      lines.push('### Recommended next step');
      lines.push('');
      lines.push(`**Recommended next step:** ${formatLink(first.label, first.href)}`);
      if (normalizeText(first.description)) {
        lines.push('');
        lines.push(first.description.trim());
      }
    }
  }
  if (hintLevel === 'detailed') {
    lines.push('');
    lines.push('<details>');
    lines.push('<summary>Package details</summary>');
    lines.push('');
    lines.push(...buildPackageSummaryLines(packageSummary));
    lines.push('</details>');
  }
  return lines.join('\n');
}

export function buildSnippetDetails(distribution) {
  const snippets = distribution?.snippets ?? {};
  const lines = [];
  const badgeMarkdown = normalizeText(snippets.badgeMarkdown);
  const readmeSnippet = normalizeText(snippets.readmeSnippet);
  if (badgeMarkdown) {
    lines.push('#### Badge');
    lines.push('```md');
    lines.push(badgeMarkdown);
    lines.push('```');
  }
  if (readmeSnippet) {
    lines.push('#### README snippet');
    lines.push('```md');
    lines.push(readmeSnippet);
    lines.push('```');
  }
  return lines;
}

export function renderPublishComment(params) {
  const metadataComment = buildMetadataComment(params.encodedMetadata);
  const lines = [];
  lines.push(params.marker);
  lines.push(`<!-- skill-publish-state:${params.stateSignature} -->`);
  if (metadataComment) {
    lines.push(metadataComment);
  }
  lines.push('## HOL skill-publish · 📦 Publish result');
  lines.push('');
  lines.push(`\`${params.skillName}@${params.skillVersion}\` is **${params.published ? 'published' : 'skipped'}**.`);
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Status | \`${params.published ? 'published' : 'skipped'}\` |`);
  lines.push(`| Trust tier | \`${humanizeTrustTier(params.trustTier || 'published')}\` |`);
  lines.push(`| Credits | \`${normalizeText(params.credits) || '0'}\` |`);
  lines.push(`| Estimated HBAR | \`${normalizeText(params.estimatedCostHbar) || '0'}\` |`);
  lines.push(`| Quote ID | \`${normalizeText(params.quoteId) || 'n/a'}\` |`);
  lines.push(`| Job ID | \`${normalizeText(params.jobId) || 'n/a'}\` |`);
  if (!params.published && normalizeText(params.skipReason)) {
    lines.push(`| Skip reason | \`${normalizeText(params.skipReason)}\` |`);
  }
  lines.push('');
  lines.push(buildPublishDelta(params.previousMetadata, params.currentMetadata));
  lines.push('');
  lines.push('### Distribution');
  lines.push('');
  lines.push(`- Canonical page: ${formatLink('Open skill page', params.skillPageUrl)}`);
  lines.push(`- Pinned SKILL.md: ${formatLink('Pinned install URL', params.pinnedSkillMdUrl)}`);
  lines.push(`- Latest SKILL.md: ${formatLink('Latest install URL', params.latestSkillMdUrl)}`);
  lines.push(`- Pinned manifest: ${formatLink('Pinned manifest', params.pinnedManifestUrl)}`);
  lines.push(`- Install metadata: ${formatLink('Pinned install metadata', params.installMetadataPinnedUrl)}`);
  lines.push('');
  lines.push('### Provenance');
  lines.push('');
  lines.push(`- skill.json HRL: \`${normalizeText(params.skillJsonHrl) || 'n/a'}\``);
  lines.push(`- Directory topic: \`${normalizeText(params.directoryTopicId) || 'n/a'}\``);
  lines.push(`- Package topic: \`${normalizeText(params.packageTopicId) || 'n/a'}\``);
  lines.push(`- Repo: \`${normalizeText(params.repoUrl) || 'n/a'}\``);
  lines.push(`- Commit: \`${normalizeText(params.commitSha) || 'n/a'}\``);
  if (normalizeText(params.workflowRunUrl)) {
    lines.push(`- Workflow run: ${formatLink('Open run', params.workflowRunUrl)}`);
  }
  const snippetLines = buildSnippetDetails(params.distribution);
  if (snippetLines.length > 0) {
    lines.push('');
    lines.push('<details>');
    lines.push('<summary>Reusable snippets</summary>');
    lines.push('');
    lines.push(...snippetLines);
    lines.push('</details>');
  }
  return lines.join('\n');
}

export function renderReleaseBlock(params) {
  const lines = [];
  lines.push('### HOL skill-publish');
  lines.push('');
  lines.push(`- Skill: \`${params.skillName}@${params.skillVersion}\``);
  lines.push(`- Canonical page: ${formatLink('Open skill page', params.skillPageUrl)}`);
  lines.push(`- Pinned SKILL.md: ${formatLink('Pinned install URL', params.pinnedSkillMdUrl)}`);
  lines.push(`- Badge: ${normalizeText(params.badgeMarkdown) || 'n/a'}`);
  lines.push(`- skill.json HRL: \`${normalizeText(params.skillJsonHrl) || 'n/a'}\``);
  lines.push(`- Directory topic: \`${normalizeText(params.directoryTopicId) || 'n/a'}\``);
  lines.push(`- Package topic: \`${normalizeText(params.packageTopicId) || 'n/a'}\``);
  lines.push('');
  lines.push('This block is managed by skill-publish and is updated in place on reruns.');
  return lines.join('\n');
}
