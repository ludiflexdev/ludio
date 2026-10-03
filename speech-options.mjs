const fail = (message) => Object.assign(new Error(message), { status: 400 });
const ID = /^[a-f0-9]{32}$/i;
export const audioTypes = { mp3: 'audio/mpeg', wav: 'audio/wav', opus: 'audio/ogg', pcm: 'application/octet-stream' };
export function speechOptions(input, text) {
  const format = input.format ?? 'mp3';
  if (!Object.hasOwn(audioTypes, format)) throw fail('Choose MP3, WAV, Opus, or PCM.');
  const body = { format };
  if (format === 'mp3') {
    const bitrate = input.bitrate ?? 128;
    if (![64, 128, 192].includes(bitrate)) throw fail('MP3 bitrate must be 64, 128, or 192 kbps.');
    body.mp3_bitrate = bitrate;
  }
  if (format === 'opus' && input.opusBitrate !== undefined) {
    if (![-1000, 24000, 32000, 48000, 64000].includes(input.opusBitrate)) throw fail('Choose a valid Opus bitrate.');
    body.opus_bitrate = input.opusBitrate;
  }
  if (input.sampleRate !== undefined) {
    const rates = format === 'opus' ? [48000] : format === 'mp3' ? [32000, 44100] : [8000, 16000, 24000, 32000, 44100];
    if (!rates.includes(input.sampleRate)) throw fail('This sample rate is not supported by the selected format.');
    body.sample_rate = input.sampleRate;
  }
  const latency = input.latency ?? 'normal';
  if (!['normal', 'balanced', 'low'].includes(latency)) throw fail('Choose a valid latency setting.');
  body.latency = latency;
  for (const [local, api, min, max, integer] of [['temperature', 'temperature', 0, 1], ['topP', 'top_p', 0, 1], ['chunkLength', 'chunk_length', 100, 300, true], ['minChunkLength', 'min_chunk_length', 0, 100, true], ['maxTokens', 'max_new_tokens', 1, 4096, true], ['repetitionPenalty', 'repetition_penalty', 1, 2], ['earlyStop', 'early_stop_threshold', 0, 1]]) {
    const value = input[local];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw fail(`Invalid ${local}.`);
    body[api] = value;
  }
  for (const [local, api] of [['normalize', 'normalize'], ['previousChunks', 'condition_on_previous_chunks']]) {
    if (input[local] !== undefined) { if (typeof input[local] !== 'boolean') throw fail(`Invalid ${local}.`); body[api] = input[local]; }
  }
  if (input.qualityGuard !== undefined) { if (typeof input.qualityGuard !== 'boolean') throw fail('Invalid quality guard setting.'); if (input.qualityGuard) body.features = ['quality-guard']; }
  if (input.speakers !== undefined) {
    if (!Array.isArray(input.speakers) || input.speakers.length < 2 || input.speakers.length > 8 || input.speakers.some((id) => typeof id !== 'string' || !ID.test(id))) throw fail('Choose between 2 and 8 valid speaker voices.');
    const markers = [...text.matchAll(/<\|speaker:(\d+)\|>/g)];
    if (!markers.length || markers.some((m) => Number(m[1]) >= input.speakers.length)) throw fail('Insert speaker tags that match your chosen voices.');
    body.reference_id = input.speakers.map((id) => id.toLowerCase());
  } else if (/<\|speaker:/.test(text)) throw fail('Enable dialogue and choose voices for the speaker tags in this script.');
  if (input.pronunciation !== undefined) {
    if (!Array.isArray(input.pronunciation) || input.pronunciation.length > 100) throw fail('Use up to 100 pronunciation rules.');
    const items = input.pronunciation.map((rule) => {
      if (!rule || typeof rule.key !== 'string' || !rule.key.trim() || rule.key.length > 256 || typeof rule.value !== 'string' || !rule.value.trim() || rule.value.length > 1024 || typeof rule.case_sensitive !== 'boolean') throw fail('Enter a word, phonemes, and case setting for each pronunciation rule.');
      return { key: rule.key, value: rule.value, case_sensitive: rule.case_sensitive };
    });
    if (items.length) body.pronunciation_dictionary = [{ items }];
  }
  return body;
}
