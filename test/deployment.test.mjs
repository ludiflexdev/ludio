import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deploymentConfig, createAccessGuard } from '../deployment.mjs';
import { createApp, FREE_MODEL } from '../server.mjs';

const production = () => deploymentConfig({ NODE_ENV: 'production', APP_ORIGIN: 'https://studio.example.com', STUDIO_USERNAME: 'studio', STUDIO_PASSWORD: 'test-password-123456', TTS_REQUESTS_PER_MINUTE: '2' });
const credentials = `Basic ${Buffer.from('studio:test-password-123456').toString('base64')}`;
async function withServer(options, run) {
  const server = createApp({ apiKey: 'test-key', model: FREE_MODEL, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}
const post = (base, headers = {}) => fetch(`${base}/api/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: credentials, Origin: 'https://studio.example.com', ...headers }, body: JSON.stringify({ text: 'Hello', referenceId: 'a'.repeat(32) }) });

test('production requires HTTPS origin and strong private-studio credentials', () => {
  assert.equal(production().host, '0.0.0.0');
  assert.equal(deploymentConfig({}).host, '127.0.0.1');
  assert.equal(deploymentConfig({}).password, '');
  assert.equal(deploymentConfig({ APP_ORIGIN: 'https://studio.example.com/' }).publicOrigin, 'https://studio.example.com');
  for (const env of [
    { NODE_ENV: 'production' },
    { NODE_ENV: 'production', APP_ORIGIN: 'http://studio.example.com', STUDIO_PASSWORD: 'test-password-123456' },
    { NODE_ENV: 'production', APP_ORIGIN: 'https://studio.example.com' },
    { APP_ORIGIN: 'https://studio.example.com/path' },
    { APP_ORIGIN: 'https://studio.example.com?secret=bad' },
    { APP_ORIGIN: 'https://user:password@studio.example.com' },
    { STUDIO_PASSWORD: 'short' },
    { TTS_REQUESTS_PER_MINUTE: '-1' },
    { TTS_REQUESTS_PER_MINUTE: '1.5' },
    { NODE_ENV: 'production', APP_ORIGIN: 'https://studio.example.com', STUDIO_PASSWORD: 'test-password-123456', TTS_REQUESTS_PER_MINUTE: '0' },
  ]) assert.throws(() => deploymentConfig(env));
});

test('access guard checks credentials without accepting malformed or wrong passwords', () => {
  const access = createAccessGuard(production());
  assert.equal(access.authorized(credentials), true);
  for (const value of [undefined, 'Bearer test', 'Basic ###', `Basic ${Buffer.from('studio:wrong-password').toString('base64')}`, 'Basic ' + 'A'.repeat(2000)]) assert.equal(access.authorized(value), false);
});

test('health endpoint is public but UI, configuration, catalog, and generation require sign-in', async () => {
  await withServer({ deployment: production(), fetchImpl: async () => assert.fail('Unauthenticated request must not reach Fish Audio') }, async (base) => {
    const health = await fetch(`${base}/healthz`);
    assert.deepEqual(await health.json(), { status: 'ok' });
    for (const path of ['/', '/app.js', '/api/status', '/api/voices', '/api/voices/' + 'a'.repeat(32) + '/preview']) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 401); assert.match(response.headers.get('www-authenticate'), /^Basic /);
    }
    assert.equal((await post(base, { Authorization: 'Basic wrong' })).status, 401);
    assert.equal((await fetch(`${base}/`, { headers: { Authorization: credentials } })).status, 200);
  });
});

test('configured HTTPS domain works behind proxy without trusting forwarded headers', async () => {
  let calls = 0;
  await withServer({ deployment: production(), fetchImpl: async () => { calls++; return new Response('audio', { headers: { 'Content-Type': 'audio/mpeg' } }); } }, async (base) => {
    const good = await post(base, { 'X-Forwarded-Proto': 'https' });
    assert.equal(good.status, 200); await good.arrayBuffer();
    for (const Origin of ['http://studio.example.com', 'https://evil.test', 'null', 'https://studio.example.com.evil.test']) {
      assert.equal((await post(base, { Origin, 'X-Forwarded-Host': 'studio.example.com', 'X-Forwarded-Proto': 'https' })).status, 403);
    }
  });
  assert.equal(calls, 1);
});

test('absent-Origin browser requests with cross-site metadata are rejected', () => {
  const access = createAccessGuard(production());
  assert.equal(access.allowedOrigin({ headers: { 'sec-fetch-site': 'cross-site' } }), false);
  assert.equal(access.allowedOrigin({ headers: { 'sec-fetch-site': 'same-site' } }), false);
  assert.equal(access.allowedOrigin({ headers: {} }), true);
});

test('production synthesis limit rejects extra requests before provider access', async () => {
  let calls = 0;
  await withServer({ deployment: production(), fetchImpl: async () => { calls++; return new Response('audio', { headers: { 'Content-Type': 'audio/mpeg' } }); } }, async (base) => {
    for (let i = 0; i < 2; i++) { const response = await post(base); assert.equal(response.status, 200); await response.arrayBuffer(); }
    const limited = await post(base); assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '60');
  });
  assert.equal(calls, 2);
});
