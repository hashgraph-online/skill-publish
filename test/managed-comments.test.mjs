import assert from 'node:assert/strict';

import {
  buildManagedCommentBody,
  buildManagedCommentMarker,
} from '../bin/lib/managed-comments.mjs';

const body = buildManagedCommentBody({
  marker: buildManagedCommentMarker('scorecard'),
  stateSignature: 'sig-1',
  mode: 'monitor',
  skillName: 'registry-broker',
  skillVersion: '1.5.2',
  trustTier: 'verified',
  publishReadiness: 'ready',
  missingRequirements: ['repo_url'],
  estimatedCreditsRange: '64-76',
  statusUrl: 'https://hol.org/registry/skills/registry-broker',
  purchaseUrl: 'https://hol.org/registry/skills/submit',
  publishUrl: 'https://hol.org/registry/skills/publish',
  verificationUrl: 'https://hol.org/registry/skills/verify',
  nextActions: [
    {
      label: 'Verify domain proof',
      description: 'Add the TXT record to move this release into the verified tier.',
      href: 'https://hol.org/registry/skills/verify',
    },
  ],
  hcs28: {
    trustScores: {
      total: 74.5,
      'verification.domain-proof.score': 0,
      'verification.manifest-integrity.score': 100,
      'verification.repo-commit-integrity.score': 100,
      'safety.cisco-scan.score': 94,
      'repository.health.score': 76.5,
    },
  },
});

assert.match(body, /## HOL skill-publish · ✅ Publish-ready/u);
assert.match(body, /<!-- skill-publish-state:sig-1 -->/u);
assert.match(body, /<!-- skill-publish-meta:[A-Za-z0-9_-]+ -->/u);
assert.match(body, /`registry-broker@1\.5\.2` checked in `monitor` mode/u);
assert.match(body, /\| Trust tier \| `Verified` \|/u);
assert.match(body, /\| HCS-28 total \| `74\.5` \|/u);
assert.match(body, /\| Publish readiness \| `Publish-ready` \|/u);
assert.match(body, /\| Missing requirements \| `1` \|/u);
assert.match(body, /\| Domain proof \| 0 \| Link domain on HOL \|/u);
assert.match(body, /\| Cisco safety scan \| 94 \| Strong \|/u);
assert.match(body, /### Blockers/u);
assert.match(body, /Repository provenance missing/u);
assert.match(body, /### Delta/u);
assert.match(body, /First preview comment for this PR\./u);
assert.match(body, /### How to improve this score/u);
assert.match(body, /\[HOL Skills submit\]\(https:\/\/hol\.org\/registry\/skills\/submit\)/u);
assert.match(body, /link your domain so HOL can verify the TXT record/u);
assert.match(body, /Repository health: clean up stale metadata, docs, and workflow drift/u);
assert.match(
  body,
  /\[the status page\]\(https:\/\/hol\.org\/registry\/skills\/registry-broker\)/u,
);
assert.match(body, /\*\*Recommended next step:\*\* \[Verify domain proof\]/u);
assert.match(body, /### Links/u);
assert.match(body, /Manage on HOL: \[Open submit flow\]\(https:\/\/hol\.org\/registry\/skills\/submit\)/u);

console.log('managed-comments formatting test passed');

const fragmentBody = buildManagedCommentBody({
  marker: buildManagedCommentMarker('scorecard-fragment'),
  stateSignature: 'sig-2',
  mode: 'validate',
  skillName: 'fragment-skill',
  skillVersion: '1.0.0',
  trustTier: 'validated',
  publishReadiness: 'ready',
  missingRequirements: [],
  estimatedCreditsRange: '',
  statusUrl: 'https://hol.org/registry/skills/fragment-skill#overview',
  purchaseUrl: 'https://hol.org/registry/skills/submit',
  publishUrl: 'https://hol.org/registry/skills/publish',
  verificationUrl: '',
  nextActions: [],
  hcs28: {
    trustScores: {
      total: 41.2,
      'verification.domain-proof.score': 100,
      'verification.manifest-integrity.score': 100,
      'verification.repo-commit-integrity.score': 100,
      'safety.cisco-scan.score': 20,
      'repository.health.score': 81,
    },
  },
});

assert.match(
  fragmentBody,
  /\[the security breakdown\]\(https:\/\/hol\.org\/registry\/skills\/fragment-skill\?tab=security-breakdown#overview\)/u,
);
