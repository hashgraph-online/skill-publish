import process from 'node:process';
import { createInterface } from 'node:readline/promises';

const START_CHOICES = [
  { id: 'quickstart', label: 'Quickstart walkthrough' },
  { id: 'setup', label: 'Set up API key and credits (ledger auth)' },
  { id: 'whoami', label: 'Show active broker account and balance' },
  { id: 'credits', label: 'Check credits and funding links' },
  { id: 'fund', label: 'Fund credits with a local Hedera signature' },
  { id: 'create', label: 'Create a full skill repo and run doctor' },
  { id: 'setup-action', label: 'Add GitHub publish workflow to existing repo' },
  { id: 'scaffold-repo', label: 'Scaffold full skill repo + workflow' },
  { id: 'init', label: 'Create a new skill package' },
  { id: 'validate', label: 'Validate an existing package' },
  { id: 'badge', label: 'Generate a badge snippet for a published version' },
  { id: 'install-url', label: 'Generate pinned/latest install URLs' },
  { id: 'release-notes', label: 'Generate release notes snippet' },
  { id: 'readme-snippet', label: 'Generate README snippet' },
  { id: 'attested-kit', label: 'Generate full attested distribution kit' },
  { id: 'apply-kit', label: 'Write README/docs/codemeta proof blocks locally' },
  { id: 'submit-indexnow', label: 'Submit canonical skill URLs to IndexNow' },
  { id: 'publish', label: 'Publish an existing package' },
  { id: 'doctor', label: 'Run doctor checks' },
  { id: 'help', label: 'Show full help' },
  { id: 'exit', label: 'Exit' },
];

const PRESET_HELP = 'general | api | docs | mcp | approval | assistant | monorepo';

function normalizeAnswer(value) {
  return String(value ?? '').trim();
}

function normalizeYesNo(value, fallback = false) {
  const trimmed = normalizeAnswer(value).toLowerCase();
  if (!trimmed) {
    return fallback;
  }
  if (trimmed === 'y' || trimmed === 'yes') {
    return true;
  }
  if (trimmed === 'n' || trimmed === 'no') {
    return false;
  }
  return fallback;
}

async function askChoice(rl) {
  for (;;) {
    process.stdout.write('\nChoose an action:\n');
    START_CHOICES.forEach((choice, index) => {
      process.stdout.write(`  ${index + 1}. ${choice.label}\n`);
    });
    const answer = normalizeAnswer(await rl.question(`\nSelect 1-${START_CHOICES.length}: `));
    const index = Number.parseInt(answer, 10);
    if (Number.isFinite(index) && index >= 1 && index <= START_CHOICES.length) {
      return START_CHOICES[index - 1].id;
    }
    process.stdout.write(`Invalid choice. Enter a number from 1 to ${START_CHOICES.length}.\n`);
  }
}

async function askRequired(rl, promptText) {
  for (;;) {
    const answer = normalizeAnswer(await rl.question(promptText));
    if (answer) {
      return answer;
    }
    process.stdout.write('This value is required.\n');
  }
}

async function askSecret(rl, promptText) {
  for (;;) {
    const output = rl.output;
    const originalWrite = output.write.bind(output);
    output.write = (chunk, encoding, callback) => {
      const text = typeof chunk === 'string' ? chunk : String(chunk);
      if (text.includes('\n') || text.includes('\r')) {
        return originalWrite(chunk, encoding, callback);
      }
      if (typeof callback === 'function') {
        callback();
      }
      return true;
    };

    let answer = '';
    try {
      answer = normalizeAnswer(await rl.question(promptText));
    } finally {
      output.write = originalWrite;
      process.stdout.write('\n');
    }

    if (answer) {
      return answer;
    }
    process.stdout.write('This value is required.\n');
  }
}

async function collectSetupOptions(rl) {
  const accountId = await askRequired(rl, 'Hedera account ID (e.g. 0.0.12345): ');
  const networkRaw = normalizeAnswer(await rl.question('Network [hedera:testnet]: '));
  const network = networkRaw || 'hedera:testnet';
  const hbarRaw = normalizeAnswer(await rl.question('HBAR top-up amount (optional): '));
  const hederaPrivateKey = await askSecret(
    rl,
    'Hedera private key for challenge signing (input hidden): ',
  );

  const options = {
    'account-id': accountId,
    network,
    'hedera-private-key': hederaPrivateKey,
  };
  if (hbarRaw) {
    options.hbar = hbarRaw;
  }
  return {
    command: 'setup',
    options,
    positionals: [],
  };
}

async function collectInitOptions(rl) {
  const directoryRaw = normalizeAnswer(await rl.question('Skill directory [./skills/my-skill]: '));
  const directory = directoryRaw || './skills/my-skill';
  const name = normalizeAnswer(await rl.question('Skill name (optional): '));
  const description = normalizeAnswer(await rl.question('Description (optional): '));
  const version = normalizeAnswer(await rl.question('Version [1.0.0]: '));
  const preset = normalizeAnswer(await rl.question(`Preset [general] (${PRESET_HELP}): `));

  const options = {};
  if (name) {
    options.name = name;
  }
  if (description) {
    options.description = description;
  }
  if (version) {
    options.version = version;
  }
  if (preset) {
    options.preset = preset;
  }
  return {
    command: 'init',
    options,
    positionals: [directory],
  };
}

async function collectValidateOptions(rl) {
  const directoryRaw = normalizeAnswer(await rl.question('Skill directory [.]: '));
  const directory = directoryRaw || '.';
  return {
    command: 'validate',
    options: {},
    positionals: [directory],
  };
}

async function collectPublishOptions(rl) {
  const directoryRaw = normalizeAnswer(await rl.question('Skill directory [.]: '));
  const directory = directoryRaw || '.';
  const dryRun = normalizeYesNo(await rl.question('Dry run first? [y/N]: '), false);
  const options = {};
  if (dryRun) {
    options['dry-run'] = true;
  }
  return {
    command: 'publish',
    options,
    positionals: [directory],
  };
}

async function collectDoctorOptions(rl) {
  const directoryRaw = normalizeAnswer(await rl.question('Skill directory [.]: '));
  const directory = directoryRaw || '.';
  const fix = normalizeYesNo(
    await rl.question('Auto-initialize a missing package when possible? [y/N]: '),
    false,
  );
  return {
    command: 'doctor',
    options: fix ? { fix: true } : {},
    positionals: [directory],
  };
}

async function collectBadgeOptions(rl) {
  const directoryRaw = normalizeAnswer(await rl.question('Skill directory [.]: '));
  const directory = directoryRaw || '.';
  const formatRaw = normalizeAnswer(await rl.question('Output format [markdown]: '));
  const format = formatRaw || 'markdown';
  return {
    command: 'badge',
    options: {
      format,
    },
    positionals: [directory],
  };
}

async function collectInstallUrlOptions(rl) {
  const directoryRaw = normalizeAnswer(await rl.question('Skill directory [.]: '));
  const directory = directoryRaw || '.';
  const formatRaw = normalizeAnswer(await rl.question('Output format [summary]: '));
  const format = formatRaw || 'summary';
  return {
    command: 'install-url',
    options: {
      format,
    },
    positionals: [directory],
  };
}

async function collectReleaseNotesOptions(rl) {
  const directoryRaw = normalizeAnswer(await rl.question('Skill directory [.]: '));
  const directory = directoryRaw || '.';
  return {
    command: 'release-notes',
    options: {},
    positionals: [directory],
  };
}

async function collectReadmeSnippetOptions(rl) {
  const directoryRaw = normalizeAnswer(await rl.question('Skill directory [.]: '));
  const directory = directoryRaw || '.';
  return {
    command: 'readme-snippet',
    options: {},
    positionals: [directory],
  };
}

async function collectAttestedKitOptions(rl) {
  const directoryRaw = normalizeAnswer(await rl.question('Skill directory [.]: '));
  const directory = directoryRaw || '.';
  const formatRaw = normalizeAnswer(await rl.question('Output format [json]: '));
  const format = formatRaw || 'json';
  return {
    command: 'attested-kit',
    options: { format },
    positionals: [directory],
  };
}

async function collectApplyKitOptions(rl) {
  const directoryRaw = normalizeAnswer(await rl.question('Skill directory [.]: '));
  const directory = directoryRaw || '.';
  const repoDirRaw = normalizeAnswer(await rl.question('Repository directory [.]: '));
  const repoDir = repoDirRaw || '.';
  const docsPath = normalizeAnswer(await rl.question('Docs path (optional): '));
  return {
    command: 'apply-kit',
    options: {
      'repo-dir': repoDir,
      ...(docsPath ? { 'docs-path': docsPath } : {}),
    },
    positionals: [directory],
  };
}

async function collectSubmitIndexNowOptions(rl) {
  const directoryRaw = normalizeAnswer(await rl.question('Skill directory [.]: '));
  const directory = directoryRaw || '.';
  return {
    command: 'submit-indexnow',
    options: {},
    positionals: [directory],
  };
}

async function collectSetupActionOptions(rl) {
  const directoryRaw = normalizeAnswer(await rl.question('Repository directory [.]: '));
  const directory = directoryRaw || '.';
  const skillDir = normalizeAnswer(await rl.question('Skill directory (auto-detect when empty): '));
  const triggerRaw = normalizeAnswer(await rl.question('Workflow trigger [release]: '));
  const trigger = triggerRaw || 'release';

  const options = {
    trigger,
  };
  if (skillDir) {
    options['skill-dir'] = skillDir;
  }

  return {
    command: 'setup-action',
    options,
    positionals: [directory],
  };
}

async function collectScaffoldRepoOptions(rl) {
  const directoryRaw = normalizeAnswer(await rl.question('New repository directory [./my-skill-repo]: '));
  const directory = directoryRaw || './my-skill-repo';
  const name = normalizeAnswer(await rl.question('Skill name (optional): '));
  const description = normalizeAnswer(await rl.question('Description (optional): '));
  const version = normalizeAnswer(await rl.question('Version [1.0.0]: '));
  const preset = normalizeAnswer(await rl.question(`Preset [general] (${PRESET_HELP}): `));
  const triggerRaw = normalizeAnswer(await rl.question('Workflow trigger [release]: '));
  const trigger = triggerRaw || 'release';

  const options = {
    trigger,
  };
  if (name) {
    options.name = name;
  }
  if (description) {
    options.description = description;
  }
  if (version) {
    options.version = version;
  }
  if (preset) {
    options.preset = preset;
  }

  return {
    command: 'scaffold-repo',
    options,
    positionals: [directory],
  };
}

async function collectCreateOptions(rl) {
  const directoryRaw = normalizeAnswer(await rl.question('New repository directory [./my-skill-repo]: '));
  const directory = directoryRaw || './my-skill-repo';
  const name = normalizeAnswer(await rl.question('Skill name (optional): '));
  const description = normalizeAnswer(await rl.question('Description (optional): '));
  const version = normalizeAnswer(await rl.question('Version [1.0.0]: '));
  const preset = normalizeAnswer(await rl.question(`Preset [general] (${PRESET_HELP}): `));
  const accountId = normalizeAnswer(await rl.question('Hedera account ID for setup (optional): '));
  const shouldPublish = normalizeYesNo(
    await rl.question('Publish immediately after scaffold if credentials are available? [y/N]: '),
    false,
  );

  const options = {};
  if (name) {
    options.name = name;
  }
  if (description) {
    options.description = description;
  }
  if (version) {
    options.version = version;
  }
  if (preset) {
    options.preset = preset;
  }
  if (accountId) {
    options['account-id'] = accountId;
    options['hedera-private-key'] = await askSecret(
      rl,
      'Hedera private key for automatic setup (input hidden): ',
    );
  }
  if (shouldPublish) {
    options.publish = true;
  }

  return {
    command: 'create',
    options,
    positionals: [directory],
  };
}

async function collectWhoamiOptions() {
  return {
    command: 'whoami',
    options: {},
    positionals: [],
  };
}

async function collectCreditsOptions() {
  return {
    command: 'credits',
    options: {},
    positionals: [],
  };
}

async function collectFundOptions(rl) {
  const hbarRaw = normalizeAnswer(await rl.question('HBAR amount (leave blank to target credits instead): '));
  const creditsRaw = hbarRaw
    ? ''
    : normalizeAnswer(await rl.question('Credits amount (optional): '));
  const hederaPrivateKey = await askSecret(
    rl,
    'Hedera private key for local signing (input hidden): ',
  );
  const options = {
    'hedera-private-key': hederaPrivateKey,
  };
  if (hbarRaw) {
    options.hbar = hbarRaw;
  }
  if (creditsRaw) {
    options.credits = creditsRaw;
  }
  return {
    command: 'fund',
    options,
    positionals: [],
  };
}

function printQuickstart(colors) {
  process.stdout.write('\nQuickstart\n');
  process.stdout.write(`1. ${colors.cyan('npx skill-publish setup --account-id 0.0.12345 --hedera-private-key <key> --hbar 5')}\n`);
  process.stdout.write(`2. ${colors.cyan('npx skill-publish create ./my-skill-repo --name my-skill --preset api')}\n`);
  process.stdout.write(`3. ${colors.cyan('npx skill-publish publish ./my-skill-repo/skills/my-skill')}\n`);
}

export async function runStartCommand(options, context) {
  const nonInteractive = Boolean(options['non-interactive']);
  const isInteractive = process.stdin.isTTY && process.stdout.isTTY;
  if (!isInteractive || nonInteractive || String(process.env.CI ?? '').trim().toLowerCase() === 'true') {
    context.printHelp();
    return null;
  }

  process.stdout.write(`${context.colors.bold('skill-publish')}\n`);
  process.stdout.write('Ship trustless, reproducible skill releases in minutes.\n');

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const choice = await askChoice(rl);
    if (choice === 'quickstart') {
      printQuickstart(context.colors);
      return null;
    }
    if (choice === 'setup') {
      return await collectSetupOptions(rl);
    }
    if (choice === 'whoami') {
      return await collectWhoamiOptions();
    }
    if (choice === 'credits') {
      return await collectCreditsOptions();
    }
    if (choice === 'fund') {
      return await collectFundOptions(rl);
    }
    if (choice === 'create') {
      return await collectCreateOptions(rl);
    }
    if (choice === 'setup-action') {
      return await collectSetupActionOptions(rl);
    }
    if (choice === 'scaffold-repo') {
      return await collectScaffoldRepoOptions(rl);
    }
    if (choice === 'init') {
      return await collectInitOptions(rl);
    }
    if (choice === 'validate') {
      return await collectValidateOptions(rl);
    }
    if (choice === 'badge') {
      return await collectBadgeOptions(rl);
    }
    if (choice === 'install-url') {
      return await collectInstallUrlOptions(rl);
    }
    if (choice === 'release-notes') {
      return await collectReleaseNotesOptions(rl);
    }
    if (choice === 'readme-snippet') {
      return await collectReadmeSnippetOptions(rl);
    }
    if (choice === 'attested-kit') {
      return await collectAttestedKitOptions(rl);
    }
    if (choice === 'apply-kit') {
      return await collectApplyKitOptions(rl);
    }
    if (choice === 'submit-indexnow') {
      return await collectSubmitIndexNowOptions(rl);
    }
    if (choice === 'publish') {
      return await collectPublishOptions(rl);
    }
    if (choice === 'doctor') {
      return await collectDoctorOptions(rl);
    }
    if (choice === 'help') {
      context.printHelp();
      return null;
    }
    return null;
  } finally {
    rl.close();
  }
}
