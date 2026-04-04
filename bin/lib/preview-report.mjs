import { createHash } from 'node:crypto';

function readDefaultBranch(eventPayload) {
  if (!eventPayload || typeof eventPayload !== 'object' || Array.isArray(eventPayload)) {
    return '';
  }
  const pullRequestBase = eventPayload.pull_request?.base?.repo?.default_branch;
  if (typeof pullRequestBase === 'string' && pullRequestBase.trim()) {
    return pullRequestBase.trim();
  }
  const repositoryDefault = eventPayload.repository?.default_branch;
  if (typeof repositoryDefault === 'string' && repositoryDefault.trim()) {
    return repositoryDefault.trim();
  }
  return '';
}

function readRepoParts(repository) {
  const raw = String(repository ?? '').trim();
  if (!raw || !raw.includes('/')) {
    return { repoOwner: '', repoName: '' };
  }
  const [repoOwner, repoName] = raw.split('/', 2);
  return {
    repoOwner: repoOwner?.trim() ?? '',
    repoName: repoName?.trim() ?? '',
  };
}

function buildPackageSummary(params) {
  return {
    included_file_count: params.files.length,
    excluded_file_count: params.excludedFiles.length,
    total_bytes: params.totalBytes,
    included_files: params.files.map((file) => ({
      path: file.name,
      mime_type: file.mimeType,
      role: file.role,
      size_bytes: file.sizeBytes,
    })),
    excluded_files: params.excludedFiles.map((file) => ({
      path: file.relativePath,
      reason: file.reason,
    })),
  };
}

function buildSuggestedNextSteps() {
  return [
    {
      id: 'open-pull-request',
      label: 'Run validate-first checks on every pull request',
      description:
        'Keep the validate workflow enabled so maintainers can prove package health before configuring publish credentials.',
      command: 'mode: validate',
      href: '',
    },
    {
      id: 'setup-publish',
      label: 'Prepare immutable publishing',
      description:
        'Add the publish-on-release workflow and configure the broker authentication path when you are ready to ship.',
      command: 'mode: publish',
      href: '',
    },
    {
      id: 'verify-domain',
      label: 'Plan verification upgrades',
      description:
        'After publish, add domain proof and provenance signals to climb from published to verified and hardened.',
      command: '',
      href: '',
    },
  ];
}

function createPreviewId(params) {
  const digest = createHash('sha256')
    .update(
      [
        String(params.repoUrl ?? '').trim().toLowerCase(),
        String(params.skillDir ?? '').trim().toLowerCase(),
        String(params.commitSha ?? '').trim().toLowerCase(),
        String(params.ref ?? '').trim().toLowerCase(),
        String(params.eventName ?? '').trim().toLowerCase(),
      ].join('\n'),
    )
    .digest('hex')
    .slice(0, 32);
  return `preview_${digest}`;
}

export function buildSkillPreviewReport(params) {
  const { repoOwner, repoName } = readRepoParts(params.repository);

  return {
    schema_version: 'skill-preview.v1',
    tool_version: params.toolVersion,
    preview_id: createPreviewId(params),
    repo_url: params.repoUrl,
    repo_owner: repoOwner,
    repo_name: repoName,
    default_branch: readDefaultBranch(params.eventPayload),
    commit_sha: params.commitSha,
    ref: params.ref,
    event_name: params.eventName,
    workflow_run_url: params.workflowRunUrl,
    skill_dir: params.skillDir,
    name: params.skillName,
    version: params.skillVersion,
    validation_status: 'passed',
    findings: [],
    package_summary: buildPackageSummary(params),
    suggested_next_steps: buildSuggestedNextSteps(),
    generated_at: params.generatedAt,
  };
}

export function formatPreviewNextActions(report) {
  const lines = [`Next actions for ${report.name}@${report.version}`];
  for (const [index, step] of report.suggested_next_steps.entries()) {
    lines.push(`${index + 1}. ${step.label}`);
  }
  return lines.join('\n');
}
