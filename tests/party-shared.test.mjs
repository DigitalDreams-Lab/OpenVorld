// A party's shared folder: files the founder attaches and files a member names are copied in, everyone in the room is told
// where they are and reads them with their own tools, and the folder outlives the party (mocked HTTP, no network).
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { makeVorld, saveVorld } from './helpers/vorld.mjs';

const P = await import('../engine/server/parties.mjs');
const F = await import('../engine/server/party-files.mjs');
const { grant } = await import('../engine/server/gate.mjs');
const { saveAttachment, publicFiles } = await import('../engine/server/attachments.mjs');
const { readEvents, appendEvent } = await import('../engine/server/threads.mjs');

const sse = (parts) => new Response([].concat(parts).map((p) => `data: ${JSON.stringify({ choices: [{ delta: typeof p === 'string' ? { content: p } : p }] })}\n\n`).join('') + 'data: [DONE]\n\n');

function crewOf() {
  let ctx = makeVorld({ name: 'Shared Test', brain: { provider: 'openai-compatible', model: 'party-test' }, crew: [{ name: 'Ada', job: 'Writer' }, { name: 'Bo Li', job: 'Editor' }] });
  ctx = saveVorld(ctx, (d) => { d.providers = [{ id: 'openai-compatible', base_url: 'https://example.invalid/v1' }]; });
  const [ada, bo] = ctx.crew.filter((c) => c.role === 'agent').map((c) => c.id);
  return { ctx, ada, bo };
}

test('a party has a shared folder from the start, and it stays when the party is deleted', () => {
  const { ctx, ada } = crewOf();
  const party = P.saveParty(ctx, { name: 'Keepers', goal: 'g', members: [ada] });
  const dir = F.sharedDir(ctx, party.id);
  assert.ok(fs.statSync(dir).isDirectory());
  assert.ok(dir.includes(path.join('parties', party.id, 'shared')));
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'keep me');
  P.deleteParty(ctx, party.id);
  assert.equal(fs.readFileSync(path.join(dir, 'notes.txt'), 'utf8'), 'keep me', 'the files outlive the party');
  assert.ok(!P.listParties(ctx).some((p) => p.id === party.id));
});

test('the room prompt names the folder, lists its files, and tells everyone who shared a founder file', () => {
  const { ctx, ada, bo } = crewOf();
  const party = P.saveParty(ctx, { name: 'Duo', goal: 'g', members: [ada, bo] });
  const chat = P.createPartyChat(ctx, party.id);
  const att = saveAttachment(ctx, chat.id, 'cover.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]));
  appendEvent(ctx, chat.id, { type: 'founder.message', text: 'Look at this cover', attachments: publicFiles([att]) });
  const prompt = P.roomPrompt(ctx, party, chat.id, bo);
  const dir = F.sharedDir(ctx, party.id);
  assert.match(prompt, new RegExp(`shared folder[^\\n]*${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), 'the folder is named');
  const copied = fs.readdirSync(dir).filter((f) => f.startsWith('founder-') && f.endsWith('-cover.png'));
  assert.equal(copied.length, 1, 'the attachment is copied under a readable name');
  assert.ok(prompt.includes(`[Founder shared ${copied[0]}: ${path.join(dir, copied[0])}]`), 'the room says who shared it and where it is');
  assert.ok(prompt.includes(`Files there now: ${copied[0]}`), 'the folder is listed');
  assert.equal(fs.readFileSync(path.join(dir, copied[0])).length, 11, 'a real copy');
  P.roomPrompt(ctx, party, chat.id, ada);
  assert.equal(fs.readdirSync(dir).length, 1, 'the same file is never copied twice');
});

test('a member shares a file it can read; the next member is told, and reads it with its own tools', async (t) => {
  const { ctx, ada, bo } = crewOf();
  const party = P.saveParty(ctx, { name: 'Pair', goal: 'g', members: [ada, bo] });
  const chat = P.createPartyChat(ctx, party.id);
  const mine = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-mine-')), elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-else-'));
  fs.writeFileSync(path.join(mine, 'plan.md'), '# The plan: tea first');
  fs.writeFileSync(path.join(mine, '.env'), 'SECRET=1');
  fs.writeFileSync(path.join(elsewhere, 'private.txt'), 'not yours');
  grant(ctx, { role: ada, capability: 'fs.read', scope: mine });
  const seen = [];
  let boRound = 0, boSaw = '';
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const messages = JSON.parse(options.body).messages, body = JSON.stringify(messages);
    const who = body.includes('You are Ada in the party') ? ada : bo;
    seen.push(who);
    if (who === ada) return sse('Here is the plan. @Bo Li have a look.\n```ov\n' + JSON.stringify({ share: [path.join(mine, 'plan.md'), path.join(mine, '.env'), path.join(elsewhere, 'private.txt')] }) + '\n```');
    boRound++;
    if (boRound === 1) {
      const shared = fs.readdirSync(F.sharedDir(ctx, party.id)).find((f) => f.endsWith('plan.md'));
      assert.ok(body.includes(`[Ada shared ${shared}: ${path.join(F.sharedDir(ctx, party.id), shared)}]`), 'Bo is told where Ada put it');
      return sse([{ tool_calls: [{ index: 0, id: 'r1', function: { name: 'read_file', arguments: JSON.stringify({ path: path.join(F.sharedDir(ctx, party.id), shared) }) } }] }]);
    }
    boSaw = body;
    return sse('Read it, tea first. Looks good.');
  });
  await P.runParty(ctx, chat.id, '@Ada share your plan', [], () => {});
  assert.deepEqual(seen.slice(0, 2), [ada, bo]);
  assert.match(boSaw, /The plan: tea first/, 'Bo read the shared file with its own read tool, with no writ');
  const dir = F.sharedDir(ctx, party.id), files = fs.readdirSync(dir);
  assert.deepEqual(files.map((f) => f.replace(/^ada-[0-9a-f]{6}-/, '')), ['plan.md'], 'only the readable file was copied: not the .env, not the file outside Ada\'s folders');
  const said = readEvents(ctx, chat.id).find((e) => e.type === 'agent.text' && e.role === ada);
  assert.deepEqual(said.meta.shared, files, 'the room records what was shared');
  assert.ok(!('share' in said.meta), 'the raw paths are not kept');
});
