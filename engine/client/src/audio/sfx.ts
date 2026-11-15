// Placeholder sound effects synthesized with WebAudio, keyed by the theme's sfx ids. Replaced by the
// theme's generated audio files when present (cache/audio/<id>.ogg), so every id always makes a sound.
let ctx: AudioContext | null = null;
let volume = 0.8;
export const setSfxVolume = (v: number) => { volume = v; };
const ac = () => (ctx ??= new AudioContext());

function tone(freq: number, dur: number, type: OscillatorType = 'square', gain = 0.15, delay = 0, slide = 0) {
  const a = ac(), t = a.currentTime + delay;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
  g.gain.setValueAtTime(gain * volume, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur: number, gain = 0.2, freq = 2000, q = 1, delay = 0) {
  const a = ac(), t = a.currentTime + delay;
  const b = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
  const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = a.createBufferSource(); s.buffer = b;
  const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  const g = a.createGain(); g.gain.setValueAtTime(gain * volume, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(a.destination); s.start(t);
}

const SFX: Record<string, () => void> = {
  'ui.click': () => tone(660, 0.05, 'square', 0.08),
  'ui.open': () => { noise(0.12, 0.12, 3000, 0.7); tone(440, 0.08, 'triangle', 0.06, 0.03, 1.5); },
  'ui.error': () => tone(140, 0.25, 'sawtooth', 0.12, 0, 0.6),
  'chat.letter': () => tone(1200 + Math.random() * 300, 0.015, 'square', 0.03),
  'currency.coin': () => { tone(1320, 0.08, 'square', 0.1); tone(1760, 0.18, 'square', 0.08, 0.06); },
  'currency.gem': () => [0, 0.05, 0.1].forEach((d, i) => tone(1568 * (1 + i * 0.25), 0.25, 'sine', 0.08, d)),
  'achievement.common': () => [523, 659, 784].forEach((f, i) => tone(f, 0.18, 'square', 0.09, i * 0.07)),
  'achievement.rare': () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.3, 'triangle', 0.1, i * 0.06)),
  'achievement.legendary': () => { [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, 0.6, 'sawtooth', 0.06, i * 0.09)); noise(1.2, 0.08, 400, 0.5, 0.4); },
  'level.up': () => [392, 494, 587, 784, 988].forEach((f, i) => tone(f, 0.22, 'square', 0.1, i * 0.08)),
  'writ.request': () => { noise(0.08, 0.3, 200, 0.8); tone(110, 0.3, 'sine', 0.2, 0, 0.7); },
  'seal.approved': () => { noise(0.1, 0.4, 150, 0.8); tone(90, 0.4, 'sine', 0.25, 0, 0.6); },
  'trial.passed': () => { tone(98, 1.5, 'sine', 0.3); [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.8, 'square', 0.06, 0.2 + i * 0.12)); },
  'forge.hammer': () => { noise(0.04, 0.5, 2500, 2); tone(1900 + Math.random() * 200, 0.35, 'sine', 0.08, 0.01); tone(2850, 0.25, 'sine', 0.04, 0.01); },
  'forge.bellows': () => noise(0.5, 0.15, 500, 0.4),
  'forge.quench': () => noise(0.9, 0.18, 5000, 0.3),
};

export function play(id?: string) {
  if (!id) return;
  try { (SFX[id] ?? SFX['ui.click'])(); } catch { /* audio not allowed yet */ }
}
