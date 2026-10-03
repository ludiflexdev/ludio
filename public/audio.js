export function pcmToWav(buffer, sampleRate = 44100) {
  const bytes = new Uint8Array(buffer);
  const wav = new Uint8Array(44 + bytes.length); const view = new DataView(wav.buffer);
  const write = (offset, text) => [...text].forEach((letter, index) => { wav[offset + index] = letter.charCodeAt(0); });
  write(0, 'RIFF'); view.setUint32(4, 36 + bytes.length, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, bytes.length, true); wav.set(bytes, 44);
  return new Blob([wav], { type: 'audio/wav' });
}
