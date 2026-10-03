import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { createVoiceApi } from './voices.mjs';
import { deploymentConfig, createAccessGuard } from './deployment.mjs';

try {
  loadEnvFile(fileURLToPath(new URL('.env', import.meta.url)));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

export const FREE_MODEL = 's2.1-pro-free';
const MAX_TEXT = 3000;
const MAX_BODY = 24_000;
const assets = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['public/styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['public/app.js', 'text/javascript; charset=utf-8']],
  ['/storage.js', ['public/storage.js', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['public/favicon.svg', 'image/svg+xml']],
]);

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function readJson(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) {
    throw httpError(415, 'Send the request as application/json.');
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw httpError(413, 'This request is too large. Try a shorter script.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw httpError(400, 'The request must contain valid JSON.');
  }
}

export function validateSpeech(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw httpError(400, 'Enter a script to generate speech.');
  }
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!text || text.length > MAX_TEXT) {
    throw httpError(400, `Enter between 1 and ${MAX_TEXT.toLocaleString('en-US')} characters.`);
  }
  const referenceId = input.referenceId ?? '';
  if (typeof referenceId !== 'string' || (referenceId.trim() && !/^[a-f0-9]{32}$/i.test(referenceId.trim()))) {
    throw httpError(400, 'Use the 32-character voice ID from a Fish Audio voice page.');
  }
  const speed = input.speed ?? 1;
  if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0.5 || speed > 1.5) {
    throw httpError(400, 'Speed must be between 0.5 and 1.5.');
  }
  return {
    text,
    format: 'mp3',
    mp3_bitrate: 128,
    latency: 'normal',
    prosody: { speed, volume: 0 },
    ...(referenceId.trim() ? { reference_id: referenceId.trim() } : {}),
  };
}

const providerErrors = {
  400: 'Fish Audio rejected the request. Check the voice ID and script.',
  401: 'Fish Audio rejected your API key. Check FISH_API_KEY in .env, then restart the server.',
  402: 'Fish Audio reports insufficient credits or no access to this tier. Check your account’s API access.',
  403: 'This API key does not have access. Check your Fish Audio account permissions.',
  404: 'Fish Audio could not find that voice or endpoint. Check the voice ID.',
  422: 'Fish Audio could not process these speech settings. Check the script and voice ID.',
  429: 'Fish Audio is rate limiting requests. Wait a moment and try again.',
};

export function createApp({ apiKey = process.env.FISH_API_KEY, model = process.env.FISH_MODEL || FREE_MODEL, fetchImpl = fetch, deployment = deploymentConfig() } = {}) {
  let generating = false;
  const voices = createVoiceApi({ apiKey, fetchImpl });
  const access = createAccessGuard(deployment);
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/healthz') {
        return json(res, 200, { status: 'ok' });
      }
      if (!access.authorized(req.headers.authorization)) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Fish Studio", charset="UTF-8"');
        return json(res, 401, { error: 'Sign in to access this studio.' });
      }
      if (req.method === 'GET' && url.pathname === '/api/status') {
        return json(res, 200, {
          configured: Boolean(apiKey?.trim()),
          model: FREE_MODEL,
          freeModel: model === FREE_MODEL,
          maxCharacters: MAX_TEXT,
        });
      }
      if (req.method === 'GET' && url.pathname === '/api/voices') {
        return json(res, 200, await voices.list(url.searchParams));
      }
      const voiceRoute = url.pathname.match(/^\/api\/voices\/([a-f0-9]{32})(\/preview)?$/i);
      if (req.method === 'GET' && voiceRoute) {
        if (voiceRoute[2]) {
          const preview = await voices.preview(voiceRoute[1]);
          res.writeHead(200, { 'Content-Type': preview.type, 'Content-Length': preview.data.length });
          return res.end(preview.data);
        }
        return json(res, 200, await voices.get(voiceRoute[1]));
      }
      if (req.method === 'POST' && url.pathname === '/api/tts') {
        if (!access.allowedOrigin(req)) throw httpError(403, 'Open the studio at its configured domain to generate speech.');
        const body = validateSpeech(await readJson(req));
        if (!apiKey?.trim()) throw httpError(503, 'Add FISH_API_KEY to .env, then restart the server.');
        if (model !== FREE_MODEL) {
          throw httpError(409, `Set FISH_MODEL=${FREE_MODEL} in .env and restart. This prototype only uses the free model.`);
        }
        if (generating) throw httpError(429, 'A generation is already running. Wait for it to finish.');
        if (!access.allowGeneration()) {
          res.setHeader('Retry-After', '60');
          throw httpError(429, 'Studio request limit reached. Wait a minute and retry.');
        }
        generating = true;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 120_000);
        const onClose = () => { if (!res.writableEnded) controller.abort(); };
        res.on('close', onClose);
        const started = performance.now();
        try {
          const upstream = await fetchImpl('https://api.fish.audio/v1/tts', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey.trim()}`,
              'Content-Type': 'application/json',
              model: FREE_MODEL,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          if (!upstream.ok) {
            // Keep provider response bodies out of logs and the browser: they can echo credentials.
            await upstream.body?.cancel();
            const status = upstream.status >= 500 ? 502 : upstream.status;
            throw httpError(status, providerErrors[upstream.status] || `Fish Audio returned HTTP ${upstream.status}. Try again later.`);
          }
          const type = upstream.headers.get('content-type') || '';
          if (!type.startsWith('audio/') && !type.startsWith('application/octet-stream')) {
            await upstream.body?.cancel();
            throw httpError(502, 'Fish Audio returned an unexpected response instead of audio.');
          }
          const audio = Buffer.from(await upstream.arrayBuffer());
          if (!audio.length) throw httpError(502, 'Fish Audio returned empty audio. Try again.');
          const elapsed = Math.round(performance.now() - started);
          res.writeHead(200, {
            'Content-Type': 'audio/mpeg',
            'Content-Length': audio.length,
            'Content-Disposition': 'attachment; filename="fish-audio.mp3"',
            'X-Generation-Ms': elapsed,
            'X-Fish-Model': FREE_MODEL,
            'X-Fish-Voice-Id': body.reference_id || '',
          });
          res.end(audio);
          console.log(`Speech generated: ${body.text.length} characters, ${audio.length} bytes, ${elapsed}ms.`);
        } catch (error) {
          if (controller.signal.aborted) throw httpError(504, 'Generation timed out or was cancelled. The free tier can be busy; try a shorter script.');
          if (error.status) throw error;
          throw httpError(502, 'Could not reach Fish Audio. Check your internet connection and try again.');
        } finally {
          clearTimeout(timer);
          res.off('close', onClose);
          generating = false;
        }
        return;
      }
      if (req.method === 'GET' && assets.has(url.pathname)) {
        const [file, type] = assets.get(url.pathname);
        const data = await readFile(new URL(file, import.meta.url));
        res.writeHead(200, { 'Content-Type': type });
        return res.end(data);
      }
      json(res, 404, { error: 'Not found.' });
    } catch (error) {
      if (!res.destroyed && !res.writableEnded) json(res, error.status || 500, { error: error.status ? error.message : 'The local server encountered an error.' });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.PORT || 5173);
  const deployment = deploymentConfig();
  if (deployment.production && !process.env.FISH_API_KEY?.trim()) throw new Error('Set FISH_API_KEY in the deployment environment.');
  if (deployment.production && (process.env.FISH_MODEL || FREE_MODEL) !== FREE_MODEL) throw new Error(`Production requires FISH_MODEL=${FREE_MODEL}.`);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  const server = createApp({ deployment });
  server.on('error', (error) => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Set PORT in .env to another port.` : `Server could not start: ${error.code}`);
    process.exitCode = 1;
  });
  server.listen(port, deployment.host, () => console.log(`Fish Studio: ${deployment.publicOrigin || `http://${deployment.host}:${port}`}`));
  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 125_000).unref();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
