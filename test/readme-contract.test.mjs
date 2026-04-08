import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const readme = await readFile(path.join(repoRoot, 'README.md'), 'utf8');
const actionManifest = await readFile(path.join(repoRoot, 'action.yml'), 'utf8');

const validateWorkflowIndex = readme.indexOf('name: Validate Skill');
const publishWorkflowIndex = readme.indexOf('name: Publish Skill');

assert.notEqual(validateWorkflowIndex, -1, 'README must include the validate workflow example');
assert.notEqual(publishWorkflowIndex, -1, 'README must include the publish workflow example');
assert.ok(
  validateWorkflowIndex < publishWorkflowIndex,
  'README must present the validate workflow example before the publish workflow example',
);

const quickStartIndex = readme.indexOf('## Quick Start');
const quickStartValidateIndex = readme.indexOf('mode: validate', quickStartIndex);
const quickStartPublishIndex = readme.indexOf('api-key: ${{ secrets.RB_API_KEY }}', quickStartIndex);

assert.notEqual(quickStartValidateIndex, -1, 'Quick Start must mention validate mode');
assert.notEqual(quickStartPublishIndex, -1, 'Quick Start must mention publish credentials');
assert.ok(
  quickStartValidateIndex < quickStartPublishIndex,
  'Quick Start must lead with validate-first guidance before publish credentials',
);

assert.match(
  actionManifest,
  /mode:\n\s+description:\s+"Execution mode: validate, monitor, quote, or publish"/u,
  'action.yml must expose the public mode input',
);
assert.match(
  actionManifest,
  /api-key:\n\s+description:\s+"Registry Broker API key \(required for quote and publish, optional for validate\)"/u,
  'action.yml must keep api-key optional globally so validate remains secretless',
);
assert.match(
  actionManifest,
  /- name: Enable pnpm\n\s+shell: bash\n\s+working-directory: \$\{\{ github\.action_path \}\}\n\s+run: corepack enable pnpm/u,
  'action.yml must enable pnpm inside github.action_path before running the entrypoint',
);
assert.match(
  actionManifest,
  /- name: Install action dependencies\n\s+shell: bash\n\s+working-directory: \$\{\{ github\.action_path \}\}\n\s+run: pnpm install --frozen-lockfile --prod --ignore-scripts/u,
  'action.yml must install production dependencies inside github.action_path',
);
assert.equal(
  actionManifest.includes('preview-upload:'),
  false,
  'action.yml must not expose preview-upload after OIDC preview uploads were removed',
);
assert.match(
  actionManifest,
  /preview-json:\n\s+description:\s+"Validate or monitor preview artifact JSON payload"/u,
  'action.yml must expose the preview-json output',
);
assert.match(
  actionManifest,
  /status-url:\n\s+description:\s+"Lifecycle status page URL when a preview or publish status page exists"/u,
  'action.yml must expose the status-url output',
);
assert.match(
  actionManifest,
  /managed-comment-status:\n\s+description:\s+"Managed preview comment update status \(disabled, skipped, created, updated, unchanged, failed\)"/u,
  'action.yml must expose managed-comment-status output',
);
assert.match(
  actionManifest,
  /publish-comment-status:\n\s+description:\s+"Publish lifecycle PR comment status \(disabled, skipped, created, updated, unchanged, failed\)"/u,
  'action.yml must expose publish-comment-status output',
);
assert.match(
  actionManifest,
  /release-annotation-status:\n\s+description:\s+"Release body lifecycle block status \(disabled, skipped, created, updated, unchanged, failed\)"/u,
  'action.yml must expose release-annotation-status output',
);
assert.equal(
  readme.includes('### GitHub Action (validate-first quickstart)'),
  true,
  'README must document validate-first GitHub setup explicitly.',
);
assert.equal(
  readme.includes('### GitHub Action (release publishing)'),
  true,
  'README must keep the publish workflow documented separately.',
);
assert.equal(
  readme.includes('Publishing immutable releases still consumes HOL Registry Broker credits.'),
  true,
  'README must state that publish remains credit-gated.',
);
assert.equal(
  readme.includes('`managed-comment-status`'),
  true,
  'README outputs must document managed-comment-status.',
);
assert.equal(
  readme.includes('`publish-comment-status`'),
  true,
  'README outputs must document publish-comment-status.',
);
assert.equal(
  readme.includes('`release-annotation-status`'),
  true,
  'README outputs must document release-annotation-status.',
);

process.stdout.write('readme/action contract test passed\n');
