import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, validateSpeech, FREE_MODEL } from '../server.mjs';

async function withServer(options, run) {
  const server = createApp(options);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run(base); }
  finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

const post = (base, body, headers = {}) => fetch(`${base}/api/tts`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

test('rejects malformed text, voice IDs, and speed before calling Fish', () => {
  for (const body of [null, [], {}, { text: ' ' }, { text: 'a'.repeat(3001) }, { text: 'Hello', referenceId: 'bad' }, { text: 'Hello', speed: 2 }, { text: 'Hello', speed: '1' }]) {
    assert.throws(() => validateSpeech(body), { status: 400 });
  }
  const body = validateSpeech({ text: '  Hello  ', referenceId: 'a'.repeat(32), speed: 1.2 });
  assert.equal(body.text, 'Hello');
  assert.equal(body.reference_id, 'a'.repeat(32));
  assert.equal(body.prosody.speed, 1.2);
  assert.ok(!('reference_id' in validateSpeech({ text: 'Hello' })));
});

test('serves the UI and safe configuration without exposing the key or .env', async () => {
  await withServer({ apiKey: 'secret-test-key', model: FREE_MODEL }, async (base) => {
    const status = await fetch(`${base}/api/status`);
    const text = await status.text();
    assert.equal(status.status, 200);
    assert.ok(!text.includes('secret-test-key'));
    assert.equal(JSON.parse(text).configured, true);
    assert.equal((await fetch(`${base}/.env`)).status, 404);
    assert.equal((await fetch(`${base}/server.mjs`)).status, 404);
    assert.equal((await fetch(`${base}/`)).status, 200);
  });
});

test('sends the exact free-model header and returns MP3 and timing', async () => {
  let calls = 0;
  await withServer({ apiKey: 'secret-test-key', model: FREE_MODEL, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.fish.audio/v1/tts');
    assert.equal(options.headers.model, FREE_MODEL);
    assert.equal(options.headers.Authorization, 'Bearer secret-test-key');
    const body = JSON.parse(options.body);
    assert.equal(body.text, 'Hello');
    assert.equal(body.format, 'mp3');
    assert.ok(!('reference_id' in body));
    return new Response(new Uint8Array([0x49, 0x44, 0x33, 0]), { headers: { 'Content-Type': 'audio/mpeg' } });
  } }, async (base) => {
    const response = await post(base, { text: 'Hello', model: 's2.1-pro' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'audio/mpeg');
    assert.equal(response.headers.get('x-fish-model'), FREE_MODEL);
    assert.ok(Number.isFinite(Number(response.headers.get('x-generation-ms'))));
    assert.equal((await response.arrayBuffer()).byteLength, 4);
  });
  assert.equal(calls, 1);
});

test('missing credentials, paid or misspelled models, and foreign origins never call Fish', async () => {
  const fetchImpl = async () => { assert.fail('Provider should not be called'); };
  for (const config of [{ apiKey: '', model: FREE_MODEL, status: 503 }, { apiKey: 'test', model: 's2.1-pro', status: 409 }, { apiKey: 'test', model: 's2.1-free', status: 409 }]) {
    await withServer({ ...config, fetchImpl }, async (base) => {
      assert.equal((await post(base, { text: 'Hello' })).status, config.status);
    });
  }
  await withServer({ apiKey: 'test', model: FREE_MODEL, fetchImpl }, async (base) => {
    assert.equal((await post(base, { text: 'Hello' }, { Origin: 'https://example.com' })).status, 403);
    assert.equal((await post(base, { text: ' ' })).status, 400);
    const oversized = await post(base, { text: 'a'.repeat(25000) });
    assert.equal(oversized.status, 413);
  });
});

test('provider failures are understandable and never retried on a paid model', async () => {
  for (const status of [400, 401, 402, 403, 429, 503]) {
    let calls = 0;
    await withServer({ apiKey: 'test', model: FREE_MODEL, fetchImpl: async () => {
      calls++;
      return new Response('secret-provider-body', { status });
    } }, async (base) => {
      const response = await post(base, { text: 'Hello' });
      assert.equal(response.status, status >= 500 ? 502 : status);
      const body = await response.json();
      assert.ok(body.error.length > 10);
      assert.ok(!body.error.includes('secret-provider-body'));
    });
    assert.equal(calls, 1);
  }
});

test('rejects empty audio and unexpected provider content; recovers after network failure', async () => {
  for (const result of [new Response('', { headers: { 'Content-Type': 'audio/mpeg' } }), new Response('{}', { headers: { 'Content-Type': 'application/json' } })]) {
    await withServer({ apiKey: 'test', model: FREE_MODEL, fetchImpl: async () => result }, async (base) => {
      assert.equal((await post(base, { text: 'Hello' })).status, 502);
    });
  }
  let calls = 0;
  await withServer({ apiKey: 'test', model: FREE_MODEL, fetchImpl: async () => {
    calls++;
    if (calls === 1) throw new TypeError('Network failure');
    return new Response('audio', { headers: { 'Content-Type': 'audio/mpeg' } });
  } }, async (base) => {
    assert.equal((await post(base, { text: 'Hello' })).status, 502);
    assert.equal((await post(base, { text: 'Hello' })).status, 200);
  });
});

test('allows only one generation at a time and releases the slot afterward', async () => {
  let release;
  let announce;
  const arrived = new Promise((resolve) => { announce = resolve; });
  await withServer({ apiKey: 'test', model: FREE_MODEL, fetchImpl: async () => {
    announce();
    await new Promise((resolve) => { release = resolve; });
    return new Response('audio', { headers: { 'Content-Type': 'audio/mpeg' } });
  } }, async (base) => {
    const first = post(base, { text: 'Hello' });
    await arrived;
    try { assert.equal((await post(base, { text: 'Another' })).status, 429); }
    finally { release(); }
    assert.equal((await first).status, 200);
  });
});
