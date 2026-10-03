// Fish Audio S2 bracket cues: official emotion reference and inline-tag guide.
// https://docs.fish.audio/developer-guide/core-features/emotions
// https://fish.audio/blog/how-to-use-inline-tags-in-fish-audio-s2/
export const emotionGroups = {
  'Emotions': ['happy', 'sad', 'angry', 'excited', 'calm', 'nervous', 'confident', 'surprised', 'satisfied', 'delighted', 'scared', 'worried', 'upset', 'frustrated', 'depressed', 'empathetic', 'embarrassed', 'disgusted', 'moved', 'proud', 'relaxed', 'grateful', 'curious', 'sarcastic'],
  'Advanced emotions': ['disdainful', 'unhappy', 'anxious', 'hysterical', 'indifferent', 'uncertain', 'doubtful', 'confused', 'disappointed', 'regretful', 'guilty', 'ashamed', 'jealous', 'envious', 'hopeful', 'optimistic', 'pessimistic', 'nostalgic', 'lonely', 'bored', 'contemptuous', 'sympathetic', 'compassionate', 'determined', 'resigned'],
  'Tone & delivery': ['in a hurry tone', 'shouting', 'screaming', 'whispering', 'soft tone', 'emphasis', 'whispering voice', 'soft voice', 'low voice', 'loud voice', 'soft', 'breathy'],
  'Vocal sounds': ['laughing', 'chuckling', 'chuckle', 'sobbing', 'crying', 'crying loudly', 'sighing', 'groaning', 'moaning', 'panting', 'gasping', 'yawning', 'snoring', 'clear throat', 'clears throat', 'sigh', 'groan', 'giggle', 'gasp'],
  'Breathing': ['inhalation', 'inhale', 'exhale', 'breathing'],
  'Pauses & effects': ['pause', 'short pause', 'long pause', 'break', 'long-break', 'audience laughing', 'background laughter', 'crowd laughing', 'rustling sound'],
};

export function normalizeCue(value) {
  const cue = value.trim().replace(/^\[|\]$/g, '').trim();
  if (!cue || cue.length > 120 || /[\[\]\r\n<>]/.test(cue)) throw new Error('Enter a short description without brackets or line breaks.');
  return `[${cue}]`;
}

export function insertCue(text, start, end, value, limit = 3000) {
  const cue = `${normalizeCue(value)} `;
  if (text.length - (end - start) + cue.length > limit) throw new Error('Script limit reached. Shorten it before adding a cue.');
  return { text: text.slice(0, start) + cue + text.slice(end), caret: start + cue.length };
}
