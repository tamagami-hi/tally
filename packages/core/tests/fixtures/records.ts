export const CHECKS = `# Code checks

**The code as last verified.** While the fingerprint matches, re-run nothing.

## The fingerprint

| | |
| --- | --- |
| **Code fingerprint** | \`58b59d3\` (\`58b59d32dc5749cccb8febb27b0c96a6f75115cb\`), the last code commit on \`main\`. |
| **Verified by** | One sweep at a03496a. |
| **Recorded** | 2026-11-03, B4 DATA part only. |
| **Stale when** | the command below prints anything other than \`58b59d3\`. |

\`\`\`bash
git log -1 --format=%h -- crates ':(exclude)*.md'
\`\`\`

## The checks

| Check | Result |
| --- | --- |
| Formatting | pass |
| \`cargo test --locked\` | **1073 passed**, 0 failed, 0 ignored |

All exact commands are in [verification.json](x.json).

## The test suites

| Suite | Where | Tests |
| --- | --- | --- |
| \`acme-core\` unit | \`tests/unit/core/\` | 699 |
| Dashboard (Vitest) | \`ui/tests/\` | 76 in 21 files |

## The modules

Lengths are the measured source-file lines.

### \`acme-core::archive\`: reading the recorder's files (A1)

| File | Lines | Covered | Tests |
| --- | --- | --- | --- |
| \`archive/chain/axes.rs\` | 113 | 100.00% (77/77; 0 missed) | \`core/archive/chain/axes.rs\` 5 |
| \`archive/mod.rs\` | 14 | no executable lines | through module/integration tests |
| \`archive/key.rs\` | 336 | 100.00% (212/212; 0 missed) | \`core/registry/key.rs\` 10, \`core/registry/golden.rs\` 4 |

- **Does:** framing and streaming zstd; a cell \`a | b\` inside code.
- **Entry point:** \`acme_core::archive::open\`.
- **Weakest files:**
  - \`writer.rs\`: 8 of its 18 functions are never run.
- **Open:** the persisted store is still B2.

### \`ui/\`: the dashboard (A7)

| File | Lines | Lines covered |
| --- | --- | --- |
| \`api/client.ts\` | 58 | 100.00% (23/23; 0 missed) |

The helpers live in \`tests/\`.

- **Does** (A7): sign-in.
`;

export const LOG = `# The market data library: build log

**What was built, verified, decided and corrected**, newest last.

## A1. The archive reader, index chains, 2026-10-30

**Built:** \`acme-core::archive\` reads the index chain files.

- **Verified:** 101 tests pass.
- **Decided:** the one timestamp rule.

## A1a. The review's corrections, 2026-10-30

Two fixes, \`abc1234\` and \`def5678\`.

## B4 (data's part). The view, clock and derived bars, 2026-11-03

**DATA's milestone part is built.**
`;
