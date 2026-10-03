import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, validateSpeech, FREE_MODEL } from '../server.mjs';
import { cloneForm, createStudioApi } from '../studio-api.mjs';
import { emotionGroups, insertCue, normalizeCue } from '../public/emotions.js';
import { pcmToWav } from '../public/audio.js';
import { readTimestampAudio } from '../timestamps.mjs';
import { toSrt } from '../public/subtitles.js';

const alice = 'a'.repeat(32), bob = 'b'.repeat(32);
const rawVoice = { _id: alice, title: 'My voice', description: '', type: 'tts', state: 'trained', languages: ['en'], tags: [], samples: [] };
async function withServer(fetchImpl, run) {
  const server = createApp({ apiKey: 'test-secret', model: FREE_MODEL, fetchImpl });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}
function samples() {
  const form = new FormData(); form.set('title', 'My voice');
  form.append('voices', new Blob(['sample'], { type: 'audio/wav' }), 'sample.wav');
  return form;
}

test('the bundled font is served as a real font without external font requests', async () => {
  await withServer(() => assert.fail('No provider request expected'), async (base) => {
    const response = await fetch(`${base}/fonts/manrope-variable.ttf`);
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'font/ttf');
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 4)], [0, 1, 0, 0]); assert.ok(bytes.length > 100000);
    assert.equal((await fetch(`${base}/fonts/OFL-Manrope.txt`)).status, 404);
  });
});

test('emotion cues insert at the selection and preserve the script limit', () => {
  assert.ok(Object.values(emotionGroups).flat().length >= 90);
  assert.deepEqual(insertCue('Hello world', 6, 11, 'whispering'), { text: 'Hello [whispering] ', caret: 19 });
  assert.equal(normalizeCue('[happy]'), '[happy]');
  assert.throws(() => normalizeCue('happy\nnow')); assert.throws(() => normalizeCue('[bad[tag]]'));
  assert.throws(() => insertCue('a'.repeat(3000), 3000, 3000, 'happy'));
});

test('PCM playback wraps the original samples in a mono 16-bit WAV header', async () => {
  const pcm = new Uint8Array([1, 2, 3, 4]);
  const wav = pcmToWav(pcm.buffer, 24000); const bytes = await wav.arrayBuffer(); const view = new DataView(bytes);
  assert.equal(wav.type, 'audio/wav'); assert.equal(view.getUint32(24, true), 24000);
  assert.equal(view.getUint16(22, true), 1); assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 4); assert.deepEqual(new Uint8Array(bytes, 44), pcm);
});

test('dialogue and pronunciation settings reach the free API in the documented schema', async () => {
  await withServer(async (url, options) => {
    assert.equal(url, 'https://api.fish.audio/v1/tts'); assert.equal(options.headers.model, FREE_MODEL);
    const body = JSON.parse(options.body);
    assert.deepEqual(body.reference_id, [alice, bob]); assert.equal(body.top_p, .5);
    assert.deepEqual(body.prosody, { speed: 1.1, volume: -3, normalize_loudness: true });
    assert.deepEqual(body.pronunciation_dictionary, [{ items: [{ key: 'Studio', value: 'S T UW D IY OW', case_sensitive: false }] }]);
    assert.deepEqual(body.features, ['quality-guard']); assert.equal(body.condition_on_previous_chunks, false);
    return new Response('audio', { headers: { 'Content-Type': 'audio/wav' } });
  }, async (base) => {
    const response = await fetch(`${base}/api/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '<|speaker:0|>Hello<|speaker:1|>Hi', speakers: [alice, bob], referenceId: alice, format: 'wav', sampleRate: 24000, speed: 1.1, volume: -3, normalizeLoudness: true, topP: .5, qualityGuard: true, previousChunks: false, pronunciation: [{ key: 'Studio', value: 'S T UW D IY OW', case_sensitive: false }] }) });
    assert.equal(response.status, 200); assert.equal(response.headers.get('x-fish-voice-id'), `${alice},${bob}`);
  });
});

test('all output formats keep the free model and return matching downloads', async () => {
  const types = { mp3: 'audio/mpeg', wav: 'audio/wav', opus: 'audio/ogg', pcm: 'application/octet-stream' };
  await withServer(async (url, options) => {
    assert.equal(options.headers.model, FREE_MODEL);
    return new Response('audio', { headers: { 'Content-Type': types[JSON.parse(options.body).format] } });
  }, async (base) => {
    for (const [format, type] of Object.entries(types)) {
      const response = await fetch(`${base}/api/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Hello', referenceId: alice, format }) });
      assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), type);
      assert.equal(response.headers.get('content-disposition'), `attachment; filename="recording.${format}"`);
      assert.equal(response.headers.get('x-fish-model'), FREE_MODEL);
    }
  });
});

test('invalid format, dialogue, and advanced settings are rejected locally', () => {
  for (const options of [{ format: 'flac' }, { format: 'opus', sampleRate: 44100 }, { bitrate: 999 }, { volume: '3' }, { topP: 2 }, { normalize: 1 }, { speakers: [alice] }, { speakers: [alice, bob], text: '<|speaker:2|>Hello' }, { text: '<|speaker:0|>Hello' }, { pronunciation: [{ key: 'word', value: 'phoneme', case_sensitive: 'yes' }] }]) {
    assert.throws(() => validateSpeech({ text: 'Hello', ...options }), { status: 400 });
  }
});

test('large pronunciation dictionaries remain within the local request budget', async () => {
  await withServer(async () => new Response('audio', { headers: { 'Content-Type': 'audio/mpeg' } }), async (base) => {
    const pronunciation = Array.from({ length: 100 }, (_, i) => ({ key: `word${i}`, value: 'A'.repeat(1024), case_sensitive: false }));
    const response = await fetch(`${base}/api/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Hello', pronunciation }) });
    assert.equal(response.status, 200);
  });
});

test('voice cloning forces private fast clones and avoids automatic synthesis', () => {
  const input = samples(); input.set('visibility', 'public'); input.set('train_mode', 'full'); input.set('generate_sample', 'true');
  const output = cloneForm(input);
  assert.equal(output.get('visibility'), 'private'); assert.equal(output.get('train_mode'), 'fast'); assert.equal(output.get('generate_sample'), 'false');
  assert.equal(output.getAll('voices').length, 1);
  input.append('texts', 'Hello'); assert.equal(cloneForm(input).get('texts'), 'Hello');
  input.append('voices', new Blob(['second']), 'second.wav'); assert.throws(() => cloneForm(input), { status: 400 });
  const invalid = samples(); invalid.set('voices', new Blob(['bad']), 'sample.txt'); assert.throws(() => cloneForm(invalid), { status: 400 });
  assert.throws(() => cloneForm(new FormData()), { status: 400 });
});

test('clone, edit, delete and catalog refresh use server credentials and invalidate stale voices', async () => {
  let state = 'trained', title = 'My voice', listCalls = 0;
  await withServer(async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    if (url.includes('/model?')) { listCalls++; return Response.json({ items: [{ ...rawVoice, state, title }], total: 1 }); }
    if (options.method === 'POST') { assert.equal(url, 'https://api.fish.audio/model'); assert.equal(options.body.get('visibility'), 'private'); state = 'training'; }
    if (options.method === 'PATCH') { title = options.body.get('title'); assert.deepEqual(options.body.getAll('tags'), ['warm']); }
    if (options.method === 'DELETE') return new Response(null, { status: 204 });
    return Response.json({ ...rawVoice, state, title });
  }, async (base) => {
    const list = () => fetch(`${base}/api/voices?source=mine&language=`);
    await list(); await list(); assert.equal(listCalls, 1);
    const clone = await fetch(`${base}/api/custom-voices`, { method: 'POST', body: samples() });
    assert.equal(clone.status, 201); assert.equal((await clone.json()).state, 'training');
    const pending = await (await list()).json(); assert.equal(pending.items[0].state, 'training'); assert.equal(listCalls, 2);
    state = 'trained'; const refreshed = await (await fetch(`${base}/api/voices?source=mine&refresh=1`)).json();
    assert.equal(refreshed.items[0].state, 'trained'); assert.equal(listCalls, 3);
    const edit = await fetch(`${base}/api/custom-voices/${alice}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Renamed voice', description: 'My sample', tags: ['warm'] }) });
    assert.equal(edit.status, 200); assert.equal((await edit.json()).name, 'Renamed voice');
    const remove = await fetch(`${base}/api/custom-voices/${alice}`, { method: 'DELETE' }); assert.equal(remove.status, 200);
    assert.deepEqual(await remove.json(), { deleted: true });
  });
});

test('custom voice mutations reject foreign origins and malformed edits before contacting Fish', async () => {
  await withServer(() => assert.fail('Provider should not be called'), async (base) => {
    for (const method of ['PATCH', 'DELETE']) assert.equal((await fetch(`${base}/api/custom-voices/${alice}`, { method, headers: { Origin: 'https://example.com' } })).status, 403);
    assert.equal((await fetch(`${base}/api/custom-voices`, { method: 'POST', body: samples(), headers: { Origin: 'https://example.com' } })).status, 403);
    assert.equal((await fetch(`${base}/api/custom-voices/${alice}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: 'null' })).status, 400);
    for (const path of ['/api/transcribe', '/api/voice-design']) assert.equal((await fetch(`${base}${path}`, { method: 'POST' })).status, 404);
  });
});

test('clone provider errors do not leak response bodies or retry a paid operation', async () => {
  let calls = 0;
  const api = createStudioApi({ apiKey: 'test-secret', fetchImpl: async () => { calls++; return new Response('sensitive-provider-text', { status: 402 }); } });
  await assert.rejects(api.clone(samples()), (error) => error.status === 402 && !error.message.includes('sensitive-provider-text'));
  assert.equal(calls, 1);
});

test('timestamp stream handles split UTF-8 frames and replaces cumulative snapshots', async () => {
  const payloads = [
    { audio_base64: 'AQI=', alignment: null },
    { audio_base64: 'AwQ=', chunk_seq: 0, chunk_audio_offset_sec: 0, alignment: { segments: [{ text: 'Héllo', start: 0, end: .5 }] } },
    { audio_base64: '', chunk_seq: 0, chunk_audio_offset_sec: 0, alignment: { segments: [{ text: 'Héllo', start: 0, end: .5 }, { text: 'world', start: .5, end: 1 }] } },
    { audio_base64: 'BQY=', chunk_seq: 1, chunk_audio_offset_sec: 1.2, alignment: { segments: [{ text: 'Again', start: 0, end: .4 }] } },
  ];
  const bytes = new TextEncoder().encode(payloads.map((value) => `data: ${JSON.stringify(value)}\r\n\r\n`).join(''));
  const stream = new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); } });
  const result = await readTimestampAudio(new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }));
  assert.deepEqual([...result.audio], [1, 2, 3, 4, 5, 6]); assert.equal(result.timeline.length, 3);
  assert.equal(result.timeline[0].text, 'Héllo'); assert.equal(result.timeline[2].start, 1.2); assert.equal(result.timeline[2].end, 1.6);
  assert.equal(toSrt(result.timeline), '1\n00:00:00,000 --> 00:00:01,000\nHéllo world\n\n2\n00:00:01,200 --> 00:00:01,600\nAgain\n');
});

test('timestamp generation uses only the free endpoint and returns complete audio plus timings', async () => {
  await withServer(async (url, options) => {
    assert.equal(url, 'https://api.fish.audio/v1/tts/stream/with-timestamp'); assert.equal(options.headers.model, FREE_MODEL);
    assert.equal(JSON.parse(options.body).timestamps, undefined);
    return new Response(`data: ${JSON.stringify({ audio_base64: 'AQI=', chunk_seq: 0, chunk_audio_offset_sec: 0, alignment: { segments: [{ text: 'Hello', start: 0, end: .5 }] } })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  }, async (base) => {
    const response = await fetch(`${base}/api/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Hello', referenceId: alice, timestamps: true, format: 'pcm' }) });
    assert.equal(response.status, 200); assert.equal(response.headers.get('x-fish-model'), FREE_MODEL); assert.equal(response.headers.get('x-fish-voice-id'), alice);
    const body = await response.json(); assert.equal(body.audioBase64, 'AQI='); assert.equal(body.timeline[0].end, .5);
  });
});

test('malformed timestamp responses fail safely without another synthesis request', async () => {
  for (const content of ['data: not-json\n\n', 'data: {"audio_base64":"bad?"}\n\n', 'data: {"audio_base64":""}\n\n']) {
    await assert.rejects(readTimestampAudio(new Response(content, { headers: { 'Content-Type': 'text/event-stream' } })), { status: 502 });
  }
  let calls = 0;
  await withServer(async () => { calls++; return Response.json({ unexpected: 'private-provider-text' }); }, async (base) => {
    const response = await fetch(`${base}/api/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Hello', timestamps: true }) });
    assert.equal(response.status, 502); assert.ok(!(await response.text()).includes('private-provider-text'));
  });
  assert.equal(calls, 1);
});
