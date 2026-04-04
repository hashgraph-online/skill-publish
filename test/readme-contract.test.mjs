import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const readme = await readFile(path.join(repoRoot, 'README.md'), 'utf8');

const validateHeading = '### GitHub Action (validate-first quickstart)';
const publishHeading = '### GitHub Action (release publishing)';

assert.equal(
  readme.includes(validateHeading),
  true,
  'README must document validate-first GitHub setup explicitly.',
);
assert.equal(
  readme.includes(publishHeading),
  true,
  'README must keep the publish workflow documented separately.',
);
assert.ok(
  readme.indexOf(validateHeading) < readme.indexOf(publishHeading),
  'README should present validate-first setup before publish workflow setup.',
);
assert.equal(
  readme.includes('Publishing immutable releases still consumes HOL Registry Broker credits.'),
  true,
  'README must state that publish remains credit-gated.',
);

process.stdout.write('readme-contract test passed\n');
