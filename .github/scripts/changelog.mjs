// -----------------------------------------------------------------------------
// Changelog helper, run by the Release workflow.
//
//   node .github/scripts/changelog.mjs <version> <repo-url>
//     Moves the `## [Unreleased]` section of CHANGELOG.md under
//     `## [<version>] - <today>` and points the comparison links at the tag.
//
// The file is edited in place, so the release commit keeps the Prettier
// layout. test/changelog.test.js checks it. Adapted from the release helpers
// of the official integration template.
// -----------------------------------------------------------------------------

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const CHANGELOG_FILE = 'CHANGELOG.md';
const UNRELEASED_HEADING = '## [Unreleased]';

function versionHeading(version) {
  return new RegExp(`^## \\[?${version.replaceAll('.', '\\.')}\\]?(?: |$).*$`, 'm');
}

// Index where a section starting at `from` ends: the next `## ` heading, else
// the link reference definitions closing the file, else its end.
function sectionEnd(text, from) {
  const rest = text.slice(from);
  const nextHeading = rest.search(/^## /m);
  if (nextHeading !== -1) {
    return from + nextHeading;
  }
  const links = rest.search(/^\[[^\]]+\]: /m);
  return links === -1 ? text.length : from + links;
}

/**
 * Move the Unreleased section of a Keep a Changelog document under the
 * released version, and point the comparison links at the new tag.
 * @param {string} text - Current CHANGELOG.md content.
 * @param {string} version - Released version, e.g. 1.2.0.
 * @param {string} date - Release date, YYYY-MM-DD.
 * @param {string} repoUrl - Repository URL, e.g. https://github.com/me/repo.
 * @returns {string} The new content (unchanged without an Unreleased section).
 */
export function rollChangelog(text, version, date, repoUrl) {
  const heading = /^## \[Unreleased\][ \t]*$/m.exec(text);
  if (!heading || versionHeading(version).test(text)) {
    return text;
  }
  const start = heading.index;
  const bodyStart = start + heading[0].length;
  const bodyEnd = sectionEnd(text, bodyStart);
  const body = text.slice(bodyStart, bodyEnd).trim();
  const rest = text.slice(bodyEnd).trimStart();

  const released = `## [${version}] - ${date}\n\n${body ? `${body}\n\n` : ''}`;
  let result = `${text.slice(0, start)}${UNRELEASED_HEADING}\n\n${released}${rest}`;

  const previous = /^## \[(\d+\.\d+\.\d+)\]/m.exec(rest)?.[1];
  const links =
    `[Unreleased]: ${repoUrl}/compare/v${version}...HEAD\n` +
    (previous
      ? `[${version}]: ${repoUrl}/compare/v${previous}...v${version}`
      : `[${version}]: ${repoUrl}/releases/tag/v${version}`);
  const unreleasedLink = /^\[Unreleased\]: .*$/m;
  result = unreleasedLink.test(result)
    ? result.replace(unreleasedLink, () => links)
    : `${result.trimEnd()}\n\n${links}`;
  return `${result.trimEnd()}\n`;
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  const [version, repoUrl] = process.argv.slice(2);
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '') || !repoUrl) {
    console.error('Usage: changelog.mjs <x.y.z> <repo-url>');
    process.exit(1);
  }
  if (existsSync(CHANGELOG_FILE)) {
    const changelog = readFileSync(CHANGELOG_FILE, 'utf8');
    const date = new Date().toISOString().slice(0, 10);
    const rolled = rollChangelog(changelog, version, date, repoUrl);
    if (rolled === changelog) {
      console.log(
        `::warning::${CHANGELOG_FILE} left as is: no "${UNRELEASED_HEADING}" section, or ${version} is already listed`,
      );
    }
    writeFileSync(CHANGELOG_FILE, rolled);
  }
}
