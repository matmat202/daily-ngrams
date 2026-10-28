import {
  parseTerms, parseTable, lookup, rates, change, fmtChange, searchUrl, peak, niceTicks, fmtRate,
  encodeState, decodeState, decodeGroup, menu,
} from './course-logic.js';

const $ = (id) => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';
const COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];
// Drawn at the container's own pixel width (1 SVG unit = 1 CSS px), as on the Daily page.
let W = 720, H = 320;
const M = { l: 44, r: 96, t: 12, b: 28 };

let META = null, TABLE = new Map(), YEARS = [];
let ALL = null;           // all of Stanford's table, kept while a group is picked
let GROUP = null;         // META.groups entry, or null for all of Stanford
let TOTALS = [];          // course totals per year for GROUP (or all)
const LOADED = new Map(); // group file -> table, fetched once
let current = [];         // [{term, slot, counts, rates}]; counts null when under the floor
let lastTerms = [];
let unpin = () => {};

const el = (tag, attrs = {}, text) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
};
const num = (n) => n.toLocaleString('en-US');

function setStatus(msg, err = false) {
  const s = $('status');
  s.textContent = msg;
  s.classList.toggle('err', err);
}

function show(terms, { push = true, refused = [] } = {}) {
  $('q').value = terms.join(', ');
  $('refused').textContent = refused.map((r) => `“${r.raw}”: ${r.why}.`).join(' ');
  for (const b of document.querySelectorAll('#presets button')) {
    b.setAttribute('aria-pressed', String(b.dataset.terms === terms.join(',')));
  }
  lastTerms = terms;
  if (push) history.replaceState(null, '', location.pathname + encodeState(terms, GROUP?.id));
  current = terms.map((term, slot) => {
    const cs = lookup(TABLE, term);
    return { term, slot, counts: cs, rates: cs ? rates(cs, TOTALS) : TOTALS.map(() => null) };
  });
  draw();
  if (!terms.length) { setStatus('Type a word to chart it.'); return; }
  const rare = current.filter((s) => !s.counts).map((s) => `“${s.term}”`);
  const floor = GROUP ? META.groupMin : META.minDocs;
  setStatus(rare.length ? `${rare.join(', ')}: used by fewer than ${floor} courses${GROUP ? ` in ${GROUP.label}` : ''} in all ${YEARS.length} years, too rare to chart.` : '');
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
  const x = (i) => M.l + (iw * i) / (YEARS.length - 1);
  const y = (r) => M.t + ih - (ih * r) / top;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img',
    'aria-label': current.length
      ? `Line chart, ${GROUP ? GROUP.label : 'Stanford'} courses per 1,000 using ${current.map((s) => s.term).join(', ')}, ${YEARS[0]} to ${YEARS.at(-1)}`
      : 'Empty chart' });

  const ax = el('g', { class: 'ax' });
  for (const t of ticks) {
    ax.append(el('line', { x1: M.l, x2: W - M.r, y1: y(t), y2: y(t), class: t === 0 ? 'base' : '' }));
    ax.append(el('text', { x: M.l - 6, y: y(t) + 4, 'text-anchor': 'end' }, fmtRate(t)));
  }
  YEARS.forEach((label, i) => {
    const y0 = Number(label.slice(0, 4));
    if (y0 % (narrow ? 5 : 2) !== 0 && i !== YEARS.length - 1) return;
    if (i === YEARS.length - 2 && y0 % (narrow ? 5 : 2) !== 0) return;
    ax.append(el('text', { x: x(i), y: H - 8, 'text-anchor': 'middle' }, narrow ? String(y0) : label));
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
    if (d) svg.append(el('path', { d, class: 'ln', stroke: c }));
    const last = s.rates.length - 1;
    if (s.rates[last] != null) labels.push({ s, y: y(s.rates[last]) });
    const li = document.createElement('li');
    li.innerHTML = '<span class="sw"></span><span></span><span class="chg"></span>';
    li.children[0].style.background = c;
    li.children[1].textContent = s.term;
    if (!s.counts) li.children[2].textContent = '· too rare to chart';
    else {
      const p = peak(s.rates);
      const k = fmtChange(change(s.rates));
      li.children[2].textContent = p == null ? '· never'
        : `· peak ${YEARS[p]}${k ? ` · ${k} since ${YEARS[0]}` : ''}`;
    }
    legend.append(li);
  }
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
  const step = iw / (YEARS.length - 1);
  YEARS.forEach((_, i) => hit.append(el('rect', { x: x(i) - step / 2, y: M.t, width: step, height: ih + M.b, 'data-i': i })));
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
    tip.innerHTML = '<h3></h3><table></table><div style="font-size:11px;color:var(--ink-3);margin-top:4px"></div><div class="ex"></div>';
    tip.querySelector('h3').textContent = YEARS[i];
    tip.children[2].textContent = GROUP
      ? `${num(TOTALS[i])} ${GROUP.label} courses that year`
      : `${num(TOTALS[i])} courses that year · median description ${META.medianWords[i]} words`;
    const tb = tip.querySelector('table');
    const sorted = [...current].sort((a, c) => (c.rates[i] ?? -1) - (a.rates[i] ?? -1));
    for (const s of sorted) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td><span class="sw"></span></td><td class="v"></td>';
      tr.querySelector('.sw').style.background = COLORS[s.slot];
      tr.children[0].append(s.term);
      tr.children[1].textContent = s.counts ? `${fmtRate(s.rates[i])}  (${num(s.counts[i])})` : 'too rare';
      tb.append(tr);
    }
    const ex = tip.querySelector('.ex');
    if (pinned !== i) ex.textContent = current.some((s) => s.counts?.[i] > 0) ? 'Click for links to the courses.' : '';
    else {
      for (const s of sorted) {
        if (!s.counts?.[i]) continue;
        const a = document.createElement('a');
        a.href = searchUrl(s.term, YEARS[i], GROUP?.kind === 'dept' ? GROUP.id : ''); a.target = '_blank'; a.rel = 'noopener';
        a.textContent = `“${s.term}” in ExploreCourses, ${YEARS[i]}`;
        a.style.borderLeft = `3px solid ${COLORS[s.slot]}`;
        a.style.paddingLeft = '6px';
        ex.append(a);
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
  head.innerHTML = '<th>Year</th><th>Courses</th>';
  for (const s of current) { const th = document.createElement('th'); th.textContent = `${s.term} / 1k`; head.append(th); }
  tbl.append(head);
  YEARS.forEach((label, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${label}</td><td>${num(TOTALS[i])}</td>`;
    for (const s of current) { const td = document.createElement('td'); td.textContent = fmtRate(s.rates[i]); tr.append(td); }
    tbl.append(tr);
  });
  t.replaceChildren(tbl);
}

/* Switch the chart to a group (null = all of Stanford). Its table is fetched on first use;
 * while it loads, the old chart stays up rather than flashing "too rare". */
async function pick(g, { push = true } = {}) {
  const sel = $('grp');
  if (g) {
    if (!LOADED.has(g.file)) {
      setStatus(`Loading ${g.label}…`);
      try {
        const r = await fetch(`data/g/${g.file}`);
        if (!r.ok) throw new Error(r.status);
        LOADED.set(g.file, parseTable(await r.text(), YEARS.length).table);
      } catch (e) {
        setStatus(`Could not load ${g.label}. Try again.`, true);
        sel.value = GROUP ? GROUP.id : '';
        return;
      }
    }
    TABLE = LOADED.get(g.file);
    TOTALS = g.totals;
  } else {
    TABLE = ALL;
    TOTALS = META.totals;
  }
  GROUP = g;
  sel.value = g ? g.id : '';
  $('where').textContent = g ? `${g.label}${g.kind === 'dept' ? ` (${g.id})` : ''}` : 'Stanford';
  show(lastTerms, { push });
}

async function main() {
  try {
    const [m, tsv] = await Promise.all([
      fetch('data/meta.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
      fetch('data/terms.tsv').then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); }),
    ]);
    META = m;
    YEARS = META.years;
    TABLE = ALL = parseTable(tsv, YEARS.length).table;
    TOTALS = META.totals;
  } catch (e) {
    setStatus('Could not load the data. Try reloading.', true);
    return;
  }
  $('range').textContent = `${num(META.totals[0])} in ${YEARS[0]}, ${num(META.totals.at(-1))} in ${YEARS.at(-1)}`;
  $('len0').textContent = META.medianWords[0];
  $('len1').textContent = META.medianWords.at(-1);
  $('built').textContent = META.built;
  $('min').textContent = META.minDocs;
  $('gmin').textContent = META.groupMin ?? '';
  const ul = $('presets');
  for (const p of META.presets) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = p.label; b.dataset.terms = p.terms.join(',');
    b.addEventListener('click', () => show(p.terms));
    li.append(b); ul.append(li);
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') unpin(); });
  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const { terms, refused } = parseTerms($('q').value);
    show(terms, { refused });
  });
  let lastW = innerWidth;
  addEventListener('resize', () => { if (innerWidth !== lastW) { lastW = innerWidth; draw(); } });
  const sel = $('grp');
  for (const sec of menu(META.groups || [])) {
    const og = document.createElement('optgroup');
    og.label = sec.label;
    for (const g of sec.groups) {
      const o = document.createElement('option');
      o.value = g.id;
      o.textContent = g.kind === 'dept' ? `${g.label} (${g.id})` : g.label;
      og.append(o);
    }
    sel.append(og);
  }
  if (!META.groups?.length) sel.parentNode.style.display = 'none';
  sel.addEventListener('change', () => pick((META.groups || []).find((g) => g.id === sel.value) ?? null));
  const st = decodeState(location.search);
  const g0 = decodeGroup(location.search, META.groups);
  lastTerms = st && st.length ? st : META.presets[0].terms;
  if (g0) await pick(g0, { push: !!st });
  else show(lastTerms, { push: !!st });
}

main();
