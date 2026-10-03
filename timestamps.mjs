const fail = () => Object.assign(new Error('Fish Audio returned an invalid timestamp stream.'), { status: 502 });

// Audio is appended in transport order. Alignment is cumulative and latest-wins per text chunk.
export async function readTimestampAudio(response) {
  if (!response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) throw fail();
  const decoder = new TextDecoder(); const audio = []; const snapshots = new Map();
  let pending = '', data = [], size = 0, transportSize = 0;
  function event() {
    if (!data.length) return;
    const payload = data.join('\n'); data = [];
    if (payload === '[DONE]') return;
    let value; try { value = JSON.parse(payload); } catch { throw fail(); }
    if (!value || typeof value.audio_base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.audio_base64)) throw fail();
    const bytes = Buffer.from(value.audio_base64, 'base64'); size += bytes.length;
    if (size > 32 * 1024 * 1024) throw fail();
    audio.push(bytes);
    if (value.alignment === null || value.alignment === undefined) return;
    const offset = value.chunk_audio_offset_sec;
    if (!Number.isInteger(value.chunk_seq) || value.chunk_seq < 0 || value.chunk_seq > 10000 || !Number.isFinite(offset) || offset < 0 || !Array.isArray(value.alignment.segments) || value.alignment.segments.length > 10000) throw fail();
    const segments = value.alignment.segments.map((segment) => {
      if (typeof segment.text !== 'string' || segment.text.length > 3000 || !Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.start < 0 || segment.end < segment.start) throw fail();
      return { text: segment.text, start: segment.start + offset, end: segment.end + offset, chunk: value.chunk_seq };
    });
    snapshots.set(value.chunk_seq, segments);
  }
  function line(value) {
    const clean = value.replace(/\r$/, '');
    if (!clean) event();
    else if (clean.startsWith('data:')) data.push(clean.slice(5).replace(/^ /, ''));
  }
  for await (const chunk of response.body) {
    transportSize += chunk.length; if (transportSize > 48 * 1024 * 1024) throw fail();
    pending += decoder.decode(chunk, { stream: true });
    let boundary; while ((boundary = pending.indexOf('\n')) !== -1) { line(pending.slice(0, boundary)); pending = pending.slice(boundary + 1); }
    if (pending.length > 8 * 1024 * 1024 || data.join('').length > 8 * 1024 * 1024) throw fail();
  }
  pending += decoder.decode(); if (pending) line(pending); event();
  const timeline = [...snapshots.entries()].sort(([a], [b]) => a - b).flatMap(([, segments]) => segments);
  if (!size || timeline.length > 10000) throw fail();
  return { audio: Buffer.concat(audio), timeline };
}
