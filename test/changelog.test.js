import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rollChangelog } from '../.github/scripts/changelog.mjs';

const REPO = 'https://github.com/quentinlegay/gladys-notion-calendar';

test('the Unreleased section moves under the released version', () => {
  const text = '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- A thing.\n\n[Unreleased]: x\n';
  assert.equal(
    rollChangelog(text, '0.2.0', '2026-10-12', REPO),
    '# Changelog\n\n## [Unreleased]\n\n## [0.2.0] - 2026-10-12\n\n### Added\n\n- A thing.\n\n' +
      `[Unreleased]: ${REPO}/compare/v0.2.0...HEAD\n[0.2.0]: ${REPO}/releases/tag/v0.2.0\n`,
  );
});

test('the next release compares with the previous tag, and a re-run is a no-op', () => {
  const first = rollChangelog('## [Unreleased]\n\n- A.\n', '0.2.0', '2026-10-12', REPO);
  const second = rollChangelog(
    first.replace('## [Unreleased]\n', '## [Unreleased]\n\n- B.\n'),
    '0.3.0',
    '2026-10-13',
    REPO,
  );
  assert.match(second, /\[0\.3\.0\]: .*compare\/v0\.2\.0\.\.\.v0\.3\.0/);
  assert.equal(rollChangelog(second, '0.3.0', '2026-10-14', REPO), second);
});

test('the real CHANGELOG.md has an Unreleased section', async () => {
  const text = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.match(text, /^## \[Unreleased\]$/m);
});
