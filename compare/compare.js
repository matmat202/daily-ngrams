import { countUrl, webCounts, isWeb, mapLimit, fmtRate } from '../ngram-logic.js';
import { parseRows } from '../theses/thesis-logic.js';
import { parseTable } from '../courses/course-logic.js';
import {
  FROM, SOURCES, parseWord, dailyBins, dailySeries, thesisSeries, courseSeries, relative, peakPoint, peakGap,
  encodeState, decodeState, sourceUrl, PRESETS,
} from './compare-logic.js';

const $ = (id) => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';
const COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)'];
const UNIT = ['per 10k', 'per 1k', 'per 1k'];
let W = 720, H = 320;
const M = { l: 40, r: 16, t: 12, b: 28 };
let DAILY = null, ROWS = [], TMETA = null, TABLE = null, CMETA = null;
let current = null; // {term, series: [daily, theses, courses] each [{x,r,rel,label,n,of}] or null}
let seq = 0;
const cache = new Map();

const el = (tag, attrs = {}, text) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
};
function setStatus(msg, err = false) { const s = $('status'); s.textContent = msg; s.classList.toggle('err', err); }

async function dailyCounts(term) {
  if (cache.has(term)) return cache.get(term);
  const counts = await mapLimit(dailyBins(), 5, async (b) => {
    if (isWeb(b) && !webCounts(term)) return null;
    const r = await fetch(countUrl(term, b));
    if (!r.ok) throw new Error(`the Daily's search answered ${r.status}`);
    if (isWeb(b)) { const n = Number(r.headers.get('X-WP-Total')); if (!Number.isInteger(n)) throw new Error('no count'); return n; }
    const n = (await r.json())?.hits?.found;
    if (!Number.isFinite(n)) throw new Error('an unexpected reply');
    return n;
  });
  cache.set(term, counts);
  return counts;
}

const withRel = (s) => { if (!s) return null; const rel = relative(s.map((p) => p.r)); return s.map((p, k) => ({ ...p, rel: rel[k] })); };

async function show(input, { push = true } = {}) {
  const { term, why } = parseWord(input);
  $('q').value = term ?? input;
  for (const b of document.querySelectorAll('#presets button')) b.setAttribute('aria-pressed', String(b.textContent === term));
  if (!term) { setStatus(why || 'Type a word to chart it.', !!why); return; }
  if (push) history.replaceState(null, '', location.pathname + encodeState(term));
  const my = ++seq;
  const th = withRel(thesisSeries(ROWS, term, TMETA.last));
  const co = withRel(courseSeries(TABLE, term, CMETA));
  current = { term, series: [null, th, co] };
  draw();
  setStatus(`Counting “${term}” in the Daily…`);
  let dc;
  try { dc = await dailyCounts(term); }
  catch (e) { if (my === seq) setStatus(`The Daily’s archive did not answer (${e.message}); the other two are drawn.`, true); return; }
  if (my !== seq) return;
  current.series[0] = withRel(dailySeries(dc, DAILY.totals, DAILY.webScale));
  draw();
  const never = SOURCES.map((s, i) => (peakPoint(current.series[i]) ? null
    : i === 2 && !co ? `${s.label}: too rare to chart` : `${s.label}: never`)).filter(Boolean);
  setStatus(never.join(' · '));
}

function summary() {
  const [d, t, c] = current.series.map(peakPoint);
  const out = [];
  if (d && t) {
    const g = peakGap(t, d);
    out.push(g === 0 ? `The Daily and thesis titles both peaked in ${t.label}.`
      : `Thesis titles peaked in ${t.label}, the Daily in ${d.label}: ${Math.abs(g)} years ${g > 0 ? 'later' : 'earlier'}.`);
  } else if (d || t) out.push(`${d ? 'The Daily' : 'Thesis titles'} peaked in ${(d || t).label}.`);
  if (c) {
    const cs = current.series[2];
    const rel = (p) => (p ? Math.round(p.rel) : null);
    out.push(`In course bulletins it peaked in ${c.label}${c === cs.at(-1) ? ', the latest year' : ''}; ${cs[0].label} stood at ${rel(cs[0])}% of that.`);
  }
  return out.join(' ');
}

function draw() {
  const box = $('chart'); box.replaceChildren();
  const legend = $('legend'); legend.replaceChildren();
  $('summary').textContent = current ? summary() : '';
  W = Math.max(300, Math.min(900, box.clientWidth || 720));
  const narrow = W < 520;
  H = narrow ? 240 : 300;
  const iw = W - M.l - M.r, ih = H - M.t - M.b;
  const X1 = 2027;
  const x = (yr) => M.l + (iw * (yr - FROM)) / (X1 - FROM);
  const y = (v) => M.t + ih - (ih * v) / 100;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img',
    'aria-label': current ? `Line chart of “${current.term}” in the Stanford Daily, thesis titles and course bulletins, each as a percent of its own peak, ${FROM} to 2026` : 'Empty chart' });
  const ax = el('g', { class: 'ax' });
  for (const t of [0, 25, 50, 75, 100]) {
    ax.append(el('line', { x1: M.l, x2: W - M.r, y1: y(t), y2: y(t), class: t === 0 ? 'base' : '' }));
    ax.append(el('text', { x: M.l - 6, y: y(t) + 4, 'text-anchor': 'end' }, `${t}%`));
  }
  for (let yr = 1920; yr <= 2020; yr += narrow ? 20 : 10) ax.append(el('text', { x: x(yr), y: H - 8, 'text-anchor': 'middle' }, String(yr)));
  svg.append(ax);
  if (current) {
    current.series.forEach((s, i) => {
      const li = document.createElement('li');
      li.innerHTML = '<span class="sw"></span><a></a><span class="peak"></span>';
      li.children[0].style.background = COLORS[i];
      li.children[1].textContent = SOURCES[i].label;
      li.children[1].href = sourceUrl(SOURCES[i], current.term);
      const p = peakPoint(s);
      li.children[2].textContent = i === 0 && !s ? '· counting…' : p ? `· peak ${p.label}` : i === 2 && !s ? '· too rare' : '· never';
      legend.append(li);
      if (!s || !p) return;
      let d = '', pen = false;
      for (const pt of s) {
        if (pt.rel == null) { pen = false; continue; }
        d += `${pen ? 'L' : 'M'}${x(pt.x).toFixed(1)},${y(pt.rel).toFixed(1)}`; pen = true;
      }
      svg.append(el('path', { d, class: 'ln', stroke: COLORS[i], 'data-src': SOURCES[i].id }));
      svg.append(el('circle', { cx: x(p.x), cy: y(100), r: 4.5, class: 'pk', fill: COLORS[i] }));
    });
  }
  const cross = el('line', { class: 'cross', y1: M.t, y2: M.t + ih, x1: -10, x2: -10, visibility: 'hidden' });
  svg.append(cross);
  const hit = el('rect', { x: M.l, y: M.t, width: iw, height: ih + M.b, fill: 'transparent' });
  svg.append(hit);
  box.append(svg);
  const tip = document.createElement('div'); tip.className = 'tip'; box.append(tip);
  let pinned = null;
  const focus = (yr) => {
    if (yr == null || !current) { cross.setAttribute('visibility', 'hidden'); tip.classList.remove('on'); return; }
    const pts = current.series.map((s) => {
      if (!s) return null;
      const near = s.reduce((a, p) => (Math.abs(p.x - yr) < Math.abs(a.x - yr) ? p : a));
      return Math.abs(near.x - yr) <= (s === current.series[2] ? 0.6 : 2.6) ? near : null;
    });
    if (!pts.some(Boolean)) { cross.setAttribute('visibility', 'hidden'); tip.classList.remove('on'); return; }
    cross.setAttribute('x1', x(yr)); cross.setAttribute('x2', x(yr)); cross.setAttribute('visibility', 'visible');
    tip.innerHTML = '<h3></h3><table></table>';
    tip.querySelector('h3').textContent = `around ${Math.floor(yr)}`;
    const tb = tip.querySelector('table');
    pts.forEach((p, i) => {
      if (!p) return;
      const tr = document.createElement('tr');
      tr.innerHTML = '<td><span class="sw"></span></td><td class="v"></td>';
      tr.querySelector('.sw').style.background = COLORS[i];
      tr.children[0].append(`${SOURCES[i].label}, ${p.label}`);
      tr.children[1].textContent = p.r == null ? '—' : `${Math.round(p.rel)}% · ${fmtRate(p.r)} ${UNIT[i]} (${(p.n ?? 0).toLocaleString('en-US')} ${SOURCES[i].unit})`;
      tb.append(tr);
    });
    const rect = box.getBoundingClientRect();
    const px = (x(yr) / W) * rect.width;
    tip.classList.add('on');
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.max(0, Math.min(rect.width - tw, px + (px > rect.width / 2 ? -tw - 12 : 12)))}px`;
    tip.style.top = '8px';
  };
  const yrAt = (e) => { const r = svg.getBoundingClientRect(); const sx = ((e.clientX - r.left) / r.width) * W; return FROM + ((sx - M.l) / iw) * (X1 - FROM); };
  hit.addEventListener('pointermove', (e) => { if (pinned == null && e.pointerType === 'mouse') focus(yrAt(e)); });
  hit.addEventListener('pointerleave', (e) => { if (pinned == null && e.pointerType === 'mouse') focus(null); });
  hit.addEventListener('click', (e) => { const yr = yrAt(e); pinned = pinned == null ? yr : null; focus(pinned ?? yr); });
  drawTable();
}

function drawTable() {
  const t = $('table'); t.replaceChildren();
  if (!current) return;
  current.series.forEach((s, i) => {
    if (!s) return;
    const h = document.createElement('h3'); h.textContent = SOURCES[i].label; t.append(h);
    const tbl = document.createElement('table');
    tbl.innerHTML = `<tr><th>Period</th><th>${SOURCES[i].unit}</th><th>with “${current.term}”</th><th>${UNIT[i]}</th><th>% of peak</th></tr>`;
    for (const p of s) {
      const tr = document.createElement('tr');
      for (const v of [p.label, p.of?.toLocaleString('en-US') ?? '—', p.n == null ? '—' : p.n.toLocaleString('en-US'), fmtRate(p.r), p.rel == null ? '—' : `${Math.round(p.rel)}%`]) {
        const td = document.createElement('td'); td.textContent = v; tr.append(td);
      }
      tbl.append(tr);
    }
    t.append(tbl);
  });
}

async function main() {
  const get = (u, how) => fetch(u).then((r) => { if (!r.ok) throw new Error(`${u}: ${r.status}`); return r[how](); });
  try {
    const [d, tm, tsv, cm, terms] = await Promise.all([
      get('../data/presets.json', 'json'), get('../theses/data/meta.json', 'json'), get('../theses/data/theses.tsv', 'text'),
      get('../courses/data/meta.json', 'json'), get('../courses/data/terms.tsv', 'text'),
    ]);
    DAILY = d; TMETA = tm; ROWS = parseRows(tsv).rows; CMETA = cm; TABLE = parseTable(terms, cm.years.length).table;
  } catch (e) { setStatus('Could not load the data. Try reloading.', true); return; }
  const ul = $('presets');
  for (const p of PRESETS) {
    const li = document.createElement('li'); const b = document.createElement('button');
    b.type = 'button'; b.textContent = p; b.addEventListener('click', () => show(p));
    li.append(b); ul.append(li);
  }
  $('form').addEventListener('submit', (e) => { e.preventDefault(); show($('q').value); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') draw(); });
  let lastW = innerWidth;
  addEventListener('resize', () => { if (innerWidth !== lastW) { lastW = innerWidth; draw(); } });
  const st = decodeState(location.search);
  show(st ?? PRESETS[0], { push: !!st });
}

main();
