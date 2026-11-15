import test from 'node:test';
import assert from 'node:assert/strict';
import { clientModule } from './helpers/client.mjs';
const { lastActivityLine, liveActivityLine, agentActivity } = await clientModule('engine/client/src/activity.ts');

test('activity uses the last prose line, hides command envelopes, and bounds long responses', () => {
  assert.equal(lastActivityLine('First I checked the files.\n\n**Now running the tests.**'), 'Now running the tests.');
  assert.equal(lastActivityLine('All done.\n```ov\n{"mood":"happy","commands":[]}\n```'), 'All done.');
  assert.equal(lastActivityLine('## Results\n- Saved [report](https://example.com).'), 'Saved report.');
  const text = lastActivityLine('x'.repeat(200) + 'final words');
  assert.ok(text.length <= 170); assert.ok(text.endsWith('final words'));
  assert.equal(lastActivityLine(''), '');
});

test('working balloons describe the latest tool, plan, or streamed line', () => {
  const turn = { role: 'writer', working: true, steps: [{ t: 'text', text: 'Getting started.' }, { t: 'tool', kind: 'tool.read', target: 'notes.md', status: 'running' }] };
  assert.equal(liveActivityLine(turn), 'Reading notes.md');
  turn.steps.push({ t: 'plan', items: [{ text: 'Gather sources', status: 'completed' }, { text: 'Write the draft', status: 'in_progress' }] });
  assert.equal(liveActivityLine(turn), 'Write the draft');
  turn.steps.push({ t: 'text', text: 'The outline is ready.\nWriting the introduction now.' });
  assert.equal(liveActivityLine(turn), 'Writing the introduction now.');
});

test('browser previews appear only for active work, never from restored idle frames', () => {
  const idle = { image: 'saved-preview', active: false, url: 'https://example.com/private?token=secret' };
  assert.equal(agentActivity('writer', {}, idle, 10000), null);
  const activity = agentActivity('writer', {}, { ...idle, active: true, title: 'Reading sources' }, 10000);
  assert.equal(activity.image, 'saved-preview'); assert.equal(activity.kind, 'browser');
  assert.equal(activity.site, 'example.com'); assert.equal(activity.text, 'Reading sources');
  assert.equal(agentActivity('writer', {}, undefined, 10000, { text: '', at: 9999 }), null);
});

test('each agent retains its own final line across party handoffs, then expires', () => {
  const turns = { party: { role: 'editor', working: true, updatedAt: 10000, steps: [] } };
  const note = { text: 'Draft ready for review.', at: 9500 };
  assert.equal(agentActivity('writer', turns, undefined, 10000, note).text, note.text);
  assert.equal(agentActivity('writer', turns, undefined, 16000, note), null);
  assert.equal(agentActivity('editor', turns, undefined, 16000).kind, 'work');
});

test('active jobs win over newer finished chats and error notes clear on the next job', () => {
  const turns = {
    active: { role: 'writer', working: true, updatedAt: 9000, steps: [{ t: 'text', text: 'Still researching.' }] },
    done: { role: 'writer', working: false, updatedAt: 10000, steps: [] },
  };
  assert.equal(agentActivity('writer', turns, undefined, 11000).text, 'Still researching.');
  assert.equal(agentActivity('writer', {}, undefined, 11000, { text: 'Access needed.', at: 10000, error: true }).kind, 'error');
  assert.equal(agentActivity('writer', turns, undefined, 11000, { text: 'Access needed.', at: 10000, error: true }).kind, 'work');
});
