import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceApi, catalogQuery, normalizeVoice, safePreviewUrl } from '../voices.mjs';
import { createApp, FREE_MODEL } from '../server.mjs';

const id = 'a'.repeat(32);
const sampleUrl = 'https://platform.r2.fish.audio/task/sample.mp3';
const fixture = (extra = {}) => ({ _id: id, type: 'tts', state: 'trained', title: 'A real voice', languages: ['en'], tags: ['warm'], licensed: true, author: { nickname: 'Voice creator', _id: 'private-author-id' }, samples: [{ audio: sampleUrl }], ...extra });

test('catalog normalization returns usable TTS voices and strips private provider fields', () => {
  const result = normalizeVoice(fixture());
  assert.equal(result.name, 'A real voice');
  assert.equal(result.preview, `/api/voices/${id}/preview`);
  assert.equal(result.id, id);
  assert.ok(!JSON.stringify(result).includes('private-author-id'));
  assert.ok(!('samples' in result));
  for (const extra of [{ type: 'svc' }, { state: 'training' }, { dmca_taken_down: true }, { pvc_release_state: 'retiring' }, { _id: 'bad' }]) assert.equal(normalizeVoice(fixture(extra)), null);
});

test('catalog filters are validated and mapped to documented provider fields', () => {
  const { params, page } = catalogQuery(new URLSearchParams({ source: 'licensed', page: '2', q: 'calm', language: 'en' }));
  assert.equal(page, 2); assert.equal(params.get('page_number'), '2'); assert.equal(params.get('licensed'), 'true'); assert.equal(params.get('title'), 'calm'); assert.equal(params.get('language'), 'en');
  assert.equal(catalogQuery(new URLSearchParams({ source: 'mine' })).params.get('self'), 'true');
  for (const query of [{ source: 'bad' }, { page: '0' }, { page: '1.5' }, { page: '101' }, { language: 'http://evil.test' }, { q: 'x'.repeat(101) }]) assert.throws(() => catalogQuery(new URLSearchParams(query)), { status: 400 });
});

test('preview URLs require the exact official HTTPS CDN host', () => {
  assert.equal(safePreviewUrl(sampleUrl), sampleUrl);
  const signed = 'https://c97f3361a1c971323738e24f451a0225.r2.cloudflarestorage.com/fish-platform-data/tasks/sample.mp3?signature=example';
  assert.equal(safePreviewUrl(signed), signed);
  for (const url of ['http://platform.r2.fish.audio/a', 'https://platform.r2.fish.audio.evil.test/a', 'https://platform.r2.fish.audio@evil.test/a', 'https://user:secret@platform.r2.fish.audio/a', 'https://127.0.0.1/a', 'https://platform.r2.fish.audio:444/a', 'https://another-account.r2.cloudflarestorage.com/fish-platform-data/tasks/sample.mp3', 'https://c97f3361a1c971323738e24f451a0225.r2.cloudflarestorage.com/other-bucket/sample.mp3', 'file:///etc/passwd', null]) assert.equal(safePreviewUrl(url), null);
});

test('voice catalog is cached and existing sample preview never receives the API key', async () => {
  const calls = [];
  const api = createVoiceApi({ apiKey: 'test-key', fetchImpl: async (url, options) => {
    calls.push(url);
    if (url === sampleUrl) {
      assert.equal(options.headers, undefined); assert.equal(options.redirect, 'error');
      return new Response('sample audio', { headers: { 'Content-Type': 'audio/mpeg' } });
    }
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    return Response.json(url.includes('?') ? { total: 1, items: [fixture()], has_more: false } : fixture());
  } });
  const query = new URLSearchParams({ language: 'en' });
  assert.equal((await api.list(query)).items[0].id, id);
  await api.list(query);
  assert.equal(calls.length, 1);
  assert.equal((await api.get(id)).name, 'A real voice');
  assert.equal((await api.preview(id)).data.toString(), 'sample audio');
  assert.equal(calls.length, 3);
});

test('unsafe, missing, oversized, and non-audio samples do not reach the browser', async () => {
  for (const samples of [[], [{ audio: 'https://evil.test/a.mp3' }]]) {
    const api = createVoiceApi({ apiKey: 'test', fetchImpl: async () => Response.json(fixture({ samples })) });
    await assert.rejects(api.preview(id), { status: 404 });
  }
  for (const headers of [{ 'Content-Type': 'text/html' }, { 'Content-Type': 'audio/mpeg', 'Content-Length': '9000000' }]) {
    const api = createVoiceApi({ apiKey: 'test', fetchImpl: async (url) => url === sampleUrl ? new Response('bad', { headers }) : Response.json(fixture()) });
    await assert.rejects(api.preview(id), { status: 502 });
  }
});

test('detail and catalog failures remain safe and retryable', async () => {
  const missing = createVoiceApi({ apiKey: '', fetchImpl: () => assert.fail('Must not call provider') });
  await assert.rejects(missing.get(id), { status: 503 });
  let calls = 0;
  const api = createVoiceApi({ apiKey: 'test', fetchImpl: async () => { calls++; return calls === 1 ? new Response('secret', { status: 401 }) : Response.json(fixture()); } });
  await assert.rejects(api.get(id), { status: 401, message: 'Your Fish Audio API key was rejected.' });
  assert.equal((await api.get(id)).id, id); assert.equal(calls, 2);
});

test('two explicit-voice synthesis requests retain the same voice and free engine', async () => {
  const requests = [];
  const server = createApp({ apiKey: 'test', model: FREE_MODEL, fetchImpl: async (url, options) => {
    requests.push({ model: options.headers.model, body: JSON.parse(options.body) });
    return new Response('audio', { headers: { 'Content-Type': 'audio/mpeg' } });
  } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const text of ['First script', 'Second script']) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, referenceId: id }) });
      assert.equal(response.status, 200); assert.equal(response.headers.get('x-fish-voice-id'), id); await response.arrayBuffer();
    }
    assert.deepEqual(requests.map((r) => r.body.reference_id), [id, id]); assert.ok(requests.every((r) => r.model === FREE_MODEL));
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
