#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createColors } from 'picocolors';
import {
  runCreditsCommand,
  runFundCommand,
  runWhoamiCommand,
} from './lib/account-commands.mjs';
import { runCreateCommand } from './lib/create-command.mjs';
import { loadCredential } from './lib/credential-store.mjs';
import { runDoctorCommand } from './lib/doctor-command.mjs';
import { runDistributionCommand } from './lib/distribution-commands.mjs';
import { runInitCommand, runSetupCommand } from './lib/local-commands.mjs';
import { runScaffoldRepoCommand, runSetupActionCommand } from './lib/repo-commands.mjs';
import { runStartCommand } from './lib/start-command.mjs';
import { COMMAND_ALIASES, HELP_BY_COMMAND, buildGlobalHelp } from './lib/cli-help.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packagePath = path.resolve(__dirname, '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
const MODE_FLAGS = new Set(['validate', 'quote', 'publish']);

const OPTION_ENV_MAP = new Map([
  ['api-base-url', 'INPUT_API_BASE_URL'],
  ['api-key', 'INPUT_API_KEY'],
  ['account-id', 'INPUT_ACCOUNT_ID'],
  ['skill-dir', 'INPUT_SKILL_DIR'],
  ['name', 'INPUT_NAME'],
  ['version', 'INPUT_VERSION'],
  ['stamp-repo-commit', 'INPUT_STAMP_REPO_COMMIT'],
  ['poll-timeout-ms', 'INPUT_POLL_TIMEOUT_MS'],
  ['poll-interval-ms', 'INPUT_POLL_INTERVAL_MS'],
  ['annotate', 'INPUT_ANNOTATE'],
  ['github-token', 'INPUT_GITHUB_TOKEN'],
  ['json', 'INPUT_JSON'],
  ['mode', 'INPUT_MODE'],
  ['credits', 'INPUT_CREDITS'],
]);

const BOOLEAN_OPTIONS = new Set([
  'annotate',
  'stamp-repo-commit',
  'json',
  'dry-run',
  'force',
  'yes',
  'save',
  'no-color',
  'non-interactive',
  'fix',
  'local-only',
  'publish',
  'with-validate',
]);

const VALUE_OPTIONS = new Set([
  'api-base-url',
  'api-key',
  'account-id',
  'skill-dir',
  'name',
  'version',
  'poll-timeout-ms',
  'poll-interval-ms',
  'github-token',
  'description',
  'network',
  'hedera-private-key',
  'signature',
  'signature-kind',
  'public-key',
  'expires-in-minutes',
  'hbar',
  'memo',
  'credits',
  'store-path',
  'trigger',
  'workflow-path',
  'validate-workflow-path',
  'repo-dir',
  'readme-path',
  'docs-path',
  'codemeta-path',
  'mode',
  'label',
  'style',
  'metric',
  'format',
  'preset',
  'wait-timeout-ms',
  'wait-interval-ms',
]);

let palette = createColors(true);

function colors() {
  return {
    bold: palette.bold,
    cyan: palette.cyan,
    green: palette.green,
    yellow: palette.yellow,
    red: palette.red,
  };
}

function fail(message, command = '') {
  process.stderr.write(`${palette.red('Error:')} ${message}\n`);
  if (command && HELP_BY_COMMAND[command]) {
    process.stderr.write(`Run ${palette.cyan(`npx skill-publish help ${command}`)} for usage.\n`);
  } else {
    process.stderr.write(`Run ${palette.cyan('npx skill-publish --help')} for usage.\n`);
  }
  process.exit(1);
}

function printHelp(command = '') {
  if (command && HELP_BY_COMMAND[command]) {
    process.stdout.write(`${HELP_BY_COMMAND[command]}\n`);
    return;
  }
  process.stdout.write(`${buildGlobalHelp(packageJson.version)}\n`);
}

function isGlobalOnlyArgs(rawArgs) {
  if (rawArgs.length === 0) {
    return true;
  }
  return rawArgs.every((arg) => arg === '--non-interactive' || arg === '--no-color');
}

function parseArgs(argv) {
  const raw = [...argv];
  if (raw.length === 1 && (raw[0] === '--version' || raw[0] === '-v')) {
    process.stdout.write(`${String(packageJson.version)}\n`);
    process.exit(0);
  }
  if (raw.length === 0) {
    return { command: 'start', args: [] };
  }
  if (raw[0] === '--help' || raw[0] === '-h') {
    return { command: 'help', args: [] };
  }
  if (raw[0] === 'help') {
    return { command: 'help', args: raw.slice(1) };
  }
  if (raw[0] === 'version') {
    process.stdout.write(`${String(packageJson.version)}\n`);
    process.exit(0);
  }
  if (raw[0].startsWith('-')) {
    if (isGlobalOnlyArgs(raw)) {
      return { command: 'start', args: raw };
    }
    return { command: 'publish', args: raw };
  }
  const normalized = COMMAND_ALIASES.get(raw[0]);
  if (normalized) {
    return { command: normalized, args: raw.slice(1) };
  }
  return { command: 'publish', args: raw };
}

function parseOptions(args, command) {
  const options = {};
  const positionals = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--help' || token === '-h') {
      printHelp(command);
      process.exit(0);
    }
    if (token === '--version' && (index === args.length - 1 || args[index + 1].startsWith('-'))) {
      process.stdout.write(`${String(packageJson.version)}\n`);
      process.exit(0);
    }
    if (token.startsWith('--no-')) {
      const key = token.slice(5);
      if (!BOOLEAN_OPTIONS.has(key)) {
        fail(`Unknown flag: ${token}`, command);
      }
      options[key] = false;
      continue;
    }
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    let key;
    let value;
    if (token.includes('=')) {
      const separator = token.indexOf('=');
      key = token.slice(2, separator);
      value = token.slice(separator + 1);
    } else {
      key = token.slice(2);
      value = null;
    }

    if (!VALUE_OPTIONS.has(key) && !BOOLEAN_OPTIONS.has(key)) {
      fail(`Unknown flag: --${key}`, command);
    }

    if (value !== null) {
      options[key] = value;
      continue;
    }

    const next = args[index + 1];
    if (next && !next.startsWith('--') && VALUE_OPTIONS.has(key)) {
      options[key] = next;
      index += 1;
      continue;
    }

    if (BOOLEAN_OPTIONS.has(key)) {
      options[key] = true;
      continue;
    }

    fail(`Missing value for --${key}`, command);
  }

  return { options, positionals };
}

function applyBrokerDefaults(options) {
  if (!options['api-base-url']) {
    options['api-base-url'] = 'https://hol.org/registry/api/v1';
  }
  if (!options['api-key'] && process.env.RB_API_KEY) {
    options['api-key'] = process.env.RB_API_KEY;
    return;
  }
  if (!options['api-key']) {
    const stored = loadCredential({
      baseUrl: options['api-base-url'],
      accountId: options['account-id'] ?? '',
      storePath: options['store-path'] ?? '',
    });
    if (stored?.apiKey) {
      options['api-key'] = stored.apiKey;
      options['account-id'] = options['account-id'] || stored.accountId;
      options.network = options.network || stored.network;
    }
  }
}

function applyCommonDefaults(options) {
  applyBrokerDefaults(options);
  if (!options['skill-dir']) {
    options['skill-dir'] = '.';
  }
}

function applyPublishDefaults(options) {
  applyCommonDefaults(options);
  if (typeof options.annotate === 'undefined') {
    options.annotate = false;
  }
  if (typeof options['stamp-repo-commit'] === 'undefined') {
    options['stamp-repo-commit'] = true;
  }
  if (!options['poll-timeout-ms']) {
    options['poll-timeout-ms'] = '720000';
  }
  if (!options['poll-interval-ms']) {
    options['poll-interval-ms'] = '4000';
  }
}

function setEnvFromOptions(options) {
  for (const [key, value] of Object.entries(options)) {
    if (typeof value === 'undefined') {
      continue;
    }
    const envKey = OPTION_ENV_MAP.get(key);
    if (!envKey) {
      continue;
    }
    process.env[envKey] = String(value);
  }
}

async function runEntrypoint(mode, options) {
  const payload = { ...options, mode };
  setEnvFromOptions(payload);
  const entrypointUrl = pathToFileURL(path.resolve(__dirname, '..', 'entrypoint.mjs')).href;
  await import(entrypointUrl);
}

function adoptPositionalSkillDir(options, positionals) {
  if (positionals.length > 0 && !options['skill-dir']) {
    options['skill-dir'] = positionals[0];
  }
}

async function runPublishCommand(options, positionals) {
  adoptPositionalSkillDir(options, positionals);
  applyPublishDefaults(options);
  const shouldPrintInformational = !Boolean(options.json);

  if (options['dry-run']) {
    if (options['api-key']) {
      if (shouldPrintInformational) {
        process.stdout.write(`${palette.yellow('Dry run')}: running quote instead of publish.\n`);
      }
      await runEntrypoint('quote', options);
      return;
    }
    if (shouldPrintInformational) {
      process.stdout.write(
        `${palette.yellow('Dry run')}: running local validation only (no API key provided).\n`,
      );
    }
    await runEntrypoint('validate', options);
    return;
  }

  if (!options['api-key']) {
    fail(
      'Missing API key. Pass --api-key, set RB_API_KEY, or run `npx skill-publish setup --account-id <id> --hedera-private-key <key>`. Publish also requires funded broker credits because the release is inscribed on-chain.',
      'publish',
    );
  }
  await runEntrypoint('publish', options);
}

async function runValidateCommand(options, positionals) {
  adoptPositionalSkillDir(options, positionals);
  applyCommonDefaults(options);
  await runEntrypoint('validate', options);
}

async function runQuoteCommand(options, positionals) {
  adoptPositionalSkillDir(options, positionals);
  applyCommonDefaults(options);
  if (!options['api-key']) {
    fail(
      'Missing API key. Pass --api-key, set RB_API_KEY, or run `npx skill-publish setup --account-id <id> --hedera-private-key <key>` before requesting an authenticated publish quote.',
      'quote',
    );
  }
  await runEntrypoint('quote', options);
}

async function dispatchCommand(command, options, positionals) {
  if (command === 'publish') {
    await runPublishCommand(options, positionals);
    return;
  }
  if (command === 'validate') {
    await runValidateCommand(options, positionals);
    return;
  }
  if (command === 'quote') {
    await runQuoteCommand(options, positionals);
    return;
  }
  if (command === 'init') {
    await runInitCommand(options, positionals, {
      fail,
      colors: colors(),
    });
    return;
  }
  if (command === 'create') {
    applyBrokerDefaults(options);
    await runCreateCommand(options, positionals, {
      fail,
      colors: colors(),
      runEntrypoint,
    });
    return;
  }
  if (command === 'setup') {
    await runSetupCommand(options, {
      colors: colors(),
    });
    return;
  }
  if (command === 'whoami') {
    applyCommonDefaults(options);
    await runWhoamiCommand(options, positionals, {
      colors: colors(),
    });
    return;
  }
  if (command === 'credits') {
    applyCommonDefaults(options);
    await runCreditsCommand(options, positionals, {
      colors: colors(),
    });
    return;
  }
  if (command === 'fund') {
    applyCommonDefaults(options);
    await runFundCommand(options, positionals, {
      colors: colors(),
    });
    return;
  }
  if (command === 'setup-action') {
    await runSetupActionCommand(options, positionals, {
      fail,
      colors: colors(),
    });
    return;
  }
  if (command === 'scaffold-repo') {
    await runScaffoldRepoCommand(options, positionals, {
      fail,
      colors: colors(),
    });
    return;
  }
  if (command === 'doctor') {
    adoptPositionalSkillDir(options, positionals);
    applyCommonDefaults(options);
    await runDoctorCommand(options, positionals, {
      colors: colors(),
    });
    return;
  }
  if (
    command === 'badge' ||
    command === 'install-url' ||
    command === 'release-notes' ||
    command === 'readme-snippet' ||
    command === 'attested-kit' ||
    command === 'apply-kit' ||
    command === 'submit-indexnow'
  ) {
    applyCommonDefaults(options);
    await runDistributionCommand(command, options, positionals, {
      fail,
      colors: colors(),
    });
    return;
  }
  if (command === 'start') {
    const nextAction = await runStartCommand(options, {
      printHelp,
      colors: colors(),
    });
    if (!nextAction) {
      return;
    }
    await dispatchCommand(nextAction.command, nextAction.options ?? {}, nextAction.positionals ?? []);
    return;
  }

  fail(`Unknown command: ${command}`);
}

async function run() {
  const parsed = parseArgs(process.argv.slice(2));
  const { command, args } = parsed;
  if (command === 'help') {
    const topic = COMMAND_ALIASES.get(args[0] ?? '') ?? (args[0] || '');
    printHelp(topic);
    return;
  }

  const parsedOptions = parseOptions(args, command);
  const options = parsedOptions.options;
  const positionals = parsedOptions.positionals;

  if (options['no-color']) {
    palette = createColors(false);
  }

  const modeOverride = String(options.mode ?? '').trim().toLowerCase();
  if (command === 'publish' && modeOverride) {
    if (!MODE_FLAGS.has(modeOverride)) {
      fail(`Unsupported mode: ${modeOverride}`, 'publish');
    }
    await dispatchCommand(modeOverride, options, positionals);
    return;
  }

  await dispatchCommand(command, options, positionals);
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${palette.red('Error:')} ${message}\n`);
  process.exit(1);
});
