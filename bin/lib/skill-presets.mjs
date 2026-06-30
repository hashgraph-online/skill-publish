const DEFAULT_PRESET_ID = 'general';

export const SKILL_PRESETS = {
  general: {
    id: 'general',
    label: 'General skill',
    category: 'general',
    tags: ['general'],
    overview: 'Describe what this skill helps users do.',
    whenToUse: ['Add the primary scenarios this skill is designed for.'],
    inputs: ['List required inputs and expected formats.'],
    output: ['Explain the expected result and format.'],
    constraints: ['Note boundaries, safety requirements, and assumptions.'],
  },
  api: {
    id: 'api',
    label: 'API-backed skill',
    category: 'integrations',
    tags: ['api', 'integration'],
    overview: 'Describe the external API, auth model, and the user outcome this skill unlocks.',
    whenToUse: ['Use when a task depends on a stable external API or SaaS integration.'],
    inputs: ['List required credentials, endpoints, and expected request parameters.'],
    output: ['Describe the response shape and what the assistant should return to the user.'],
    constraints: ['Document auth handling, rate limits, and failure behavior.'],
  },
  docs: {
    id: 'docs',
    label: 'Docs skill',
    category: 'documentation',
    tags: ['docs', 'knowledge-base'],
    overview: 'Describe the documentation corpus this skill encodes and the questions it answers.',
    whenToUse: ['Use when the assistant should answer from a specific docs set or policy corpus.'],
    inputs: ['List the product area, docs source, or knowledge scope.'],
    output: ['Describe the expected answer style, citations, and escalation path.'],
    constraints: ['State freshness expectations, unsupported topics, and citation rules.'],
  },
  mcp: {
    id: 'mcp',
    label: 'MCP skill',
    category: 'mcp',
    tags: ['mcp', 'tools'],
    overview: 'Describe the MCP server, the exposed tools, and the user workflows this skill enables.',
    whenToUse: ['Use when the assistant should call MCP tools or coordinate with an MCP server.'],
    inputs: ['List required tool names, resources, auth, and safety expectations.'],
    output: ['Explain the expected tool-selection behavior and final answer format.'],
    constraints: ['Document tool limits, side effects, and confirmation rules before destructive actions.'],
  },
  approval: {
    id: 'approval',
    label: 'Approval-gated skill',
    category: 'safety',
    tags: ['approval', 'human-in-the-loop', 'publishing'],
    overview:
      'Describe the workflow that drafts or prepares user-facing output, then stops for explicit approval before side effects.',
    whenToUse: [
      'Use when the assistant drafts social posts, emails, support replies, release notes, or other publishable content.',
    ],
    inputs: ['List source evidence, target channels, reviewer identity, and any configured publishing tools.'],
    output: ['Return a review packet, approval prompt, and execution result only after approval is recorded.'],
    constraints: [
      'Require an exact approval signal before publishing, sending, scheduling, deleting, or mutating external state.',
    ],
  },
  assistant: {
    id: 'assistant',
    label: 'Assistant skill',
    category: 'assistant',
    tags: ['assistant', 'workflow'],
    overview: 'Describe the assistant persona, workflow, or recurring job this skill standardizes.',
    whenToUse: ['Use when the user wants a repeatable workflow or specialized assistant behavior.'],
    inputs: ['List user context, required decisions, and expected artifacts.'],
    output: ['Describe the deliverable format and tone.'],
    constraints: ['Explain guardrails, escalation rules, and when the assistant should stop or ask.'],
  },
  monorepo: {
    id: 'monorepo',
    label: 'Monorepo skill',
    category: 'developer-tools',
    tags: ['monorepo', 'developer-tools'],
    overview: 'Describe the repository layout, package boundaries, and the workflows this skill coordinates.',
    whenToUse: ['Use when the assistant must navigate multiple packages or apps in one repository.'],
    inputs: ['List package directories, build/test commands, and ownership boundaries.'],
    output: ['Explain the preferred delivery shape across multiple packages.'],
    constraints: ['Document repo-specific guardrails, forbidden paths, and verification expectations.'],
  },
};

export function listSkillPresetIds() {
  return Object.keys(SKILL_PRESETS);
}

export function resolveSkillPreset(value) {
  const requested = String(value ?? '').trim().toLowerCase();
  if (!requested) {
    return SKILL_PRESETS[DEFAULT_PRESET_ID];
  }
  return SKILL_PRESETS[requested] ?? null;
}

function renderBulletSection(title, lines) {
  const entries = Array.isArray(lines) ? lines : [];
  const body = entries.length > 0 ? entries.map((entry) => `- ${entry}`).join('\n') : '- Add details.';
  return `## ${title}\n${body}`;
}

export function buildSkillMarkdown(params) {
  const preset = resolveSkillPreset(params.preset);
  const selectedPreset = preset ?? SKILL_PRESETS[DEFAULT_PRESET_ID];
  const description = String(params.description ?? '').trim() || selectedPreset.overview;
  return `# ${params.skillName}

## Overview
${description}

${renderBulletSection('When To Use', selectedPreset.whenToUse)}

${renderBulletSection('Inputs', selectedPreset.inputs)}

${renderBulletSection('Output', selectedPreset.output)}

${renderBulletSection('Constraints', selectedPreset.constraints)}
`;
}

export function buildSkillJson(params) {
  const preset = resolveSkillPreset(params.preset);
  const selectedPreset = preset ?? SKILL_PRESETS[DEFAULT_PRESET_ID];
  const extraTags = Array.isArray(params.tags) ? params.tags : [];
  const tags = [...new Set([params.skillName, ...selectedPreset.tags, ...extraTags].filter(Boolean))];

  return {
    name: params.skillName,
    version: params.version,
    description: String(params.description ?? '').trim() || selectedPreset.overview,
    license: 'Apache-2.0',
    author: process.env.USER || 'Skill Author',
    category: selectedPreset.category,
    tags,
  };
}
