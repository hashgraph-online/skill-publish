export const COMMAND_ALIASES = new Map([
  ['publish', 'publish'],
  ['pub', 'publish'],
  ['p', 'publish'],
  ['validate', 'validate'],
  ['check', 'validate'],
  ['v', 'validate'],
  ['quote', 'quote'],
  ['q', 'quote'],
  ['create', 'create'],
  ['new', 'create'],
  ['init', 'init'],
  ['i', 'init'],
  ['setup', 'setup'],
  ['login', 'setup'],
  ['auth', 'setup'],
  ['s', 'setup'],
  ['whoami', 'whoami'],
  ['me', 'whoami'],
  ['credits', 'credits'],
  ['balance', 'credits'],
  ['fund', 'fund'],
  ['setup-action', 'setup-action'],
  ['action', 'setup-action'],
  ['workflow', 'setup-action'],
  ['gha', 'setup-action'],
  ['scaffold-repo', 'scaffold-repo'],
  ['scaffold', 'scaffold-repo'],
  ['bootstrap', 'scaffold-repo'],
  ['doctor', 'doctor'],
  ['diag', 'doctor'],
  ['d', 'doctor'],
  ['badge', 'badge'],
  ['install-url', 'install-url'],
  ['release-notes', 'release-notes'],
  ['readme-snippet', 'readme-snippet'],
  ['attested-kit', 'attested-kit'],
  ['kit', 'attested-kit'],
  ['apply-kit', 'apply-kit'],
  ['submit-indexnow', 'submit-indexnow'],
  ['start', 'start'],
  ['wizard', 'start'],
  ['help', 'help'],
]);

export function buildGlobalHelp(version) {
  return `skill-publish ${String(version)}

Usage:
  npx skill-publish [command] [options]
  npx skill-publish [legacy publish flags]

Getting Started:
  start               Interactive quick start (default in TTY)
  setup               Create API key via ledger auth and optionally fund credits
  whoami              Show the active broker account + credential context
  credits             Show current credit balance and funding links
  fund                Securely fund credits by signing an HBAR transfer locally
  create [dir]        Create a full skill repo, run doctor --fix, and optionally quote/publish
  doctor [dir]        Run readiness checks for environment + skill package
  setup-action [dir]  Add a GitHub publish workflow to an existing skill repo
  scaffold-repo [dir] Scaffold a new skill repo with package + workflow
  badge [dir]            Generate canonical badge snippets and URLs
  install-url [dir]      Generate pinned/latest install URLs
  release-notes [dir]    Generate release-ready markdown for a published version
  readme-snippet [dir]   Generate README markdown snippet for a version
  attested-kit [dir]     Generate the full attested distribution kit
  apply-kit [dir]        Write README/docs/codemeta proof blocks locally
  submit-indexnow [dir]  Submit canonical skill URLs to IndexNow

Core Commands:
  init [dir]          Scaffold SKILL.md + skill.json
  validate [dir]      Validate a skill package locally
  quote [dir]         Validate package and fetch an authenticated publish quote
  publish [dir]       Validate, quote, and publish a credit-funded skill release
  help [command]      Show help for a command

Examples:
  npx skill-publish
  npx skill-publish start
  npx skill-publish setup --account-id 0.0.12345 --hedera-private-key <key> --hbar 5
  npx skill-publish whoami
  npx skill-publish credits
  npx skill-publish fund --hbar 5 --hedera-private-key <key>
  npx skill-publish create ./weather-skill --name weather-skill --preset api
  npx skill-publish setup-action . --skill-dir skills/my-skill
  npx skill-publish scaffold-repo ./weather-skill --name weather-skill --preset api
  npx skill-publish badge ./skills/weather-skill
  npx skill-publish install-url ./skills/weather-skill --format json
  npx skill-publish release-notes ./skills/weather-skill
  npx skill-publish readme-snippet ./skills/weather-skill
  npx skill-publish attested-kit ./skills/weather-skill --format json
  npx skill-publish apply-kit ./skills/weather-skill --repo-dir .
  npx skill-publish submit-indexnow ./skills/weather-skill
  npx skill-publish doctor ./skills/weather-skill
  npx skill-publish doctor ./skills/weather-skill --fix --local-only
  npx skill-publish init ./skills/weather-skill
  npx skill-publish validate ./skills/weather-skill
  npx skill-publish quote --skill-dir ./skills/weather-skill
  npx skill-publish publish --skill-dir ./skills/weather-skill
  npx skill-publish --mode validate --skill-dir ./skills/weather-skill

Legacy usage still works:
  RB_API_KEY=rbk_xxx npx skill-publish --skill-dir ./skills/weather-skill

Global flags:
  -h, --help            Show help
  -v, --version         Show CLI version
  --mode <mode>         Run validate, quote, or publish through the top-level command
  --no-color            Disable ANSI colors
  --non-interactive     Disable interactive prompts
`;
}

export const HELP_BY_COMMAND = {
  start: `skill-publish start

Runs an interactive quick-start flow for setup, scaffolding, validation, and publishing.

Options:
  --non-interactive     Print help instead of prompts
  --no-color            Disable ANSI colors
`,
  publish: `skill-publish publish [dir]

Publishes a skill package to the Registry Broker. Hidden files, env files, lockfiles, build output, and key material are excluded automatically.

Options:
  --api-key <key>              API key (or RB_API_KEY env var)
  --api-base-url <url>         API base URL (default: https://hol.org/registry/api/v1)
  --skill-dir <dir>            Skill directory; [dir] positional also supported
  --account-id <id>            Optional Hedera account ID
  --name <name>                Override name from skill.json
  --version <version>          Override version from skill.json
  --annotate <bool>            Enable annotations (default: false in CLI)
  --no-annotate                Disable annotations
  --stamp-repo-commit <bool>   Stamp repo/commit metadata (default: true)
  --no-stamp-repo-commit       Disable repo/commit stamping
  --poll-timeout-ms <ms>       Publish poll timeout (default: 720000)
  --poll-interval-ms <ms>      Publish poll interval (default: 4000)
  --dry-run                    Run validation only if no key, otherwise run quote
  --json                       Print machine-readable summary
`,
  validate: `skill-publish validate [dir]

Validates package files and skill metadata without publishing. The file summary reflects the same exclusion rules used by quote and publish.

Options:
  --skill-dir <dir>            Skill directory; [dir] positional also supported
  --name <name>                Override name from skill.json
  --version <version>          Override version from skill.json
  --json                       Print machine-readable summary
`,
  quote: `skill-publish quote [dir]

Validates package and requests a publish quote without creating a publish job. Uses the same safe file exclusion rules as publish.

Options:
  --api-key <key>              API key (or RB_API_KEY env var)
  --api-base-url <url>         API base URL (default: https://hol.org/registry/api/v1)
  --skill-dir <dir>            Skill directory; [dir] positional also supported
  --account-id <id>            Optional Hedera account ID
  --name <name>                Override name from skill.json
  --version <version>          Override version from skill.json
  --json                       Print machine-readable summary
`,
  init: `skill-publish init [dir]

Scaffolds a new skill package with SKILL.md + skill.json.

Options:
  --name <name>                Skill name (defaults to folder name)
  --description <text>         Skill description
  --version <version>          Version (default: 1.0.0)
  --preset <name>              general|api|docs|mcp|assistant|monorepo
  --force                      Overwrite existing files
  --yes                        Alias for --force
`,
  create: `skill-publish create [repoDir]

Scaffolds a full skill repository, runs doctor --fix on the generated package, and can optionally quote or publish immediately.

Options:
  --name <name>                Skill name (defaults to repo folder name)
  --description <text>         Skill description
  --version <version>          Version (default: 1.0.0)
  --preset <name>              general|api|docs|mcp|assistant|monorepo
  --skill-dir <dir>            Skill package directory inside the repo (default: skills/<name>)
  --workflow-path <path>       Workflow output path (default: .github/workflows/publish-skill.yml)
  --trigger <mode>             Workflow trigger: release | manual (default: release)
  --annotate <bool>            Enable action annotations in the generated workflow (default: true)
  --account-id <id>            Optional Hedera account ID for automatic setup
  --hedera-private-key <key>   Optional Hedera private key for automatic setup
  --network <value>            Ledger network (default: hedera:testnet)
  --hbar <amount>              Optional HBAR top-up during automatic setup
  --api-key <key>              Existing API key to reuse instead of running setup
  --local-only                 Run doctor in local-only mode during scaffolding
  --publish                    Publish immediately after scaffolding and doctor
  --force                      Overwrite existing target repo contents
  --json                       Print machine-readable summary
`,
  setup: `skill-publish setup

Creates an API key using ledger challenge/verify and can top up credits in one step.

Options:
  --api-base-url <url>         API base URL (default: https://hol.org/registry/api/v1)
  --account-id <id>            Hedera account ID for key ownership
  --network <value>            Ledger network (default: hedera:testnet)
  --hedera-private-key <key>   Hedera private key used to sign challenge
  --signature <value>          Manual signature payload (advanced mode)
  --signature-kind <kind>      Signature kind: raw, map, evm (default: raw)
  --public-key <value>         Optional public key when using manual signature
  --expires-in-minutes <n>     API key TTL in minutes (1-60, default: 60)
  --hbar <amount>              Optional HBAR amount to purchase credits immediately
  --memo <text>                Optional purchase memo for top-up
  --credits <amount>           Future funding target in credits (use fund command)
  --store-path <path>          Optional path for local credential store
  --no-save                    Do not persist API key to local credential store
  --json                       Print machine-readable summary
`,
  whoami: `skill-publish whoami

Shows which broker/account/API key the CLI will use, plus the current credit balance.

Options:
  --api-key <key>              API key (or RB_API_KEY env var / local credential store)
  --api-base-url <url>         API base URL (default: https://hol.org/registry/api/v1)
  --account-id <id>            Account ID override for stored credentials
  --store-path <path>          Optional path for local credential store
  --json                       Print machine-readable summary
`,
  credits: `skill-publish credits

Shows the active credit balance and funding links for the current broker account.

Options:
  --api-key <key>              API key (or RB_API_KEY env var / local credential store)
  --api-base-url <url>         API base URL (default: https://hol.org/registry/api/v1)
  --account-id <id>            Account ID override for stored credentials
  --store-path <path>          Optional path for local credential store
  --json                       Print machine-readable summary
`,
  fund: `skill-publish fund

Creates a secure HBAR funding intent, signs the transfer locally, submits it to Hedera, and waits for credits to reconcile.

Options:
  --api-key <key>              API key (or RB_API_KEY env var / local credential store)
  --api-base-url <url>         API base URL (default: https://hol.org/registry/api/v1)
  --account-id <id>            Account ID override for stored credentials
  --hedera-private-key <key>   Hedera private key used only for local signing
  --hbar <amount>              HBAR amount to transfer
  --credits <amount>           Desired credit amount (broker converts to HBAR)
  --memo <text>                Optional purchase memo override
  --wait-timeout-ms <ms>       Max wait for balance reconciliation (default: 90000)
  --wait-interval-ms <ms>      Poll interval while waiting for balance (default: 4000)
  --store-path <path>          Optional path for local credential store
  --json                       Print machine-readable summary
`,
  'setup-action': `skill-publish setup-action [repoDir]

Adds a skill-publish GitHub Actions workflow to an existing skill repository.

Options:
  --repo-dir <dir>             Repository directory (or pass [repoDir] positional)
  --skill-dir <dir>            Skill package directory (auto-detected if omitted)
  --workflow-path <path>       Workflow output path (default: .github/workflows/publish-skill.yml)
  --validate-workflow-path <path>
                               Validate workflow output path (default: .github/workflows/validate-skill.yml)
  --trigger <mode>             Workflow trigger: release | manual (default: release)
  --with-validate <bool>       Also add a pull-request validate-only workflow (default: true)
  --annotate <bool>            Enable release/PR annotations (default: true)
  --force                      Overwrite existing workflow file
`,
  'scaffold-repo': `skill-publish scaffold-repo [repoDir]

Scaffolds a new skill repository with package files and publish workflow.

Options:
  --repo-dir <dir>             Repository directory (or pass [repoDir] positional)
  --name <name>                Skill name (defaults to folder name)
  --description <text>         Skill description
  --version <version>          Skill version (default: 1.0.0)
  --preset <name>              general|api|docs|mcp|assistant|monorepo
  --skill-dir <dir>            Skill package directory (default: skills/<name>)
  --workflow-path <path>       Workflow output path (default: .github/workflows/publish-skill.yml)
  --validate-workflow-path <path>
                               Validate workflow output path (default: .github/workflows/validate-skill.yml)
  --trigger <mode>             Workflow trigger: release | manual (default: release)
  --with-validate <bool>       Also add a pull-request validate-only workflow (default: true)
  --annotate <bool>            Enable release/PR annotations (default: true)
  --force                      Allow scaffolding into a non-empty directory
`,
  doctor: `skill-publish doctor [dir]

Runs local readiness checks for environment, broker reachability, credentials, and skill package files.

Options:
  --api-base-url <url>         API base URL (default: https://hol.org/registry/api/v1)
  --api-key <key>              API key (or RB_API_KEY env var / local credential store)
  --account-id <id>            Hedera account ID for balance checks
  --skill-dir <dir>            Skill directory; [dir] positional also supported
  --fix                        Repair missing SKILL.md, invalid skill.json, and missing required metadata
  --local-only                 Skip broker/auth/credits checks and only verify local package readiness
  --store-path <path>          Optional path for local credential store
  --json                       Print machine-readable summary
`,
  badge: `skill-publish badge [dir]

Generates canonical badge snippets and URLs for a skill version.

Options:
  --skill-dir <dir>            Skill directory; [dir] positional also supported
  --name <name>                Override skill name (from skill.json when omitted)
  --version <version>          Override version (from skill.json when omitted)
  --api-base-url <url>         API base URL (default: https://hol.org/registry/api/v1)
  --label <text>               Badge label override (default: skill name)
  --metric <metric>            Badge metric (default: version)
  --style <style>              Badge style (default: for-the-badge)
  --format <type>              markdown|html|image|api|json (default: markdown)
  --json                       Print machine-readable summary
`,
  'install-url': `skill-publish install-url [dir]

Generates canonical pinned/latest install and resolver URLs for a skill version.

Options:
  --skill-dir <dir>            Skill directory; [dir] positional also supported
  --name <name>                Override skill name (from skill.json when omitted)
  --version <version>          Override version (from skill.json when omitted)
  --api-base-url <url>         API base URL (default: https://hol.org/registry/api/v1)
  --format <type>              summary|pinned-skill-md|latest-skill-md|pinned-manifest|latest-manifest|pinned-install-metadata|latest-install-metadata|json
  --json                       Print machine-readable summary
`,
  'release-notes': `skill-publish release-notes [dir]

Generates release-ready markdown with canonical install links.

Options:
  --skill-dir <dir>            Skill directory; [dir] positional also supported
  --name <name>                Override skill name (from skill.json when omitted)
  --version <version>          Override version (from skill.json when omitted)
  --api-base-url <url>         API base URL (default: https://hol.org/registry/api/v1)
  --label <text>               Badge label override (default: skill name)
  --metric <metric>            Badge metric (default: version)
  --style <style>              Badge style (default: for-the-badge)
  --json                       Print machine-readable summary
`,
  'readme-snippet': `skill-publish readme-snippet [dir]

Generates README markdown that includes badge + pinned install references.

Options:
  --skill-dir <dir>            Skill directory; [dir] positional also supported
  --name <name>                Override skill name (from skill.json when omitted)
  --version <version>          Override version (from skill.json when omitted)
  --api-base-url <url>         API base URL (default: https://hol.org/registry/api/v1)
  --label <text>               Badge label override (default: skill name)
  --metric <metric>            Badge metric (default: version)
  --style <style>              Badge style (default: for-the-badge)
  --json                       Print machine-readable summary
`,
  'attested-kit': `skill-publish attested-kit [dir]

Generates the full attested distribution kit for a skill version.

Options:
  --skill-dir <dir>            Skill directory; [dir] positional also supported
  --name <name>                Override skill name (from skill.json when omitted)
  --version <version>          Override version (from skill.json when omitted)
  --api-base-url <url>         API base URL (default: https://hol.org/registry/api/v1)
  --label <text>               Badge label override (default: skill name)
  --metric <metric>            Badge metric (default: version)
  --style <style>              Badge style (default: for-the-badge)
  --format <type>              json|summary|docs|citation|codemeta|package
  --json                       Print machine-readable summary
`,
  'apply-kit': `skill-publish apply-kit [dir]

Writes attested distribution blocks into local publisher-owned surfaces.

Options:
  --skill-dir <dir>            Skill directory; [dir] positional also supported
  --repo-dir <dir>             Repository root (default: .)
  --readme-path <path>         README path relative to repo root (default: README.md)
  --docs-path <path>           Optional docs path relative to repo root
  --codemeta-path <path>       codemeta output path relative to repo root (default: codemeta.json)
  --api-base-url <url>         API base URL (default: https://hol.org/registry/api/v1)
`,
  'submit-indexnow': `skill-publish submit-indexnow [dir]

Submits canonical skill URLs from the attested distribution kit to IndexNow.

Options:
  --skill-dir <dir>            Skill directory; [dir] positional also supported
  --api-base-url <url>         API base URL (default: https://hol.org/registry/api/v1)
`,
};
