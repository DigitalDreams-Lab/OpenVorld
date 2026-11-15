import test from 'node:test';
import assert from 'node:assert/strict';
import { clientModule } from './helpers/client.mjs';
const { fileName, previewKind, codePreviewKind, relatedFileUrl, tableRows, rawMarkup, PREVIEW_CSP } = await clientModule('engine/client/src/previews.ts');

test('message previews classify supported files without treating unknown binaries as text', () => {
  for (const [name, kind] of [['report.html', 'html'], ['drawing.svg', 'svg'], ['PHOTO.PNG', 'image'], ['song.mp3', 'audio'], ['clip.webm', 'video'], ['report.pdf', 'pdf'], ['notes.md', 'markdown'], ['data.json', 'json'], ['rows.tsv', 'csv'], ['app.tsx', 'text'], ['archive.zip', null]]) assert.equal(previewKind(name), kind);
  assert.equal(previewKind('attachment', 'image/jpeg'), 'image');
  assert.equal(fileName('/Users/me/My Project/app.ts:12'), 'app.ts');
  assert.equal(fileName('/api/vorlds/demo/threads/chat/file?path=%2Ftmp%2Freport.html'), 'report.html');
  assert.equal(codePreviewKind('html', '<h1>Hi</h1>'), 'html');
  assert.equal(codePreviewKind('js', 'alert(1)'), null);
  assert.ok(rawMarkup('<!doctype html><html></html>')); assert.equal(rawMarkup('<script>alert(1)</script>'), false);
});

test('HTML assets retain the conversation route and reject network and executable URLs', () => {
  const base = '/api/vorlds/demo/threads/chat/file?path=%2Ftmp%2FMy%20Project%2Fpages%2Findex.html';
  const url = relatedFileUrl(base, '../assets/photo.png');
  assert.equal(new URL(url, 'https://example.invalid').searchParams.get('path'), '/tmp/My Project/assets/photo.png');
  assert.ok(url.startsWith('/api/vorlds/demo/threads/chat/file?'));
  for (const ref of ['https://example.com/asset', '//localhost/leak', 'javascript:alert(1)', 'file:///etc/passwd', '#fragment']) assert.equal(relatedFileUrl(base, ref), null);
  assert.equal(relatedFileUrl('/api/vorlds/demo/threads/chat/attachments/123', 'style.css'), null);
  assert.match(PREVIEW_CSP, /script-src 'none'/); assert.match(PREVIEW_CSP, /connect-src 'none'/);
});

test('CSV and TSV previews preserve quoted fields and stop at their display limit', () => {
  assert.deepEqual(tableRows('Name,Note\r\nAda,"One, two"\r\nBo,"Line 1\nLine 2"\r\nCy,"A ""quote"""'), [['Name', 'Note'], ['Ada', 'One, two'], ['Bo', 'Line 1\nLine 2'], ['Cy', 'A "quote"']]);
  assert.deepEqual(tableRows('Name\tCount\nAda\t3', '\t'), [['Name', 'Count'], ['Ada', '3']]);
  assert.equal(tableRows('a,b\n'.repeat(1000)).length, 101);
});

test('preview downloads enforce a streaming limit while normal downloads remain unrestricted', async t => {
  const previous = globalThis.document; globalThis.document = { querySelector: () => null };
  const { fileBlob } = await clientModule('engine/client/src/api.ts');
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  t.mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array(64), { headers: { 'content-type': 'application/octet-stream' } }));
  await assert.rejects(fileBlob('/api/vorlds/demo/threads/chat/file?path=x', undefined, 32), /preview is limited/);
  assert.equal((await fileBlob('/api/vorlds/demo/threads/chat/file?path=x')).size, 64);
  await assert.rejects(fileBlob('https://example.com/file.html'), /Invalid local file URL/);
});
