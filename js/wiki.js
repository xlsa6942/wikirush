// Accès à Wikipédia en français : tirage de pages, résumés des cibles,
// chargement et nettoyage des articles pour la course.

import { isForbidden } from './forbidden.js';
import { sameTitle } from './util.js';

const API = 'https://fr.wikipedia.org/w/api.php';

async function api(params) {
  const qs = new URLSearchParams({ ...params, format: 'json', formatversion: '2', origin: '*' });
  const res = await fetch(`${API}?${qs}`);
  if (!res.ok) throw new Error(`Wikipédia a répondu ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.info || 'Erreur Wikipédia');
  return data;
}

const isDisambig = (p) => !!(p.pageprops && 'disambiguation' in p.pageprops);

function trimExtract(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= 170) return t;
  const cut = t.slice(0, 170);
  return cut.slice(0, cut.lastIndexOf(' ')) + '…';
}

// Résumé + image pour une liste de titres. Renvoie Map(titreDemandé -> infos)
// sans les pages manquantes ni les pages d'homonymie.
export async function fetchSummaries(titles) {
  const data = await api({
    action: 'query',
    prop: 'extracts|pageimages|pageprops',
    exintro: '1',
    explaintext: '1',
    exsentences: '2',
    exlimit: 'max',
    piprop: 'thumbnail',
    pithumbsize: '320',
    pilimit: 'max',
    ppprop: 'disambiguation',
    redirects: '1',
    titles: titles.join('|'),
  });
  const q = data.query || {};
  const norm = {};
  (q.normalized || []).forEach((n) => { norm[n.from] = n.to; });
  const red = {};
  (q.redirects || []).forEach((n) => { red[n.from] = n.to; });
  const pages = {};
  (q.pages || []).forEach((p) => { pages[p.title] = p; });
  const out = new Map();
  for (const t of titles) {
    let x = norm[t] || t;
    x = red[x] || x;
    const p = pages[x];
    if (!p || p.missing || p.invalid || isDisambig(p)) continue;
    out.set(t, {
      title: p.title,
      extract: trimExtract(p.extract),
      thumb: p.thumbnail ? p.thumbnail.source : null,
    });
  }
  return out;
}

// Une page de départ au hasard, assez fournie en liens pour que ce soit jouable.
export async function randomStart({ exclude = [], forbidden = true } = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const data = await api({
      action: 'query',
      generator: 'random',
      grnnamespace: '0',
      grnlimit: '20',
      prop: 'info|pageprops',
      ppprop: 'disambiguation',
    });
    const pages = ((data.query && data.query.pages) || []).filter(
      (p) => !isDisambig(p) && !exclude.some((e) => sameTitle(e, p.title)) && !(forbidden && isForbidden(p.title))
    );
    const good = pages.filter((p) => (p.length || 0) >= 6000);
    const pool = good.length ? good : attempt === 3 ? pages : [];
    if (pool.length) return pool[Math.floor(Math.random() * pool.length)].title;
  }
  throw new Error('Impossible de tirer une page au hasard');
}

const cache = new Map();

// Charge un article (en suivant les redirections). Renvoie { title, display, html }.
export async function loadArticle(title) {
  if (cache.has(title)) return cache.get(title);
  const data = await api({
    action: 'parse',
    page: title,
    prop: 'text|displaytitle',
    redirects: '1',
    disableeditsection: '1',
    disablelimitreport: '1',
  });
  const p = data.parse;
  const tmp = document.createElement('div');
  tmp.innerHTML = p.displaytitle || p.title;
  const page = { title: p.title, display: tmp.textContent || p.title, html: p.text };
  cache.set(title, page);
  cache.set(p.title, page);
  return page;
}

const BLOCKED_NS = /^(fichier|file|image|média|media|catégorie|category|aide|help|portail|modèle|template|wikipédia|wikipedia|spécial|special|projet|discussion|talk|utilisateur|utilisatrice|user|mediawiki|module|référence|sujet|livre|wikijunior|gadget|tm|wp|w|wikt|wiktionary|s|b|n|q|v|voy|d|commons|meta|mw|en|de|es|it):/i;

// Titre visé par un lien d'article, ou null si ce n'est pas un article jouable.
function linkTitle(a) {
  if (a.classList.contains('new')) return null; // lien rouge : la page n'existe pas
  const href = a.getAttribute('href') || '';
  let path = null;
  if (href.startsWith('/wiki/')) path = href.slice(6);
  else if (href.startsWith('./')) path = href.slice(2);
  else return null;
  path = path.split('#')[0].split('?')[0];
  if (!path) return null;
  let title;
  try { title = decodeURIComponent(path); } catch (e) { return null; }
  title = title.replace(/_/g, ' ').trim();
  if (!title || BLOCKED_NS.test(title)) return null;
  return title;
}

const REMOVE = [
  'script', 'style', 'link', 'meta', 'iframe', 'object', 'embed', 'form', 'input', 'button',
  '.mw-editsection', '.navbox', '.navbox-container', '.metadata', '.printfooter', '.mw-empty-elt',
  '.bandeau-portail', '#toc', '.toc', '.mw-jump-link', '.catlinks', '.ambox', '.bandeau-container',
  '.bandeau-section', '.mw-kartographer-maplink', '.noprint', '.autres-projets', '.reference-cadre',
].join(',');

// Nettoie le HTML d'un article et transforme les liens pour le jeu.
export function buildArticle(html, { forbidden = true } = {}) {
  const doc = new DOMParser().parseFromString(`<div id="wr-root">${html}</div>`, 'text/html');
  const root = doc.getElementById('wr-root');
  root.querySelectorAll(REMOVE).forEach((n) => n.remove());

  // Sécurité : pas d'attributs on*, pas de javascript:
  root.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || (name === 'href' && /^\s*javascript:/i.test(attr.value))) el.removeAttribute(attr.name);
    }
  });

  root.querySelectorAll('a').forEach((a) => {
    const title = linkTitle(a);
    if (!title) {
      const span = doc.createElement('span');
      span.className = 'wl-dead';
      while (a.firstChild) span.appendChild(a.firstChild);
      a.replaceWith(span);
      return;
    }
    for (const attr of Array.from(a.attributes)) a.removeAttribute(attr.name);
    a.setAttribute('href', '#');
    a.dataset.title = title;
    if (forbidden && isForbidden(title)) {
      a.className = 'wl wl-forbidden';
      a.setAttribute('aria-disabled', 'true');
      a.setAttribute('title', 'Page interdite');
    } else {
      a.className = 'wl';
    }
  });

  root.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src');
    if (src && src.startsWith('//')) img.setAttribute('src', 'https:' + src);
    const srcset = img.getAttribute('srcset');
    if (srcset) img.setAttribute('srcset', srcset.replace(/(^|,\s*)\/\//g, '$1https://'));
    img.setAttribute('loading', 'lazy');
    img.removeAttribute('width');
    img.removeAttribute('height');
  });

  root.querySelectorAll('table').forEach((table) => {
    if (table.parentElement && table.parentElement.classList.contains('table-wrap')) return;
    const wrap = doc.createElement('div');
    wrap.className = table.matches('.infobox, .infobox_v2, .infobox_v3, .infobox-v3') ? 'table-wrap is-infobox' : 'table-wrap';
    table.replaceWith(wrap);
    wrap.appendChild(table);
  });

  return root.innerHTML;
}
