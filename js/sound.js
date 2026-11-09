// Sons du jeu, synthétisés à la volée (aucun fichier audio à charger).

let ctx = null;

function ac() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Les navigateurs exigent un geste de l'utilisateur avant de jouer du son
export function unlockAudio() {
  ac();
}

function tone(freq, dur, { type = 'sine', vol = 0.15, when = 0, to = null } = {}) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + when;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export const sfx = {
  click() {
    tone(620, 0.07, { type: 'triangle', vol: 0.12 });
    tone(930, 0.06, { type: 'triangle', vol: 0.08, when: 0.035 });
  },
  pop() {
    tone(440, 0.09, { type: 'sine', vol: 0.14, to: 880 });
  },
  join() {
    tone(523, 0.1, { type: 'triangle', vol: 0.12 });
    tone(784, 0.14, { type: 'triangle', vol: 0.12, when: 0.08 });
  },
  tick() {
    tone(560, 0.14, { type: 'square', vol: 0.07 });
  },
  go() {
    tone(880, 0.12, { type: 'square', vol: 0.08 });
    tone(1175, 0.3, { type: 'square', vol: 0.08, when: 0.1 });
  },
  error() {
    tone(220, 0.2, { type: 'sawtooth', vol: 0.07, to: 140 });
  },
  win() {
    const notes = [523, 659, 784, 1047, 784, 1047];
    notes.forEach((f, i) => tone(f, i === notes.length - 1 ? 0.5 : 0.14, { type: 'triangle', vol: 0.14, when: i * 0.11 }));
    tone(262, 0.7, { type: 'sine', vol: 0.1, when: 0.44 });
  },
  sad() {
    tone(392, 0.2, { type: 'triangle', vol: 0.1 });
    tone(330, 0.2, { type: 'triangle', vol: 0.1, when: 0.18 });
    tone(262, 0.4, { type: 'triangle', vol: 0.1, when: 0.36 });
  },
  results() {
    [392, 523, 659].forEach((f, i) => tone(f, 0.18, { type: 'triangle', vol: 0.12, when: i * 0.09 }));
  },
};
