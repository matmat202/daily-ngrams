import {
  BINS, binLabel, parseTerms, countUrl, archiveUrl, rates, peak, niceTicks,
  fmtRate, encodeState, decodeState, mapLimit,
} from './ngram-logic.js';

const $ = (id) => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';
const COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];
// Drawn at the container's own pixel width (1 SVG unit = 1 CSS px), so axis text stays
// 11px on a phone instead of being scaled down with a fixed viewBox.
let W = 720, H = 320;
const M = { l: 44, r: 96, t: 12, b: 28 };

let DATA = null;           // site/data/presets.json
const cache = new Map();   // term -> counts[]
let current = [];          // [{term, counts, rates}]
let runId = 0;
let unpin = () => {}; // set by draw(); Escape closes a pinned tooltip

const el = (tag, attrs = {}, text) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
};

function setStatus(msg, err = false) {
  const s = $('status');
  s.textContent = msg;
  s.classList.toggle('err', err);
}

async function fetchCounts(term) {
  if (cache.has(term)) return cache.get(term);
  const counts = await mapLimit(BINS, 5, async (b) => {
    const r = await fetch(countUrl(term, b));
    if (!r.ok) throw new Error(`archive search answered ${r.status}`);
    const j = await r.json();
    const n = j && j.hits && j.hits.found;
    if (!Number.isFinite(n)) throw new Error('archive search sent an unexpected reply');
    return n;
  });
  cache.set(term, counts);
  return counts;
}

async function show(terms, { push = true } = {}) {
  const id = ++runId;
  $('q').value = terms.join(', ');
  for (const b of document.querySelectorAll('#presets button')) {
    b.setAttribute('aria-pressed', String(b.dataset.terms === terms.join(',')));
  }
  if (push) history.replaceState(null, '', location.pathname + encodeState(terms));
  if (!terms.length) { current = []; draw(); setStatus('Type a word to chart it.'); return; }
  const missing = terms.filter((t) => !cache.has(t));
  if (missing.length) setStatus(`Asking the archive about ${missing.map((t) => `“${t}”`).join(', ')}…`);
  const out = [];
  const failed = [];
  await Promise.all(terms.map(async (t, i) => {
    try { out[i] = { term: t, counts: await fetchCounts(t) }; }
    catch (e) { failed.push(`“${t}” (${e.message})`); }
  }));
  if (id !== runId) return; // a newer search started while this one was in flight
  current = out.map((s, i) => s && { ...s, slot: i, rates: rates(s.counts, DATA.totals) }).filter(Boolean);
  draw();
  if (failed.length) {
    setStatus(`Couldn't reach the archive's search for ${failed.join(', ')}. The examples above still work.`, true);
  } else {
    const none = current.filter((s) => s.counts.every((c) => c === 0)).map((s) => `“${s.term}”`);
    setStatus(none.length ? `${none.join(', ')}: not found in any article.` : '');
  }
}

function draw() {
  const box = $('chart');
  box.replaceChildren();
  const legend = $('legend');
  legend.replaceChildren();
  W = Math.max(300, Math.min(900, box.clientWidth || 720));
  const narrow = W < 520;
  H = narrow ? 250 : 320;
  M.r = narrow ? 74 : 96;
  const iw = W - M.l - M.r, ih = H - M.t - M.b;
  const max = Math.max(0, ...current.flatMap((s) => s.rates.filter((r) => r != null)));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const x = (i) => M.l + (iw * i) / (BINS.length - 1);
  const y = (r) => M.t + ih - (ih * r) / top;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img',
    'aria-label': current.length
      ? `Line chart, articles per 10,000 mentioning ${current.map((s) => s.term).join(', ')}, 1892 to 2014`
      : 'Empty chart' });

  const ax = el('g', { class: 'ax' });
  for (const t of ticks) {
    ax.append(el('line', { x1: M.l, x2: W - M.r, y1: y(t), y2: y(t), class: t === 0 ? 'base' : '' }));
    ax.append(el('text', { x: M.l - 6, y: y(t) + 4, 'text-anchor': 'end' }, fmtRate(t)));
  }
  BINS.forEach((b, i) => {
    if (b.y0 % (narrow ? 40 : 20) !== 0 && i !== 0) return;
    ax.append(el('text', { x: x(i), y: H - 8, 'text-anchor': 'middle' }, String(b.y0)));
  });
  svg.append(ax);

  const labels = [];
  for (const s of current) {
    const c = COLORS[s.slot];
    let d = '', pen = false;
    s.rates.forEach((r, i) => {
      if (r == null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(r).toFixed(1)}`;
      pen = true;
    });
    svg.append(el('path', { d, class: 'ln', stroke: c }));
    const last = s.rates.length - 1;
    if (s.rates[last] != null) labels.push({ s, y: y(s.rates[last]) });
    const p = peak(s.rates);
    const li = document.createElement('li');
    li.innerHTML = `<span class="sw" style="background:${c}"></span><span></span>` +
      `<span class="peak"></span>`;
    li.children[1].textContent = s.term;
    li.children[2].textContent = p == null ? '· never' : `· peak ${binLabel(BINS[p])}`;
    legend.append(li);
  }
  // Direct labels at the right end, pushed apart so two lines ending close don't overprint.
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 14);
  const over = labels.length ? labels[labels.length - 1].y - (H - M.b) : 0;
  if (over > 0) for (const l of labels) l.y -= over;
  for (const l of labels) {
    svg.append(el('text', { x: W - M.r + 8, y: l.y + 4, class: 'lab' }, l.s.term.length > 13 ? l.s.term.slice(0, 12) + '…' : l.s.term));
  }

  const cross = el('line', { class: 'cross', y1: M.t, y2: M.t + ih, x1: -10, x2: -10, visibility: 'hidden' });
  svg.append(cross);
  const dots = el('g');
  svg.append(dots);
  const hit = el('g', { fill: 'transparent' });
  const step = iw / (BINS.length - 1);
  BINS.forEach((b, i) => {
    const r = el('rect', { x: x(i) - step / 2, y: M.t, width: step, height: ih + M.b, 'data-i': i });
    hit.append(r);
  });
  svg.append(hit);
  box.append(svg);

  const tip = document.createElement('div');
  tip.className = 'tip';
  box.append(tip);
  let pinned = -1;
  const focus = (i) => {
    if (i < 0 || !current.length) { cross.setAttribute('visibility', 'hidden'); dots.replaceChildren(); tip.classList.remove('on'); return; }
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i));
    cross.setAttribute('visibility', 'visible');
    dots.replaceChildren(...current.filter((s) => s.rates[i] != null)
      .map((s) => el('circle', { cx: x(i), cy: y(s.rates[i]), r: 4.5, class: 'dot', fill: COLORS[s.slot] })));
    const b = BINS[i];
    tip.innerHTML = `<h3>${b.y0}–${b.y1}</h3><table></table><div class="links"></div>` +
      `<div style="font-size:11px;color:var(--ink-3);margin-top:4px">${DATA.totals[i].toLocaleString('en-US')} articles that period</div>`;
    const tb = tip.querySelector('table');
    const links = tip.querySelector('.links');
    for (const s of [...current].sort((a, c) => (c.rates[i] ?? -1) - (a.rates[i] ?? -1))) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><span class="sw" style="background:${COLORS[s.slot]}"></span></td><td class="v"></td>`;
      tr.children[0].append(s.term);
      tr.children[1].textContent = `${fmtRate(s.rates[i])}  (${s.counts[i].toLocaleString('en-US')})`;
      tb.append(tr);
      if (s.counts[i] > 0) {
        const a = document.createElement('a');
        a.href = archiveUrl(s.term, b); a.target = '_blank'; a.rel = 'noopener';
        a.textContent = `Read “${s.term}”, ${b.y0}–${b.y1} →`;
        links.append(a);
      }
    }
    const rect = box.getBoundingClientRect();
    const px = (x(i) / W) * rect.width;
    tip.classList.add('on');
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.max(0, Math.min(rect.width - tw, px + (px > rect.width / 2 ? -tw - 12 : 12)))}px`;
    tip.style.top = '8px';
  };
  hit.addEventListener('pointermove', (e) => { if (pinned < 0 && e.pointerType === 'mouse') focus(+e.target.dataset.i); });
  hit.addEventListener('pointerleave', (e) => { if (pinned < 0 && e.pointerType === 'mouse') focus(-1); });
  hit.addEventListener('click', (e) => {
    const i = +e.target.dataset.i;
    pinned = pinned === i ? -1 : i;
    focus(pinned < 0 ? i : pinned);
  });
  unpin = () => { pinned = -1; focus(-1); };

  drawTable();
}

function drawTable() {
  const t = $('table');
  if (!current.length) { t.replaceChildren(); return; }
  const tbl = document.createElement('table');
  const head = document.createElement('tr');
  head.innerHTML = '<th>Years</th><th>Articles</th>';
  for (const s of current) { const th = document.createElement('th'); th.textContent = `${s.term} / 10k`; head.append(th); }
  tbl.append(head);
  BINS.forEach((b, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${b.y0}–${b.y1}</td><td>${DATA.totals[i].toLocaleString('en-US')}</td>`;
    for (const s of current) { const td = document.createElement('td'); td.textContent = fmtRate(s.rates[i]); tr.append(td); }
    tbl.append(tr);
  });
  t.replaceChildren(tbl);
}

async function main() {
  try {
    DATA = await (await fetch('data/presets.json')).json();
  } catch (e) {
    setStatus('Could not load the chart data. Try reloading.', true);
    return;
  }
  for (const [w, c] of Object.entries(DATA.counts)) cache.set(w, c);
  const ul = $('presets');
  for (const p of DATA.presets) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = p.label; b.dataset.terms = p.terms.join(',');
    b.addEventListener('click', () => show(p.terms));
    li.append(b); ul.append(li);
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') unpin(); });
  $('form').addEventListener('submit', (e) => { e.preventDefault(); show(parseTerms($('q').value)); });
  let lastW = innerWidth;
  addEventListener('resize', () => { if (innerWidth !== lastW) { lastW = innerWidth; draw(); } });
  const fromUrl = decodeState(location.search);
  await show(fromUrl && fromUrl.length ? fromUrl : DATA.presets[0].terms, { push: !!fromUrl });
}

main();
