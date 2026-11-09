// Historique des parties, gardé sur l'appareil (localStorage).

import { store } from './util.js';

const KEY = 'wr_history';

export function all() {
  const list = store.get(KEY, []);
  return Array.isArray(list) ? list : [];
}

export function add(record) {
  const list = all();
  if (list.some((r) => r.id === record.id)) return;
  list.unshift(record);
  store.set(KEY, list.slice(0, 200));
}

export function summary(list = all()) {
  const finished = list.filter((r) => r.status === 'finished');
  const bestClicks = finished.reduce((best, r) => (!best || r.clicks < best.clicks ? r : best), null);
  const bestTime = finished.reduce((best, r) => (!best || r.time < best.time ? r : best), null);
  const avg = finished.length ? finished.reduce((s, r) => s + r.clicks, 0) / finished.length : null;
  return {
    played: list.length,
    wins: list.filter((r) => r.rank === 1 && r.status === 'finished').length,
    bestClicks,
    bestTime,
    avg,
  };
}
