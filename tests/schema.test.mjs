// Updating OpenVorld must never damage a user's data: old vorlds are migrated with a backup, newer ones are left alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { home, makeVorld } from './helpers/vorld.mjs';
import { DATA_SCHEMA, migrateDoc, schemaOf, isNewer } from '../engine/server/schema.mjs';
const { migrateVorlds, listVorlds, vorldCtx } = await import('../engine/server/vorld.mjs');

const put = (id, doc) => { const dir = path.join(home, 'vorlds', id); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'vorld.yaml'), typeof doc === 'string' ? doc : YAML.stringify(doc)); return dir; };

test('schema helpers: a vorld without a stamp is format 1, a higher number is newer', () => {
  assert.equal(schemaOf({}), 1); assert.equal(schemaOf({ schema: 2 }), 2); assert.equal(schemaOf({ schema: 'x' }), 1);
  assert.equal(isNewer({ schema: DATA_SCHEMA + 1 }), true); assert.equal(isNewer({ schema: DATA_SCHEMA }), false);
  const doc = { name: 'x', keep: { me: true } };
  const steps = migrateDoc(doc);
  assert.ok(steps.length >= 1 && doc.schema === DATA_SCHEMA && doc.keep.me === true, 'fields the migration does not know stay');
  assert.deepEqual(migrateDoc(doc), [], 'migrating again does nothing');
});

test('a new vorld is stamped with the current data format', () => {
  const ctx = makeVorld();
  assert.equal(ctx.doc.schema, DATA_SCHEMA);
});

test('an older vorld is migrated at start-up, with a backup of what it was', () => {
  const original = '# my own comment\nname: Old Tea\nabout: from before 0.3.0\nfavourite_field: kept\ncrew:\n  - id: buzz\n    role: companion\n    name: Buzz\n';
  const dir = put('old-tea', original);
  const result = migrateVorlds().find((r) => r.id === 'old-tea');
  assert.equal(result.status, 'migrated'); assert.equal(result.from, 1); assert.equal(result.to, DATA_SCHEMA);
  assert.equal(fs.readFileSync(result.backup, 'utf8'), original, 'the backup is the file exactly as it was');
  assert.ok(result.backup.startsWith(path.join(dir, 'backups')));
  const now = YAML.parse(fs.readFileSync(path.join(dir, 'vorld.yaml'), 'utf8'));
  assert.equal(now.schema, DATA_SCHEMA); assert.equal(now.favourite_field, 'kept'); assert.equal(now.name, 'Old Tea');
  assert.equal(fs.readdirSync(dir).filter((f) => f.includes('.tmp-')).length, 0, 'no temporary files are left');
  assert.equal(migrateVorlds().find((r) => r.id === 'old-tea'), undefined, 'a second start-up changes nothing');
  assert.equal(fs.readdirSync(path.join(dir, 'backups')).length, 1);
});

test('a vorld from a newer OpenVorld is never opened or changed', () => {
  const text = `name: From The Future\nschema: ${DATA_SCHEMA + 5}\nnew_thing: 1\ncrew: []\n`;
  const dir = put('future', text);
  const r = migrateVorlds().find((x) => x.id === 'future');
  assert.equal(r.status, 'newer');
  assert.equal(fs.readFileSync(path.join(dir, 'vorld.yaml'), 'utf8'), text, 'byte for byte the same');
  assert.equal(fs.existsSync(path.join(dir, 'backups')), false);
  assert.equal(listVorlds().find((v) => v.id === 'future').newer, true);
  assert.throws(() => vorldCtx('future', { fresh: true }), (e) => e.status === 409 && /newer OpenVorld/.test(e.message));
});

test('a vorld copied in while the app runs is migrated when it is opened', () => {
  put('copied-in', 'name: Copied\ncrew: []\n');
  const ctx = vorldCtx('copied-in', { fresh: true });
  assert.equal(ctx.doc.schema, DATA_SCHEMA);
  assert.ok(fs.existsSync(path.join(home, 'vorlds', 'copied-in', 'backups')));
});
