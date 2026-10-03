function stamp(seconds) {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const pad = (value, digits = 2) => String(value).padStart(digits, '0');
  return `${pad(Math.floor(milliseconds / 3600000))}:${pad(Math.floor(milliseconds / 60000) % 60)}:${pad(Math.floor(milliseconds / 1000) % 60)},${pad(milliseconds % 1000, 3)}`;
}
export function toSrt(timeline) {
  const groups = []; let current = [];
  for (const segment of timeline) {
    if (current.length && (current.length >= 8 || segment.end - current[0].start > 4 || segment.chunk !== current[0].chunk)) { groups.push(current); current = []; }
    current.push(segment);
  }
  if (current.length) groups.push(current);
  return groups.map((group, index) => `${index + 1}\n${stamp(group[0].start)} --> ${stamp(Math.max(group.at(-1).end, group[0].start + .1))}\n${group.map((segment) => segment.text.replace(/[\r\n]/g, ' ')).join(' ')}\n`).join('\n');
}
