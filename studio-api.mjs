import { normalizeVoice } from './voices.mjs';

const API = 'https://api.fish.audio';
const ID = /^[a-f0-9]{32}$/i;
export const UPLOAD_LIMIT = 30 * 1024 * 1024;
const fail = (status, message) => Object.assign(new Error(message), { status });
function text(value, name, max, required = false) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw fail(400, `Enter a valid ${name} (up to ${max} characters).`);
  return value.trim();
}
function audioFile(value) {
  if (!value || typeof value.arrayBuffer !== 'function' || !value.size || value.size > UPLOAD_LIMIT || !/\.(wav|mp3|flac|m4a|ogg|opus|aac|webm|mp4)$/i.test(value.name)) throw fail(400, 'Choose a supported audio file, up to 30 MB.');
  return value;
}
export async function readMultipart(req) {
  const type = req.headers['content-type'] || '';
  if (!type.startsWith('multipart/form-data;')) throw fail(415, 'Upload files as multipart form data.');
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > UPLOAD_LIMIT) throw fail(413, 'Upload limit is 30 MB in total.'); chunks.push(chunk); }
  try { return await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': type } }).formData(); }
  catch { throw fail(400, 'The upload could not be read. Choose the files again.'); }
}
export function cloneForm(input) {
  const files = input.getAll('voices');
  if (!files.length || files.length > 20) throw fail(400, 'Choose between 1 and 20 voice samples.');
  const out = new FormData();
  out.set('type', 'tts'); out.set('train_mode', 'fast'); out.set('visibility', 'private');
  out.set('title', text(input.get('title'), 'voice name', 100, true));
  out.set('description', text(input.get('description'), 'description', 1000));
  files.forEach((file) => out.append('voices', audioFile(file), file.name));
  const transcripts = input.getAll('texts');
  if (transcripts.length && transcripts.length !== files.length) throw fail(400, 'Supply one transcript per sample, or leave all transcripts empty.');
  transcripts.forEach((line) => out.append('texts', text(line, 'sample transcript', 10000, true)));
  out.set('enhance_audio_quality', input.get('enhance_audio_quality') === 'false' ? 'false' : 'true');
  out.set('generate_sample', 'false');
  return out;
}
export function createStudioApi({ apiKey, fetchImpl = fetch }) {
  async function request(path, options = {}) {
    if (!apiKey?.trim()) throw fail(503, 'Add FISH_API_KEY to .env and restart the studio.');
    let response;
    try { response = await fetchImpl(`${API}${path}`, { ...options, headers: { Authorization: `Bearer ${apiKey.trim()}`, ...options.headers }, signal: options.signal || AbortSignal.timeout(300000), redirect: 'error' }); }
    catch (error) { throw fail(error.name === 'TimeoutError' ? 504 : 502, 'Fish Audio could not complete this request. Try again.'); }
    if (!response.ok) {
      await response.body?.cancel();
      const messages = { 400: 'Fish Audio rejected these settings or audio samples.', 401: 'Your Fish Audio API key was rejected.', 402: 'This feature needs API credits. Check your Fish Audio balance.', 403: 'Your account cannot access or modify this resource.', 404: 'This voice or feature was not found.', 413: 'Fish Audio rejected the upload size.', 422: 'Fish Audio could not process this audio or these settings.', 429: 'Fish Audio is busy. Wait a moment and retry.' };
      throw fail(response.status >= 500 ? 502 : response.status, messages[response.status] || 'Fish Audio could not complete this request.');
    }
    if (response.status === 204) return {};
    const chunks = []; let size = 0;
    if (response.body) for await (const chunk of response.body) { size += chunk.length; if (size > 30 * 1024 * 1024) { await response.body.cancel().catch(() => {}); throw fail(502, 'The provider response is too large.'); } chunks.push(Buffer.from(chunk)); }
    if (!size) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw fail(502, 'Fish Audio returned an invalid response.'); }
  }
  function voiceResult(raw) {
    const normalized = normalizeVoice(raw, { includePending: true });
    if (!normalized) throw fail(502, 'Fish Audio returned an invalid voice.');
    return normalized;
  }
  return {
    async clone(form) { return voiceResult(await request('/model', { method: 'POST', body: cloneForm(form) })); },
    async update(id, input) {
      if (!ID.test(id)) throw fail(400, 'Invalid voice ID.');
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail(400, 'Enter valid voice details.');
      const body = new FormData(); body.set('title', text(input.title, 'voice name', 100, true)); body.set('description', text(input.description, 'description', 1000));
      if (input.tags !== undefined) { if (!Array.isArray(input.tags) || input.tags.length > 20) throw fail(400, 'Use up to 20 tags.'); input.tags.forEach((tag) => body.append('tags', text(tag, 'tag', 80, true))); }
      await request(`/model/${id}`, { method: 'PATCH', body });
      return voiceResult(await request(`/model/${id}`));
    },
    async remove(id) { if (!ID.test(id)) throw fail(400, 'Invalid voice ID.'); await request(`/model/${id}`, { method: 'DELETE' }); return { deleted: true }; },

  };
}
