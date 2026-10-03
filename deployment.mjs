import { createHash, timingSafeEqual } from 'node:crypto';

export function deploymentConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  let publicOrigin = null;
  if (env.APP_ORIGIN?.trim()) {
    let url;
    try { url = new URL(env.APP_ORIGIN.trim()); } catch { throw new Error('APP_ORIGIN must be a valid origin, e.g. https://studio.example.com.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || (production && url.protocol !== 'https:')) {
      throw new Error('APP_ORIGIN must contain only the scheme and hostname; production requires HTTPS.');
    }
    publicOrigin = url.origin;
  }
  if (production && !publicOrigin) throw new Error('Set APP_ORIGIN to your HTTPS studio domain before starting in production.');
  const username = env.STUDIO_USERNAME || 'studio';
  const password = env.STUDIO_PASSWORD || '';
  if ((production || password) && (password.length < 16 || password.length > 128 || !username || username.includes(':') || username.length > 100)) {
    throw new Error('Set STUDIO_PASSWORD to 16–128 characters and STUDIO_USERNAME to a username without a colon.');
  }
  const perMinute = Number(env.TTS_REQUESTS_PER_MINUTE ?? (production ? 10 : 0));
  if (!Number.isInteger(perMinute) || perMinute < (production ? 1 : 0) || perMinute > 120) throw new Error('TTS_REQUESTS_PER_MINUTE must be an integer from 1 to 120 in production (0 disables it locally).');
  return { production, publicOrigin, username, password, perMinute, host: env.HOST || (production ? '0.0.0.0' : '127.0.0.1') };
}

export function createAccessGuard(config) {
  const hash = (value) => createHash('sha256').update(value).digest();
  const expected = config.password ? hash(`${config.username}:${config.password}`) : null;
  let windowStarted = Date.now();
  let requests = 0;
  return {
    authorized(header) {
      if (!expected) return true;
      if (typeof header !== 'string' || header.length > 1024 || !/^Basic [A-Za-z0-9+/]+={0,2}$/i.test(header)) return false;
      const credentials = Buffer.from(header.slice(6), 'base64').toString('utf8');
      return timingSafeEqual(hash(credentials), expected);
    },
    allowedOrigin(req) {
      const origin = req.headers.origin;
      if (origin) return origin === (config.publicOrigin || `http://${req.headers.host}`);
      // Browsers always supply Origin for fetch POSTs. Same-site metadata also
      // protects absent-Origin browser requests; authenticated CLI clients remain usable.
      return !['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']);
    },
    allowGeneration() {
      if (!config.perMinute) return true;
      if (Date.now() - windowStarted >= 60_000) { requests = 0; windowStarted = Date.now(); }
      if (requests >= config.perMinute) return false;
      requests++;
      return true;
    },
  };
}
