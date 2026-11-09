// Petits outils partagés : échappement HTML, format du temps, icônes, couleurs, toast.

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fmtTime(ms) {
  if (ms == null || !isFinite(ms)) return '--:--';
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID().slice(0, 12);
  return Math.random().toString(36).slice(2, 14);
}

export function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function sameTitle(a, b) {
  const n = (s) => String(s || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const x = n(a), y = n(b);
  if (!x || !y) return false;
  // Wikipédia ignore la casse de la première lettre
  return x.charAt(0).toUpperCase() + x.slice(1) === y.charAt(0).toUpperCase() + y.slice(1);
}

export function initial(name) {
  const s = String(name || '?').trim();
  return (s.codePointAt(0) ? String.fromCodePoint(s.codePointAt(0)) : '?').toUpperCase();
}

// Couleurs des joueuses : fond + couleur du texte lisible dessus
export const COLORS = [
  { bg: '#4A2FE0', fg: '#FFFFFF', ink: '#4A2FE0' },
  { bg: '#FFC93C', fg: '#17153B', ink: '#8A6400' },
  { bg: '#2EC4B6', fg: '#17153B', ink: '#0F6E66' },
  { bg: '#FF8A73', fg: '#17153B', ink: '#B23A22' },
  { bg: '#17153B', fg: '#FFFFFF', ink: '#17153B' },
  { bg: '#B9A8FF', fg: '#17153B', ink: '#5B3FD9' },
  { bg: '#1F7A4D', fg: '#FFFFFF', ink: '#1F7A4D' },
  { bg: '#C2185B', fg: '#FFFFFF', ink: '#C2185B' },
];

export function colorOf(player) {
  return COLORS[(player && player.color) % COLORS.length] || COLORS[0];
}

export function avatar(player, size = 40) {
  const c = colorOf(player);
  return `<span class="avatar" style="width:${size}px;height:${size}px;background:${c.bg};color:${c.fg};font-size:${Math.round(size * 0.42)}px" aria-hidden="true">${esc(initial(player && player.name))}</span>`;
}

const svg = (d, w = 20, sw = 2.2) =>
  `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const ICON = {
  bolt: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"></path>', 24),
  boltSm: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"></path>', 20, 2.4),
  plus: svg('<path d="M12 5v14M5 12h14"></path>', 20, 2.4),
  chart: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"></path>', 18),
  chevL: svg('<path d="M15 18l-6-6 6-6"></path>'),
  chevD: svg('<path d="M6 9l6 6 6-6"></path>', 20, 2.4),
  chevU: svg('<path d="M6 15l6-6 6 6"></path>', 20, 2.4),
  arrowR: svg('<path d="M5 12h14M13 6l6 6-6 6"></path>', 20, 2.4),
  copy: svg('<rect x="9" y="9" width="12" height="12" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path>', 22, 2),
  timer: svg('<circle cx="12" cy="13" r="8"></circle><path d="M12 9v4l2 2M10 2h4"></path>', 16),
  reroll: svg('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"></path><path d="M21 3v5h-5"></path>', 18),
  flag: svg('<path d="M4 22V4M4 4h12l-2 4 2 4H4"></path>'),
  crown: svg('<path d="M3 7l4 4 5-7 5 7 4-4-2 12H5L3 7z"></path>', 28, 2),
  share: svg('<path d="M12 3v13M7 8l5-5 5 5M5 14v6h14v-6"></path>', 22),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path>', 12, 2.4),
  door: svg('<path d="M14 3h5v18h-5M10 17l5-5-5-5M15 12H3"></path>', 20),
};

let toastTimer = null;
export function toast(message, ms = 2600) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* stockage indisponible */ }
  },
};
