import {
  BINS, binLabel, parseTerms, countUrl, archiveUrl, rates, peak, niceTicks,
  fmtRate, encodeState, decodeState, mapLimit, yearBins, yearRates,
  isWeb, scaled, webCounts,
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
const yearCache = new Map(); // `${term}|${bin index}` -> that bin's per-year counts[]
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

async function fetchCount(term, b) {
  if (isWeb(b)) {
    if (!webCounts(term)) return null; // a phrase: WordPress would count its words apart
    const r = await fetch(countUrl(term, b));
    if (!r.ok) throw new Error(`stanforddaily.com answered ${r.status}`);
    const n = Number(r.headers.get('X-WP-Total'));
    if (!Number.isInteger(n) || n < 0) throw new Error('stanforddaily.com sent no count');
    return n;
  }
  const r = await fetch(countUrl(term, b));
  if (!r.ok) throw new Error(`archive search answered ${r.status}`);
  const j = await r.json();
  const n = j && j.hits && j.hits.found;
  if (!Number.isFinite(n)) throw new Error('archive search sent an unexpected reply');
  return n;
}

async function fetchCounts(term) {
  if (cache.has(term)) return cache.get(term);
  const counts = await mapLimit(BINS, 5, (b) => fetchCount(term, b));
  cache.set(term, counts);
  return counts;
}

// Only a clicked (pinned) period asks for its years, never a hover: up to 5 requests per
// word, on intent, so a mouse sweeping the chart doesn't fire 125 at a student paper.
async function fetchYears(term, i) {
  const k = `${term}|${i}`;
  if (!yearCache.has(k)) yearCache.set(k, mapLimit(yearBins(BINS[i]), 5, (b) => fetchCount(term, b)));
  try { return await yearCache.get(k); }
  catch (e) { yearCache.delete(k); throw e; } // a failed fetch may be retried by the next click
}

async function drawYears(box, i, isCurrent) {
  const series = current.filter((s) => s.counts[i] > 0);
  if (!series.length) { box.textContent = ''; return; }
  box.textContent = isWeb(BINS[i]) ? 'Asking stanforddaily.com for each year…' : 'Asking the archive for each year…';
  let got;
  try {
    got = await Promise.all(series.map(async (s) => ({ s, rates: yearRates(await fetchYears(s.term, i), BINS[i], DATA.yearTotals, DATA.webScale) })));
  } catch (e) {
    if (isCurrent()) box.textContent = `Couldn't fetch the years (${e.message}).`;
    return;
  }
  if (!isCurrent()) return; // another period was pinned meanwhile
  const ys = yearBins(BINS[i]);
  const tbl = document.createElement('table');
  tbl.className = 'yrs';
  tbl.setAttribute('aria-label', `Articles per 10,000, each year ${ys[0].y0} to ${ys.at(-1).y0}`);
  const max = got.map((g) => Math.max(...g.rates.filter((r) => r != null), 0));
  ys.forEach((y, k) => {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = String(y.y0);
    tr.append(th);
    got.forEach((g, j) => {
      const r = g.rates[k];
      const td = document.createElement('td');
      const bar = document.createElement('span');
      bar.className = 'bar';
      bar.style.background = COLORS[g.s.slot];
      bar.style.width = `${max[j] > 0 && r != null ? Math.max(2, (r / max[j]) * 100) : 0}%`;
      const v = document.createElement('span');
      v.className = 'v';
      v.textContent = fmtRate(r);
      if (r != null && r === max[j] && max[j] > 0) td.classList.add('top');
      td.append(bar, v);
      td.title = `${g.s.term}, ${y.y0}`;
      tr.append(td);
    });
    tbl.append(tr);
  });
  box.replaceChildren(tbl);
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
  current = out.map((s, i) => s && { ...s, slot: i, rates: scaled(rates(s.counts, DATA.totals), BINS, DATA.webScale) }).filter(Boolean);
  draw();
  if (failed.length) {
    setStatus(`Couldn't reach the archive's search for ${failed.join(', ')}. The examples above still work.`, true);
  } else {
    const none = current.filter((s) => s.counts.every((c) => !c)).map((s) => `“${s.term}”`);
    const phrases = current.filter((s) => !webCounts(s.term)).map((s) => `“${s.term}”`);
    setStatus(none.length ? `${none.join(', ')}: not found in any article.`
      : phrases.length ? `${phrases.join(', ')}: phrases stop at 2014. The web site's search can't match a phrase, only its words.` : '');
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
      ? `Line chart, articles per 10,000 mentioning ${current.map((s) => s.term).join(', ')}, ${BINS[0].y0} to ${BINS.at(-1).y1}`
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
  // The seam: scans to the left, the paper's web site to the right.
  const seam = BINS.findIndex(isWeb);
  if (seam > 0) {
    const sx = (x(seam - 1) + x(seam)) / 2;
    ax.append(el('line', { x1: sx, x2: sx, y1: M.t, y2: M.t + ih, class: 'seam' }));
    ax.append(el('text', { x: sx + 4, y: M.t + 10, 'text-anchor': 'start', class: 'seamlab' }, 'web'));
  }
  svg.append(ax);

  const labels = [];
  for (const s of current) {
    const c = COLORS[s.slot];
    // Two paths: solid over the scans, dashed from the last scanned period on, so the
    // change of source shows in the line itself and not only in a footnote.
    const path = (from, to) => {
      let d = '', pen = false;
      for (let i = from; i <= to; i++) {
        const r = s.rates[i];
        if (r == null) { pen = false; continue; }
        d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(r).toFixed(1)}`;
        pen = true;
      }
      return d;
    };
    const cut = seam > 0 ? seam - 1 : BINS.length - 1;
    svg.append(el('path', { d: path(0, cut), class: 'ln', stroke: c }));
    if (seam > 0) svg.append(el('path', { d: path(cut, BINS.length - 1), class: 'ln web', stroke: c }));
    // Direct labels only for lines that reach the right edge: a phrase stops at 2014, and a
    // label out at 2026 would claim a value there. The legend still names it.
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
    const web = isWeb(b);
    tip.innerHTML = `<h3>${b.y0}–${b.y1}${web ? ' · web' : ''}</h3><table></table><div class="links"></div>` +
      `<div style="font-size:11px;color:var(--ink-3);margin-top:4px">${DATA.totals[i].toLocaleString('en-US')} ${web ? 'posts on stanforddaily.com' : 'articles'} that period</div>` +
      `<div class="years">${pinned === i ? '' : 'Click to see each year.'}</div>`;
    const tb = tip.querySelector('table');
    const links = tip.querySelector('.links');
    for (const s of [...current].sort((a, c) => (c.rates[i] ?? -1) - (a.rates[i] ?? -1))) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><span class="sw" style="background:${COLORS[s.slot]}"></span></td><td class="v"></td>`;
      tr.children[0].append(s.term);
      tr.children[1].textContent = s.counts[i] == null ? 'phrase: not counted' : `${fmtRate(s.rates[i])}  (${s.counts[i].toLocaleString('en-US')})`;
      tb.append(tr);
      if (s.counts[i] > 0) {
        const a = document.createElement('a');
        a.href = archiveUrl(s.term, b); a.target = '_blank'; a.rel = 'noopener';
        a.textContent = web ? `Search “${s.term}” on stanforddaily.com →` : `Read “${s.term}”, ${b.y0}–${b.y1} →`;
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
    if (pinned >= 0) {
      const want = pinned;
      drawYears(tip.querySelector('.years'), want, () => pinned === want && tip.isConnected);
    }
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
  if (DATA.webScale > 0) $('scale').textContent = DATA.webScale.toFixed(2);
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
