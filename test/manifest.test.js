// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACTIONS } from '../src/app.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { SCENE_TRIGGERS } from '../src/sync.js';
import { WIDGETS } from '../src/widgets.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { DEFAULT_MAX_EVENTS } from '../src/widgets.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...(manifest.account_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

// First Gladys release accepting the `calendar` type and the `account_schema`
// field: older cores reject them, and the store validator refuses a lower
// `gladys_version` minimum. It also covers the capability fields (5.1.0).
const CALENDAR_MIN_GLADYS_VERSION = [5, 2, 0];

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('the integration is a cloud calendar provider for Gladys >= 5.2.0', () => {
  assert.equal(manifest.type, 'calendar');
  assert.deepEqual(
    manifest.transports,
    ['cloud'],
    'Notion is only reachable through its cloud API',
  );
  assert.ok(isAtLeast(minGladysVersion(), CALENDAR_MIN_GLADYS_VERSION), manifest.gladys_version);
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
});

test('the Notion token is a per-user secret, never an admin setting', () => {
  const token = manifest.account_schema.find((field) => field.key === 'notion_token');
  assert.equal(token.type, 'secret');
  assert.equal(token.required, true);
  assert.ok(!manifest.config_schema.some((field) => field.type === 'secret'));
});

test('every manifest action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), Object.keys(ACTIONS).sort());
});

test('every scene_actions key has an onSceneAction handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
});

test('every scene trigger the code fires is declared, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(SCENE_TRIGGERS).sort());
});

test('every widgets key has an onWidgetGet handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets).sort(), Object.keys(WIDGETS).sort());
  const maxEvents = manifest.widgets
    .find((widget) => widget.key === 'upcoming_events')
    .settings.find((setting) => setting.key === 'max_events');
  assert.equal(maxEvents.default, DEFAULT_MAX_EVENTS);
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.type !== 'section') {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `DEFAULT_CONFIG.${field.key}`);
    }
  }
});

test('section fields are purely presentational', () => {
  for (const section of allFields.filter((field) => field.type === 'section')) {
    assert.equal(section.required, undefined, `section "${section.key}" must not be required`);
    assert.equal(section.default, undefined, `section "${section.key}" must not have a default`);
    assert.equal(section.placeholder, undefined, `section "${section.key}": placeholder`);
    assert.ok(!(section.key in DEFAULT_CONFIG), `section "${section.key}" stores no value`);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(
    manifest.docker_image.endsWith(`:${manifest.version}`),
    `docker_image must be tagged :${manifest.version}, got "${manifest.docker_image}"`,
  );
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});

test('every text is bilingual (English and French)', () => {
  const texts = [];
  const visit = (node) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (['label', 'description', 'placeholder'].includes(key)) {
          texts.push(value);
        }
        visit(value);
      }
    }
  };
  visit(manifest);
  for (const text of texts) {
    assert.equal(typeof text, 'object', `plain string: ${JSON.stringify(text)}`);
    assert.ok(
      text.en && text.fr && text.de && text.es,
      `missing a language: ${JSON.stringify(text)}`,
    );
  }
});
