import { loadRecordings, saveRecording, removeRecording, readPreferences, savePreferences } from './storage.js';
import { emotionGroups, insertCue } from './emotions.js';
import { pcmToWav } from './audio.js';
import { toSrt } from './subtitles.js';

const $ = (id) => document.getElementById(id);
const voiceIdPattern = /^[a-f0-9]{32}$/i;
const iconPaths = {
  wave: ['M3 10v4M7 6v12M11 3v18M15 7v10M19 5v14M23 10v4'],
  voices: ['M8 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8M1 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2M16 5a4 4 0 0 1 0 8M19 21v-2a5 5 0 0 0-3-4.6'],
  folder: ['M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z'],
  plus: ['M12 5v14M5 12h14'],
  text: ['M4 5h16M12 5v15M8 20h8'],
  clock: ['M12 8v5l3 2', 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0'],
  sparkles: ['m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z', 'M20 2v4M18 4h4'],
  sliders: ['M4 4v5M4 15v5M12 4v9M12 19v1M20 4v1M20 11v9M1 9h6v6H1ZM9 13h6v6H9ZM17 5h6v6h-6Z'],
  play: ['m8 4 12 8-12 8Z'],
  pause: ['M8 5v14M16 5v14'],
  lock: ['M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5ZM12 15v2'],
  external: ['M14 3h7v7M21 3 10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5'],
  refresh: ['M20 7a9 9 0 1 0 1 9M20 2v5h-5'],
  search: ['M21 21 16 16', 'M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0'],
  download: ['M12 3v12m-5-5 5 5 5-5M3 16v5h18v-5'],
  reuse: ['M3 8h12a6 6 0 0 1 0 12H9M3 8l5-5M3 8l5 5'],
  star: ['m12 2 3 6 7 .9-5 5 1.2 7.1L12 17.7l-6.2 3.3L7 13.9l-5-5L9 8Z'],
  close: ['m6 6 12 12M18 6 6 18'],
  device: ['M2 4h20v14H2ZM8 22h8M12 18v4'],
  trash: ['M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7'],
};
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
  for (const d of iconPaths[name] || iconPaths.wave) { const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', d); svg.append(path); }
  return svg;
}
document.querySelectorAll('[data-icon]').forEach((target) => target.append(icon(target.dataset.icon)));
function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function button(label, className, iconName, action) {
  const node = el('button', className); node.type = 'button';
  if (iconName) node.append(icon(iconName)); node.append(el('span', '', label)); node.addEventListener('click', action); return node;
}
function iconButton(label, iconName, action) { const node = el('button', 'icon-button'); node.type = 'button'; node.setAttribute('aria-label', label); node.title = label; node.append(icon(iconName)); node.addEventListener('click', action); return node; }
const preferences = readPreferences();
let selectedVoice = voiceIdPattern.test(preferences.voice?.id || '') ? preferences.voice : null;
let dialogueVoices = Array.isArray(preferences.dialogueVoices) ? preferences.dialogueVoices.filter((voice) => voiceIdPattern.test(voice?.id || '')).slice(0, 7) : [];
let speakerTarget = null;
let favorites = Array.isArray(preferences.favorites) ? preferences.favorites.filter((v) => voiceIdPattern.test(v?.id || '')).slice(0, 100) : [];
let recordings = [];
let currentRecording;
let configured = false;
let storageReady = false;
let busy = false;
let activePage;
let catalog = [];
let source = 'licensed';
let page = 1;
let hasMore = false;
let catalogLoaded = false;
let catalogRequest;
let catalogSequence = 0;
let searchTimer;
let toastTimer;
let previewId;
let previewLoading;
let previewRequest;
let previewSequence = 0;
let previewUrl;
const audioUrls = new Map();
const languageNames = { en: 'English', fr: 'French', es: 'Spanish', pt: 'Portuguese', de: 'German', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', ar: 'Arabic', hi: 'Hindi', it: 'Italian', ru: 'Russian' };
const tones = ['mint', 'violet', 'peach', 'blue', 'rose', 'olive'];
const voiceLanguages = (voice) => (voice.languages || []).map((v) => languageNames[v] || v).join(', ') || 'Language unspecified';
function avatar(voice) { const node = el('div', 'avatar', (voice.name || '?').split(/\s+/).slice(0, 2).map((v) => Array.from(v)[0]).join('').toUpperCase()); node.dataset.tone = tones[parseInt(voice.id.slice(0, 4), 16) % tones.length]; return node; }
function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000); }
function message(id, text, error = false) { const node = $(id); node.textContent = text; node.hidden = !text; node.classList.toggle('error', error); }
function persist() {
  const saved = savePreferences({ voice: selectedVoice, favorites, dialogueVoices, settings: readSpeechSettings(), draft: { title: $('recording-title').value, text: $('script').value, speed: Number($('speed').value) } });
  $('draft-status').textContent = saved ? 'Draft saved' : 'Not saved';
}
function updateCounts() { $('favorite-count').textContent = favorites.length; $('saved-tab-count').textContent = favorites.length; $('recording-count').textContent = recordings.length; $('recent-count').textContent = recordings.length; }
function updateEditor() {
  $('char-count').textContent = `${$('script').value.length.toLocaleString()} / 3,000 characters`;
  const words = $('script').value.trim().split(/\s+/).filter(Boolean).length;
  $('duration-estimate').textContent = `~${Math.ceil(words / (2.5 * Number($('speed').value)))}s`;
  $('speed-value').textContent = `${Number($('speed').value).toFixed(1)}×`;
  $('generate').disabled = busy || !storageReady || !configured || !selectedVoice || !$('script').value.trim() || ($('dialogue-mode').checked && (!dialogueVoices.length || dialogueVoices.some((voice) => voice.state && voice.state !== 'trained')));
  $('generate').title = !selectedVoice ? 'Select a voice from the library first' : $('dialogue-mode').checked && !dialogueVoices.length ? 'Add another speaker for dialogue' : '';
}
function renderSelectedVoice() {
  if (selectedVoice) {
    const details = el('div'); details.append(el('strong', '', selectedVoice.name), el('p', '', voiceLanguages(selectedVoice)));
    $('selected-voice').replaceChildren(avatar(selectedVoice), details);
    $('selected-voice').title = `Voice ID: ${selectedVoice.id}`;
    $('selected-voice').setAttribute('aria-label', `Change voice: ${selectedVoice.name}`);
    $('selected-voice').classList.remove('empty');
  } else {
    const details = el('div'); details.append(el('strong', '', 'Choose a voice'), el('p', '', 'Voice library'));
    const empty = el('div', 'avatar'); empty.append(icon('voices')); $('selected-voice').replaceChildren(empty, details);
    $('selected-voice').classList.add('empty'); $('selected-voice').setAttribute('aria-label', 'Choose a voice'); $('selected-voice').removeAttribute('title');
  }
  $('preview-selected').disabled = !selectedVoice?.preview;
  renderSpeakers(); updatePreviewButtons(); updateEditor();
}
function chooseVoice(voice) {
  if (voice.state && voice.state !== 'trained') return toast('This voice is not ready yet. Refresh My voices after training.');
  if (speakerTarget !== null) { dialogueVoices[speakerTarget] = structuredClone(voice); speakerTarget = null; }
  else selectedVoice = structuredClone(voice);
  renderSelectedVoice(); persist(); renderCatalog();
  location.hash = 'create'; toast(`Voice selected: ${voice.name}`);
}
function emptyState(title, description, iconName, actionLabel, action) {
  const node = el('div', 'empty-state'); const symbol = el('span'); symbol.append(icon(iconName)); node.append(symbol, el('h3', '', title), el('p', '', description));
  if (actionLabel) node.append(button(actionLabel, 'secondary small', null, action)); return node;
}
function switchPage() {
  const next = ['create', 'voices', 'recordings'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'create';
  document.querySelectorAll('.page').forEach((node) => { node.hidden = node.id !== `page-${next}`; });
  document.querySelectorAll('[data-page]').forEach((node) => { node.classList.toggle('active', node.dataset.page === next); if (node.dataset.page === next) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current'); });
  $('breadcrumb-page').textContent = { create: 'Text to speech', voices: 'Voice library', recordings: 'Recordings' }[next];
  document.title = `${$('breadcrumb-page').textContent} · Studio`;
  if (next !== 'voices') speakerTarget = null;
  if (activePage && next !== activePage) { document.querySelectorAll('audio').forEach((audio) => audio.pause()); window.scrollTo({ top: 0 }); }
  activePage = next;
  if (next === 'voices' && !catalogLoaded) loadCatalog();
}
async function getJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (HTTP ${response.status}).`);
  return data;
}
async function checkConnection() {
  try {
    const status = await getJson('/api/status'); configured = status.configured && status.freeModel;
    if (!configured) message('generation-message', !status.configured ? 'Add FISH_API_KEY to .env and restart the studio.' : 'Set FISH_MODEL=s2.1-pro-free in .env and restart the studio.', true);
    else if (!busy) message('generation-message', '');
  } catch { configured = false; message('generation-message', 'Local server unavailable. Run npm start and refresh.', true); }
  updateEditor();
}
function toggleFavorite(voice) {
  const saved = favorites.some((v) => v.id === voice.id);
  if (!saved && favorites.length >= 100) return toast('Saved voice limit reached (100). Unsave a voice to add another.');
  favorites = saved ? favorites.filter((v) => v.id !== voice.id) : [...favorites, structuredClone(voice)];
  persist(); updateCounts(); renderCatalog(); toast(saved ? 'Voice removed from saved voices' : 'Voice saved');
}
function renderCatalog() {
  let voices = catalog;
  if (source === 'saved') {
    const q = $('voice-search').value.trim().toLowerCase(); const lang = $('voice-language').value;
    voices = favorites.filter((v) => (!q || v.name.toLowerCase().includes(q)) && (!lang || v.languages.includes(lang)));
    $('catalog-summary').textContent = `${voices.length} saved voice${voices.length === 1 ? '' : 's'}`; hasMore = false;
  }
  const cards = voices.map((voice) => {
    const card = el('article', `voice-card${selectedVoice?.id === voice.id ? ' selected' : ''}`);
    const top = el('div', 'voice-card-top');
    const star = iconButton(`Save ${voice.name}`, 'star', () => toggleFavorite(voice)); star.classList.add('save-voice'); const saved = favorites.some((v) => v.id === voice.id); star.classList.toggle('active', saved); star.setAttribute('aria-pressed', saved); top.append(avatar(voice), star);
    const title = el('h3', '', voice.name); title.title = voice.name;
    const tags = el('div', 'tags'); const styles = voice.tags.filter((tag) => !['male', 'female', 'young', 'middle-aged'].includes(tag)); for (const tag of styles.slice(0, 3)) tags.append(el('span', 'tag', tag.replaceAll('-', ' ')));
    const actions = el('div', 'voice-card-actions');
    const preview = button('Preview', 'secondary preview-button', 'play', () => playPreview(voice)); preview.dataset.voice = voice.id; preview.disabled = !voice.preview; preview.title = voice.preview ? 'Play existing voice sample' : 'No preview sample available';
    const use = button(selectedVoice?.id === voice.id ? 'Selected' : 'Use voice', 'secondary use-voice', null, () => chooseVoice(voice)); use.setAttribute('aria-label', `Use ${voice.name}`);
    use.disabled = Boolean(voice.state && voice.state !== 'trained');
    actions.append(preview, use); card.append(top, title, el('p', 'voice-subtitle', `${voiceLanguages(voice)}${voice.author ? ` · ${voice.author}` : ''}`), tags, actions);
    if (source === 'mine') {
      const management = el('div', 'voice-management'); management.append(el('span', 'subtle', voice.state || 'trained'), iconButton(`Edit ${voice.name}`, 'sliders', () => editVoice(voice)), iconButton(`Delete ${voice.name}`, 'trash', () => deleteVoice(voice))); card.append(management);
    }
    return card;
  });
  $('voice-grid').replaceChildren(...cards);
  if (!cards.length) $('voice-grid').append(emptyState(source === 'saved' ? 'No saved voices here' : 'No voices found', source === 'saved' ? 'Save a voice with the star, or change your filters.' : 'Try another search, language, or voice source.', 'voices'));
  $('load-more').hidden = !hasMore || source === 'saved'; updatePreviewButtons();
}
async function loadCatalog(append = false, refresh = false) {
  clearTimeout(searchTimer); catalogRequest?.abort(); const sequence = ++catalogSequence;
  catalogRequest = new AbortController();
  if (!append) { page = 1; catalog = []; }
  message('catalog-message', ''); $('load-more').disabled = true;
  if (source === 'saved') { catalogLoaded = true; renderCatalog(); return; }
  $('catalog-summary').textContent = 'Loading voices…';
  if (!append) $('voice-grid').replaceChildren(emptyState('Loading voice library', 'Fetching voices from Fish Audio.', 'voices'));
  const params = new URLSearchParams({ source, q: $('voice-search').value.trim(), language: $('voice-language').value, page: String(append ? page + 1 : 1) });
  if (refresh) params.set('refresh', '1');
  try {
    const data = await getJson(`/api/voices?${params}`, { signal: AbortSignal.any([catalogRequest.signal, AbortSignal.timeout(25000)]) });
    if (sequence !== catalogSequence) return;
    if (append) page++; catalog = append ? [...catalog, ...data.items.filter((v) => !catalog.some((old) => old.id === v.id))] : data.items;
    hasMore = data.hasMore; catalogLoaded = true;
    $('catalog-summary').textContent = `${catalog.length} of ${data.total.toLocaleString()} voices`;
    renderCatalog();
  } catch (error) {
    if (sequence !== catalogSequence || error.name === 'AbortError') return;
    catalogLoaded = false; $('catalog-summary').textContent = 'Voice library unavailable'; message('catalog-message', error.name === 'TimeoutError' ? 'Loading voices timed out. Retry in a moment.' : error.message, true);
    $('catalog-message').append(button('Retry', 'secondary small', 'refresh', () => loadCatalog(append)));
    if (!append) $('voice-grid').replaceChildren();
  } finally { if (sequence === catalogSequence) $('load-more').disabled = false; }
}
function updatePreviewButtons() {
  for (const node of document.querySelectorAll('.preview-button')) {
    const loading = previewLoading === node.dataset.voice; const playing = previewId === node.dataset.voice && !$('voice-preview').paused;
    node.replaceChildren(icon(playing ? 'pause' : 'play'), el('span', '', loading ? 'Loading…' : playing ? 'Stop preview' : 'Preview')); node.classList.toggle('active', playing);
  }
  const playing = selectedVoice?.id === previewId && !$('voice-preview').paused;
  $('preview-selected').replaceChildren(icon(playing ? 'pause' : 'play'), el('span', '', previewLoading === selectedVoice?.id && selectedVoice ? 'Loading…' : playing ? 'Stop preview' : 'Preview voice'));
}
async function playPreview(voice) {
  if (!voice.preview) return toast('No preview available for this voice.');
  if (previewId === voice.id && !$('voice-preview').paused) { $('voice-preview').pause(); updatePreviewButtons(); return; }
  previewRequest?.abort(); const sequence = ++previewSequence; previewRequest = new AbortController(); $('voice-preview').pause();
  previewLoading = voice.id; updatePreviewButtons();
  try {
    const response = await fetch(`/api/voices/${voice.id}/preview`, { signal: AbortSignal.any([previewRequest.signal, AbortSignal.timeout(25000)]) });
    if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || 'Preview unavailable.'); }
    const blob = await response.blob(); if (sequence !== previewSequence) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = URL.createObjectURL(blob); previewId = voice.id; $('voice-preview').src = previewUrl; await $('voice-preview').play();
  } catch (error) { if (sequence === previewSequence && error.name !== 'AbortError') toast(error.name === 'TimeoutError' ? 'Preview timed out. Try again.' : error.message); }
  finally { if (sequence === previewSequence) { previewLoading = null; updatePreviewButtons(); } }
}
function recordingUrl(recording, playback = false) { const key = playback && recording.previewAudio ? `${recording.id}:preview` : recording.id; if (!audioUrls.has(key)) audioUrls.set(key, URL.createObjectURL(playback && recording.previewAudio ? recording.previewAudio : recording.audio)); return audioUrls.get(key); }
function fileName(recording) { const title = recording.title.replace(/[^\p{L}\p{N}\-_ ]/gu, '').trim().slice(0, 70) || 'recording'; return `${title}-${recording.voice.id.slice(0, 8)}.${recording.settings?.format || 'mp3'}`; }
function timestampLinks(recording) {
  if (!recording.timeline?.length) return [];
  return [['srt', 'Subtitles', toSrt(recording.timeline), 'text/plain'], ['json', 'Word timings', JSON.stringify(recording.timeline, null, 2), 'application/json']].map(([extension, label, content, type]) => {
    const key = `${recording.id}:${extension}`;
    if (!audioUrls.has(key)) audioUrls.set(key, URL.createObjectURL(new Blob([content], { type })));
    const link = el('a', 'text-link', label); link.href = audioUrls.get(key); link.download = fileName(recording).replace(/\.[^.]+$/, `.${extension}`); return link;
  });
}
function reuse(recording) { $('recording-title').value = recording.title; $('script').value = recording.text; $('speed').value = recording.speed; selectedVoice = structuredClone(recording.voice); dialogueVoices = structuredClone(recording.dialogueVoices || []); restoreSpeechSettings(recording.settings || {}); renderSelectedVoice(); updateEditor(); persist(); location.hash = 'create'; toast('Script, voices, and settings restored'); }
function showResult(recording) {
  currentRecording = recording; $('current-result').hidden = false; $('result-title').textContent = recording.title;
  $('result-voice').textContent = [recording.voice, ...(recording.dialogueVoices || [])].map((voice) => voice.name).join(' · ');
  $('result-details').textContent = `${(recording.generationMs / 1000).toFixed(1)}s generation · ${(recording.audio.size / 1024).toFixed(0)} KB · ${recording.speed.toFixed(1)}×`;
  $('result-saved').textContent = recording.saved ? 'SAVED' : 'NOT SAVED';
  $('result-identity').textContent = `Voice: ${recording.voice.name} | Voice ID: ${recording.voice.id} | Engine: ${recording.engine}`;
  $('result-timestamps').replaceChildren(...timestampLinks(recording)); $('result-timestamps').hidden = !recording.timeline?.length;
  $('player').src = recordingUrl(recording, true); $('download').href = recordingUrl(recording); $('download').download = fileName(recording);
}
function recordingRow(recording) {
  const row = el('article', 'recording-row'); const main = el('div', 'recording-row-main');
  const audio = el('audio'); audio.controls = true; audio.preload = 'none'; audio.setAttribute('aria-label', `Play ${recording.title}`);
  const detail = el('div', 'recording-expanded'); detail.hidden = true;
  const play = iconButton(`Play ${recording.title}`, 'play', async () => {
    detail.hidden = false;
    if (!audio.src) audio.src = recordingUrl(recording, true);
    if (audio.paused) { try { await audio.play(); } catch { toast('Press play on the audio player to start playback.'); } }
    else audio.pause();
  }); play.className = 'recording-play';
  audio.addEventListener('play', () => play.replaceChildren(icon('pause'))); audio.addEventListener('pause', () => play.replaceChildren(icon('play'))); audio.addEventListener('ended', () => play.replaceChildren(icon('play')));
  const info = el('div', 'recording-row-info'); info.append(el('strong', '', recording.title), el('p', '', `${recording.voice.name} · ${recording.speed.toFixed(1)}×${recording.saved ? '' : ' · Not saved'}`));
  const actions = el('div', 'row-actions'); const download = el('a', 'icon-button'); download.href = recordingUrl(recording); download.download = fileName(recording); download.title = `Download ${recording.title}`; download.setAttribute('aria-label', download.title); download.append(icon('download'));
  actions.append(iconButton(`Reuse ${recording.title}`, 'reuse', () => reuse(recording)), download, iconButton(`Delete ${recording.title}`, 'trash', async () => {
    if (!confirm(`Delete “${recording.title}” from this browser? Download a copy first if you want to keep it.`)) return;
    try {
      if (recording.saved) await removeRecording(recording.id);
      recordings = recordings.filter((r) => r.id !== recording.id);
      if (currentRecording?.id === recording.id) { $('player').pause(); $('player').removeAttribute('src'); $('player').load(); currentRecording = null; $('current-result').hidden = true; }
      renderRecordings();
      for (const key of [recording.id, `${recording.id}:preview`, `${recording.id}:srt`, `${recording.id}:json`]) if (audioUrls.has(key)) { URL.revokeObjectURL(audioUrls.get(key)); audioUrls.delete(key); }
      toast('Recording removed');
    } catch (error) { toast(error.message); }
  }));
  const date = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(recording.createdAt);
  main.append(play, info, el('span', 'recording-date', date), actions);
  detail.append(audio, el('p', '', recording.text), el('p', 'identity-line', `Voice ID: ${recording.voice.id} · Engine: ${recording.engine}`)); const links = el('div', 'timestamp-links'); links.append(...timestampLinks(recording)); detail.append(links); row.append(main, detail); return row;
}
function renderRecordings() {
  document.querySelectorAll('.recordings-list audio').forEach((audio) => audio.pause());
  updateCounts(); const q = $('recording-search').value.toLowerCase().trim();
  const filtered = recordings.filter((r) => `${r.title} ${r.text} ${r.voice.name}`.toLowerCase().includes(q));
  $('recent-recordings').replaceChildren(...recordings.slice(0, 3).map(recordingRow));
  $('all-recordings').replaceChildren(...filtered.map(recordingRow));
  $('history-summary').textContent = `${filtered.length} recording${filtered.length === 1 ? '' : 's'}`;
  if (!recordings.length) $('recent-recordings').append(emptyState('No recordings yet', 'Your generated audio will appear here.', 'wave'));
  if (!filtered.length) $('all-recordings').append(emptyState(recordings.length ? 'No matching recordings' : 'No recordings yet', recordings.length ? 'Try another title or voice name.' : 'Generate a clip to start your audio library.', 'folder', recordings.length ? null : 'Create speech', () => { location.hash = 'create'; }));
}

async function generateSpeech(event) {
  event.preventDefault(); if ($('generate').disabled) return;
  const snapshot = { id: crypto.randomUUID(), createdAt: Date.now(), title: $('recording-title').value.trim() || 'Untitled recording', text: $('script').value.trim(), speed: Number($('speed').value), voice: structuredClone(selectedVoice), dialogueVoices: $('dialogue-mode').checked ? structuredClone(dialogueVoices) : [], settings: readSpeechSettings(), engine: 's2.1-pro-free' };
  busy = true; updateEditor(); $('generate-label').textContent = 'Generating…'; document.querySelectorAll('audio').forEach((audio) => audio.pause());
  const started = performance.now(); message('generation-message', `Generating with ${snapshot.voice.name}…`);
  const timer = setInterval(() => message('generation-message', `Generating with ${snapshot.voice.name} · ${Math.floor((performance.now() - started) / 1000)}s`), 1000);
  try {
    const response = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...snapshot.settings, text: snapshot.text, referenceId: snapshot.voice.id, speed: snapshot.speed }), signal: AbortSignal.timeout(130000) });
    if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || `Generation failed (${response.status}).`); }
    if (response.headers.get('X-Fish-Voice-Id') !== (snapshot.settings.speakers?.join(',') || snapshot.voice.id) || response.headers.get('X-Fish-Model') !== snapshot.engine) throw new Error('Voice metadata did not match the request. Restart the local server and try again.');
    if (snapshot.settings.timestamps) {
      const data = await response.json();
      const bytes = Uint8Array.from(atob(data.audioBase64), (letter) => letter.charCodeAt(0));
      const types = { mp3: 'audio/mpeg', wav: 'audio/wav', opus: 'audio/ogg', pcm: 'application/octet-stream' };
      snapshot.audio = new Blob([bytes], { type: types[snapshot.settings.format] }); snapshot.timeline = data.timeline;
    } else snapshot.audio = await response.blob();
    if (!snapshot.audio.size) throw new Error('Fish Audio returned empty audio.');
    if (snapshot.settings.format === 'pcm') snapshot.previewAudio = pcmToWav(await snapshot.audio.arrayBuffer(), snapshot.settings.sampleRate);
    snapshot.generationMs = Number(response.headers.get('X-Generation-Ms')) || performance.now() - started;
    clearInterval(timer);
    try { await saveRecording(snapshot); snapshot.saved = true; message('generation-message', ''); }
    catch (error) { snapshot.saved = false; message('generation-message', error.message, true); }
    recordings.unshift(snapshot); showResult(snapshot); renderRecordings(); toast(snapshot.saved ? 'Recording saved' : 'Recording ready. Download it to keep a copy.');
  } catch (error) { message('generation-message', error.name === 'TimeoutError' ? 'Generation timed out. Try a shorter script.' : error.message === 'Failed to fetch' ? 'Local server unavailable. Check that npm start is running.' : error.message, true); }
  finally { clearInterval(timer); busy = false; $('generate-label').textContent = 'Generate speech'; updateEditor(); }
}


const numericSettings = {
  volume: ['volume', 0], temperature: ['expressiveness', .7], topP: ['diversity', .7],
  chunkLength: ['chunk-length', 300], minChunkLength: ['min-chunk-length', 50], maxTokens: ['max-tokens', 1024], repetitionPenalty: ['repetition-penalty', 1.2], earlyStop: ['early-stop', 1],
};
const booleanSettings = { normalize: ['normalize-text', true], normalizeLoudness: ['normalize-loudness', true], qualityGuard: ['quality-guard', false], previousChunks: ['previous-chunks', true], timestamps: ['word-timestamps', false] };
let pronunciation = Array.isArray(preferences.settings?.pronunciation) ? preferences.settings.pronunciation.slice(0, 100) : [];
function readSpeechSettings() {
  const format = $('output-format').value;
  const options = { format, sampleRate: Number($('sample-rate').value), latency: $('latency').value, pronunciation: structuredClone(pronunciation) };
  if (format === 'mp3') options.bitrate = Number($('audio-bitrate').value);
  if (format === 'opus') options.opusBitrate = Number($('audio-bitrate').value);
  for (const [key, [id]] of Object.entries(numericSettings)) options[key] = Number($(id).value);
  for (const [key, [id]] of Object.entries(booleanSettings)) options[key] = $(id).checked;
  if ($('dialogue-mode').checked) options.speakers = [selectedVoice?.id, ...dialogueVoices.map((voice) => voice.id)];
  return options;
}
function updateFormatControls(options = {}) {
  const format = $('output-format').value;
  const rates = format === 'opus' ? [48000] : format === 'mp3' ? [32000, 44100] : [8000, 16000, 24000, 32000, 44100];
  const preferred = options.sampleRate ?? Number($('sample-rate').value);
  $('sample-rate').replaceChildren(...rates.map((rate) => { const option = el('option', '', `${rate / 1000} kHz`); option.value = rate; return option; }));
  $('sample-rate').value = String(rates.includes(preferred) ? preferred : rates.at(-1));
  const bitrates = format === 'opus' ? [-1000, 24000, 32000, 48000, 64000] : [64, 128, 192];
  const preferredBitrate = format === 'opus' ? options.opusBitrate ?? -1000 : options.bitrate ?? 128;
  $('audio-bitrate').replaceChildren(...bitrates.map((rate) => { const option = el('option', '', rate === -1000 ? 'Auto' : `${format === 'opus' ? rate / 1000 : rate} kbps`); option.value = rate; return option; }));
  $('audio-bitrate').value = String(bitrates.includes(preferredBitrate) ? preferredBitrate : bitrates[0]);
  $('audio-bitrate').hidden = !['mp3', 'opus'].includes(format);
  document.querySelector('label[for="audio-bitrate"]').hidden = $('audio-bitrate').hidden;
}
function updateSettingsLabels() {
  $('volume-value').textContent = `${$('volume').value} dB`;
  $('expressiveness-value').textContent = $('expressiveness').value;
  $('diversity-value').textContent = $('diversity').value;
}
function restoreSpeechSettings(options) {
  $('output-format').value = ['mp3', 'wav', 'opus', 'pcm'].includes(options.format) ? options.format : 'mp3';
  $('latency').value = ['normal', 'balanced', 'low'].includes(options.latency) ? options.latency : 'normal';
  for (const [key, [id, fallback]] of Object.entries(numericSettings)) $(id).value = Number.isFinite(options[key]) ? options[key] : fallback;
  for (const [key, [id, fallback]] of Object.entries(booleanSettings)) $(id).checked = typeof options[key] === 'boolean' ? options[key] : fallback;
  $('dialogue-mode').checked = Boolean(options.speakers?.length);
  pronunciation = Array.isArray(options.pronunciation) ? structuredClone(options.pronunciation).slice(0, 100) : [];
  updateFormatControls(options); updateSettingsLabels(); renderSpeakers();
}
function insertScriptToken(token) {
  const field = $('script');
  if (field.value.length - (field.selectionEnd - field.selectionStart) + token.length > 3000) return toast('Script limit reached.');
  field.setRangeText(token, field.selectionStart, field.selectionEnd, 'end'); field.focus(); updateEditor(); persist();
}
function renderSpeakers() {
  const enabled = $('dialogue-mode').checked;
  $('speaker-list').hidden = !enabled; $('add-speaker').hidden = !enabled;
  $('add-speaker').disabled = dialogueVoices.length >= 7;
  const nodes = [selectedVoice, ...dialogueVoices].map((voice, index) => {
    const group = el('div', 'speaker-chip');
    group.append(button(`${index + 1}: ${voice?.name || 'Choose voice'}`, 'text-button speaker-name', null, () => {
      speakerTarget = index === 0 ? null : index - 1; location.hash = 'voices';
    }), iconButton(`Insert speaker ${index + 1}`, 'text', () => insertScriptToken(`<|speaker:${index}|>`)));
    if (index > 0) group.append(iconButton(`Remove speaker ${index + 1}`, 'close', () => {
      if ($('script').value.includes(`<|speaker:${index}|>`)) return toast("Remove this speaker's script tags before removing the speaker.");
      for (let oldIndex = index + 1; oldIndex <= dialogueVoices.length; oldIndex++) $('script').value = $('script').value.replaceAll(`<|speaker:${oldIndex}|>`, `<|speaker:${oldIndex - 1}|>`);
      dialogueVoices.splice(index - 1, 1); renderSpeakers(); updateEditor(); persist();
    }));
    return group;
  });
  $('speaker-list').replaceChildren(...nodes);
}
$('dialogue-mode').addEventListener('change', () => { renderSpeakers(); updateEditor(); persist(); });
$('add-speaker').addEventListener('click', () => { speakerTarget = dialogueVoices.length; location.hash = 'voices'; toast("Choose the next speaker's voice"); });
$('output-format').addEventListener('change', () => { updateFormatControls(); persist(); });
for (const id of ['sample-rate', 'audio-bitrate', 'latency', ...Object.values(numericSettings).map(([id]) => id), ...Object.values(booleanSettings).map(([id]) => id)]) $(id).addEventListener('input', () => { updateSettingsLabels(); persist(); });
$('reset-settings').addEventListener('click', () => { restoreSpeechSettings({}); updateEditor(); persist(); });
function addPronunciationRow(rule = { key: '', value: '', case_sensitive: false }) {
  const row = el('div', 'pronunciation-row');
  const word = el('input'); word.value = rule.key; word.placeholder = 'Word or phrase'; word.maxLength = 256; word.required = true; word.setAttribute('aria-label', 'Written word or phrase'); word.dataset.rule = 'key';
  const phonemes = el('input'); phonemes.value = rule.value; phonemes.placeholder = 'Phonemes'; phonemes.maxLength = 1024; phonemes.required = true; phonemes.setAttribute('aria-label', 'Pronunciation phonemes'); phonemes.dataset.rule = 'value';
  const label = el('label', 'check-label'); const sensitive = el('input'); sensitive.type = 'checkbox'; sensitive.checked = rule.case_sensitive; sensitive.dataset.rule = 'case'; label.append(sensitive, el('span', '', 'Case sensitive'));
  row.append(word, phonemes, label, iconButton('Remove pronunciation rule', 'close', () => row.remove())); $('pronunciation-rules').append(row);
}
$('pronunciation-button').addEventListener('click', () => { $('pronunciation-rules').replaceChildren(); pronunciation.forEach(addPronunciationRow); if (!pronunciation.length) addPronunciationRow(); message('pronunciation-message', ''); $('pronunciation-dialog').showModal(); });
$('close-pronunciation').addEventListener('click', () => $('pronunciation-dialog').close());
$('add-pronunciation').addEventListener('click', () => { if ($('pronunciation-rules').children.length >= 100) return message('pronunciation-message', 'Use up to 100 rules.', true); addPronunciationRow(); });
$('pronunciation-form').addEventListener('submit', (event) => {
  event.preventDefault(); pronunciation = [...$('pronunciation-rules').children].map((row) => ({ key: row.querySelector('[data-rule=key]').value.trim(), value: row.querySelector('[data-rule=value]').value.trim(), case_sensitive: row.querySelector('[data-rule=case]').checked }));
  persist(); $('pronunciation-dialog').close(); toast('Pronunciation rules saved');
});
let clonePreviewUrls = [];
function releaseCloneSamples() { clonePreviewUrls.forEach((url) => URL.revokeObjectURL(url)); clonePreviewUrls = []; $('clone-sample-fields').replaceChildren(); }
$('clone-voice').addEventListener('click', () => { message('clone-message', ''); $('clone-dialog').showModal(); });
$('close-clone').addEventListener('click', () => $('clone-dialog').close());
$('clone-samples').addEventListener('change', () => {
  releaseCloneSamples(); const files = [...$('clone-samples').files];
  if (files.length > 20 || files.reduce((sum, file) => sum + file.size, 0) > 29 * 1024 * 1024) { $('clone-samples').value = ''; return message('clone-message', 'Choose up to 20 samples, under 30 MB total.', true); }
  message('clone-message', '');
  files.forEach((file, index) => {
    const group = el('div', 'sample-field'); const label = el('label', '', file.name); const audio = el('audio'); audio.controls = true; audio.preload = 'metadata'; audio.src = URL.createObjectURL(file); clonePreviewUrls.push(audio.src);
    const transcript = el('textarea'); transcript.rows = 2; transcript.maxLength = 10000; transcript.placeholder = 'Sample transcript (optional)'; transcript.setAttribute('aria-label', `Transcript for sample ${index + 1}`);
    group.append(label, audio, transcript); $('clone-sample-fields').append(group);
  });
});
function showMyVoices() {
  source = 'mine'; catalogLoaded = false; $('voice-language').value = ''; $('voice-search').value = '';
  document.querySelectorAll('[data-source]').forEach((tab) => { const active = tab.dataset.source === 'mine'; tab.classList.toggle('active', active); tab.setAttribute('aria-selected', active); });
  location.hash = 'voices'; loadCatalog();
}
$('clone-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = new FormData(); const files = [...$('clone-samples').files];
  form.set('title', $('clone-name').value); form.set('description', $('clone-description').value); form.set('enhance_audio_quality', String($('clone-enhance').checked));
  files.forEach((file) => form.append('voices', file));
  const transcripts = [...$('clone-sample-fields').querySelectorAll('textarea')].map((node) => node.value.trim());
  if (transcripts.some(Boolean) && !transcripts.every(Boolean)) return message('clone-message', 'Add a transcript for every sample, or leave all transcripts empty.', true);
  if (transcripts.every(Boolean) && transcripts.length) transcripts.forEach((line) => form.append('texts', line));
  $('clone-submit').disabled = true; message('clone-message', 'Creating your voice...');
  try {
    const voice = await getJson('/api/custom-voices', { method: 'POST', body: form, signal: AbortSignal.timeout(310000) });
    $('clone-dialog').close(); $('clone-form').reset(); releaseCloneSamples();
    if (voice.state === 'trained') { favorites = [...favorites.filter((v) => v.id !== voice.id), voice].slice(0, 100); chooseVoice(voice); updateCounts(); }
    else { showMyVoices(); toast(`Voice created (${voice.state}). Refresh My voices when it is ready.`); }
    catalogLoaded = false;
  } catch (error) { message('clone-message', error.name === 'TimeoutError' ? 'Voice creation timed out. Check My voices before trying again.' : error.message, true); }
  finally { $('clone-submit').disabled = false; }
});
let editingVoice;
function editVoice(voice) { editingVoice = voice; $('edit-voice-name').value = voice.name; $('edit-voice-description').value = voice.description; $('edit-voice-tags').value = voice.tags.join(', '); message('edit-voice-message', ''); $('edit-voice-dialog').showModal(); }
$('close-edit-voice').addEventListener('click', () => $('edit-voice-dialog').close());
$('edit-voice-form').addEventListener('submit', async (event) => {
  event.preventDefault(); $('edit-voice-submit').disabled = true;
  try {
    const voice = await getJson(`/api/custom-voices/${editingVoice.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: $('edit-voice-name').value, description: $('edit-voice-description').value, tags: $('edit-voice-tags').value.split(',').map((tag) => tag.trim()).filter(Boolean) }) });
    if (selectedVoice?.id === voice.id) selectedVoice = voice;
    dialogueVoices = dialogueVoices.map((v) => v.id === voice.id ? voice : v); favorites = favorites.map((v) => v.id === voice.id ? voice : v);
    renderSelectedVoice(); persist(); $('edit-voice-dialog').close(); loadCatalog(); toast('Voice updated');
  } catch (error) { message('edit-voice-message', error.message, true); }
  finally { $('edit-voice-submit').disabled = false; }
});
async function deleteVoice(voice) {
  if (!confirm(`Permanently delete "${voice.name}" from Fish Audio? This cannot be undone. Existing recordings stay in this browser.`)) return;
  try {
    await getJson(`/api/custom-voices/${voice.id}`, { method: 'DELETE' });
    favorites = favorites.filter((v) => v.id !== voice.id); if (selectedVoice?.id === voice.id) selectedVoice = null;
    // Keep dialogue indices intact until the user chooses replacements.
    dialogueVoices = dialogueVoices.map((v) => v.id === voice.id ? { ...v, state: 'failed', name: 'Deleted voice: choose a replacement' } : v);
    renderSelectedVoice(); persist(); updateCounts(); loadCatalog(); toast('Voice deleted');
  } catch (error) { toast(error.message); }
}
restoreSpeechSettings(preferences.settings || {});

$('script').value = typeof preferences.draft?.text === 'string' ? preferences.draft.text.slice(0, 3000) : '';
$('recording-title').value = typeof preferences.draft?.title === 'string' ? preferences.draft.title.slice(0, 100) : 'Untitled recording';
if (typeof preferences.draft?.speed === 'number' && preferences.draft.speed >= .5 && preferences.draft.speed <= 1.5) $('speed').value = preferences.draft.speed;
$('script').addEventListener('input', () => { updateEditor(); persist(); }); $('recording-title').addEventListener('input', persist); $('speed').addEventListener('input', () => { updateEditor(); persist(); });
$('reset-speed').addEventListener('click', () => { $('speed').value = 1; updateEditor(); persist(); });
$('new-script').addEventListener('click', () => { $('script').value = ''; $('recording-title').value = 'Untitled recording'; updateEditor(); persist(); $('script').focus(); });
$('example-button').addEventListener('click', () => { $('script').value = 'The little boat drifted across the quiet lake. Then, from somewhere beneath the water, came a soft, curious knock. The adventure was just beginning.'; $('recording-title').value = 'The quiet lake'; updateEditor(); persist(); });
let cueSelection;
function addCue(value, selection = { start: $('script').selectionStart, end: $('script').selectionEnd }) {
  try {
    const field = $('script'); const result = insertCue(field.value, selection.start, selection.end, value);
    field.value = result.text; $('emotion-dialog').close(); field.focus(); field.setSelectionRange(result.caret, result.caret); updateEditor(); persist();
  } catch (error) { toast(error.message); }
}
document.querySelectorAll('[data-emotion]').forEach((node) => node.addEventListener('click', () => addCue(node.dataset.emotion)));
function renderEmotions() {
  const query = $('emotion-search').value.trim().toLowerCase();
  const groups = Object.entries(emotionGroups).flatMap(([name, cues]) => {
    const matches = cues.filter((cue) => `${name} ${cue}`.toLowerCase().includes(query));
    if (!matches.length) return [];
    const section = el('section', 'emotion-group'); const choices = el('div', 'emotion-choices');
    choices.append(...matches.map((cue) => button(cue[0].toUpperCase() + cue.slice(1), 'text-button emotion', null, () => addCue(cue, cueSelection))));
    section.append(el('h3', '', name), choices); return [section];
  });
  $('emotion-options').replaceChildren(...groups);
  if (!groups.length) $('emotion-options').append(el('p', 'subtle', 'No matching tags. Add your own description below.'));
}
$('more-emotions').addEventListener('click', () => {
  cueSelection = { start: $('script').selectionStart, end: $('script').selectionEnd };
  $('emotion-search').value = ''; renderEmotions(); $('emotion-dialog').showModal(); $('emotion-search').focus();
});
$('close-emotions').addEventListener('click', () => $('emotion-dialog').close());
$('emotion-search').addEventListener('input', renderEmotions);
$('custom-emotion-form').addEventListener('submit', (event) => { event.preventDefault(); addCue($('custom-emotion').value, cueSelection); });
$('speech-form').addEventListener('submit', generateSpeech);
document.addEventListener('keydown', (event) => { if (activePage === 'create' && !document.querySelector('dialog[open]') && (event.ctrlKey || event.metaKey) && event.key === 'Enter' && !$('generate').disabled) { event.preventDefault(); $('speech-form').requestSubmit(); } });
$('change-voice').addEventListener('click', () => { location.hash = 'voices'; }); $('preview-selected').addEventListener('click', () => { if (selectedVoice) playPreview(selectedVoice); });
$('reuse-current').addEventListener('click', () => { if (currentRecording) reuse(currentRecording); });
$('voice-search').addEventListener('input', () => { catalogRequest?.abort(); catalogSequence++; clearTimeout(searchTimer); searchTimer = setTimeout(() => loadCatalog(), 300); });
$('voice-language').addEventListener('change', () => loadCatalog()); $('load-more').addEventListener('click', () => loadCatalog(true));
$('refresh-voices').addEventListener('click', () => loadCatalog(false, true));
document.querySelectorAll('[data-source]').forEach((node) => node.addEventListener('click', () => { source = node.dataset.source; if (source === 'mine') $('voice-language').value = ''; document.querySelectorAll('[data-source]').forEach((tab) => { const active = tab === node; tab.classList.toggle('active', active); tab.setAttribute('aria-selected', active); }); loadCatalog(); }));
$('recording-search').addEventListener('input', renderRecordings);
$('add-voice').addEventListener('click', () => { $('import-error').hidden = true; $('voice-dialog').showModal(); }); $('close-dialog').addEventListener('click', () => $('voice-dialog').close());
$('import-form').addEventListener('submit', async (event) => {
  event.preventDefault(); let id = $('import-id').value.trim();
  if (!voiceIdPattern.test(id)) { try { const url = new URL(id); id = url.protocol === 'https:' && url.hostname === 'fish.audio' ? url.pathname.match(/^\/m\/([a-f0-9]{32})\/?$/i)?.[1] || '' : ''; } catch { id = ''; } }
  if (!voiceIdPattern.test(id)) { $('import-error').textContent = 'Use a Fish Audio voice link or a 32-character voice ID.'; $('import-error').hidden = false; return; }
  $('import-submit').disabled = true; $('import-error').hidden = true;
  try { const voice = await getJson(`/api/voices/${id.toLowerCase()}`, { signal: AbortSignal.timeout(25000) }); if (!favorites.some((v) => v.id === voice.id) && favorites.length < 100) favorites.push(voice); updateCounts(); $('voice-dialog').close(); chooseVoice(voice); }
  catch (error) { $('import-error').textContent = error.name === 'TimeoutError' ? 'Voice lookup timed out. Try again.' : error.message; $('import-error').hidden = false; }
  finally { $('import-submit').disabled = false; }
});
document.addEventListener('play', (event) => { if (event.target.tagName === 'AUDIO') document.querySelectorAll('audio').forEach((audio) => { if (audio !== event.target) audio.pause(); }); }, true);
for (const event of ['play', 'pause', 'ended']) $('voice-preview').addEventListener(event, updatePreviewButtons);
$('voice-preview').addEventListener('error', () => { previewLoading = null; updatePreviewButtons(); toast('This preview could not be played. Try another voice.'); });
window.addEventListener('hashchange', switchPage);
window.addEventListener('beforeunload', () => { for (const url of audioUrls.values()) URL.revokeObjectURL(url); if (previewUrl) URL.revokeObjectURL(previewUrl); });
renderSelectedVoice(); renderRecordings(); updateCounts(); switchPage(); checkConnection();
try { recordings = (await loadRecordings()).map((r) => ({ ...r, saved: true })); renderRecordings(); if (recordings[0]) showResult(recordings[0]); }
catch (error) { message('history-message', error.message, true); toast('Recording storage unavailable. New audio can still be downloaded.'); }
finally { storageReady = true; updateEditor(); }
