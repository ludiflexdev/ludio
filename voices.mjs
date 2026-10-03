const VOICE_ID = /^[a-f0-9]{32}$/i;
const API = 'https://api.fish.audio';
const PREVIEW_HOST = 'platform.r2.fish.audio';
// Detail responses use signed objects in Fish Audio's specific Cloudflare R2 account.
const SIGNED_PREVIEW_HOST = 'c97f3361a1c971323738e24f451a0225.r2.cloudflarestorage.com';

const fail = (status, message) => Object.assign(new Error(message), { status });

export function normalizeVoice(value) {
  if (!value || !VOICE_ID.test(value._id || '') || value.type !== 'tts' || value.state !== 'trained' || value.dmca_taken_down || value.pvc_release_state === 'retiring') return null;
  const strings = (items) => Array.isArray(items) ? items.filter((v) => typeof v === 'string').slice(0, 20).map((v) => v.slice(0, 80)) : [];
  const sample = value.samples?.find((sample) => safePreviewUrl(sample?.audio));
  return {
    id: value._id.toLowerCase(),
    name: typeof value.title === 'string' ? value.title.slice(0, 150) : 'Untitled voice',
    description: typeof value.description === 'string' ? value.description.slice(0, 400) : '',
    languages: strings(value.languages),
    tags: strings(value.tags),
    author: typeof value.author?.nickname === 'string' ? value.author.nickname.slice(0, 100) : '',
    licensed: value.licensed === true,
    preview: sample ? `/api/voices/${value._id.toLowerCase()}/preview` : null,
  };
}

export function safePreviewUrl(value) {
  try {
    const url = new URL(value);
    const allowedHost = url.hostname === PREVIEW_HOST || (url.hostname === SIGNED_PREVIEW_HOST && url.pathname.startsWith('/fish-platform-data/tasks/'));
    return url.protocol === 'https:' && allowedHost && !url.username && !url.password && !url.port ? url.href : null;
  } catch { return null; }
}

export function catalogQuery(search) {
  const source = search.get('source') || 'licensed';
  if (!['licensed', 'community', 'mine'].includes(source)) throw fail(400, 'Choose a valid voice source.');
  const page = Number(search.get('page') || 1);
  if (!Number.isInteger(page) || page < 1 || page > 100) throw fail(400, 'Page must be between 1 and 100.');
  const query = (search.get('q') || '').trim();
  const language = search.get('language') || '';
  if (query.length > 100 || (language && !/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(language))) throw fail(400, 'Use a shorter search or a valid language.');
  const params = new URLSearchParams({ page_size: '12', page_number: String(page), sort_by: 'score' });
  if (query) params.set('title', query);
  if (language) params.set('language', language);
  if (source === 'licensed') params.set('licensed', 'true');
  if (source === 'mine') params.set('self', 'true');
  return { params, page };
}

export function createVoiceApi({ apiKey, fetchImpl }) {
  const cache = new Map();
  async function entity(path) {
    if (!apiKey?.trim()) throw fail(503, 'API key missing. Add FISH_API_KEY to .env and restart.');
    const hit = cache.get(path);
    if (hit && hit.expires > Date.now()) return hit.value;
    let response;
    try {
      response = await fetchImpl(`${API}${path}`, {
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
        signal: AbortSignal.timeout(20_000),
        redirect: 'error',
      });
    } catch { throw fail(502, 'Voice library is unavailable. Check your connection and retry.'); }
    if (!response.ok) {
      await response.body?.cancel();
      const messages = { 401: 'Your Fish Audio API key was rejected.', 403: 'This voice is not accessible to your account.', 404: 'Voice not found. Check the ID.', 429: 'Voice library is busy. Wait a moment and retry.' };
      throw fail(response.status >= 500 ? 502 : response.status, messages[response.status] || 'Could not load voices from Fish Audio.');
    }
    let value;
    try { value = await response.json(); } catch { throw fail(502, 'Fish Audio returned an invalid voice response.'); }
    if (cache.size >= 100) cache.delete(cache.keys().next().value);
    cache.set(path, { value, expires: Date.now() + 60_000 });
    return value;
  }
  async function detail(id) {
    if (!VOICE_ID.test(id)) throw fail(400, 'Use a 32-character Fish Audio voice ID.');
    const raw = await entity(`/model/${id.toLowerCase()}`);
    const voice = normalizeVoice(raw);
    if (!voice) throw fail(409, 'This voice is not currently available for speech generation.');
    return { voice, raw };
  }
  return {
    async list(search) {
      const { params, page } = catalogQuery(search);
      const result = await entity(`/model?${params}`);
      if (!Array.isArray(result.items)) throw fail(502, 'Fish Audio returned an invalid voice catalog.');
      return {
        items: result.items.map(normalizeVoice).filter(Boolean),
        total: Number.isFinite(result.total) ? result.total : result.items.length,
        hasMore: typeof result.has_more === 'boolean' ? result.has_more : page * 12 < result.total,
        page,
      };
    },
    async get(id) { return (await detail(id)).voice; },
    async preview(id) {
      const { raw } = await detail(id);
      const url = raw.samples?.map((sample) => safePreviewUrl(sample?.audio)).find(Boolean);
      if (!url) throw fail(404, 'No preview is available for this voice.');
      let response;
      try { response = await fetchImpl(url, { signal: AbortSignal.timeout(20_000), redirect: 'error' }); }
      catch { throw fail(502, 'Could not load this voice preview.'); }
      if (!response.ok) { await response.body?.cancel(); throw fail(502, 'This voice preview is unavailable.'); }
      const type = response.headers.get('content-type') || '';
      if (!type.startsWith('audio/') && !type.startsWith('application/octet-stream')) { await response.body?.cancel(); throw fail(502, 'Invalid voice preview.'); }
      if (Number(response.headers.get('content-length')) > 8_000_000) { await response.body?.cancel(); throw fail(502, 'Voice preview is too large.'); }
      const reader = response.body?.getReader();
      if (!reader) throw fail(502, 'Voice preview is empty.');
      let size = 0;
      const chunks = [];
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 8_000_000) { await reader.cancel(); throw fail(502, 'Voice preview is too large.'); }
          chunks.push(Buffer.from(value));
        }
      } catch (error) { if (error.status) throw error; throw fail(502, 'Could not finish loading the voice preview.'); }
      if (!size) throw fail(502, 'Voice preview is empty.');
      return { data: Buffer.concat(chunks), type: type.startsWith('audio/') ? type : 'audio/mpeg' };
    },
  };
}
