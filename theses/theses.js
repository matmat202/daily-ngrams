import {
  bins, binLabel, parseTerms, parseRows, totals, counts, rates, examples, peak, niceTicks,
  fmtRate, encodeState, decodeState, VIEW,
} from './thesis-logic.js';

const $ = (id) => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';
const COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];
// Drawn at the container's own pixel width (1 SVG unit = 1 CSS px), as on the Daily page.
let W = 720, H = 320;
const M = { l: 44, r: 96, t: 12, b: 28 };

let META = null, ROWS = [], BINS = [];
let dept = -1;            // index into META.depts, -1 for every department
let TOT = [];             // titles per bin for the current department
let current = [];         // [{term, slot, counts, rates}]
let unpin = () => {};

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

function show(terms, { push = true } = {}) {
  $('q').value = terms.join(', ');
  for (const b of document.querySelectorAll('#presets button')) {
    b.setAttribute('aria-pressed', String(b.dataset.terms === terms.join(',')));
  }
  if (push) history.replaceState(null, '', location.pathname + encodeState(terms, dept >= 0 ? META.depts[dept] : ''));
  TOT = totals(ROWS, BINS, dept);
  current = terms.map((term, slot) => {
    const cs = counts(ROWS, BINS, term, dept);
    return { term, slot, counts: cs, rates: rates(cs, TOT) };
  });
  draw();
  if (!terms.length) { setStatus('Type a word to chart it.'); return; }
  const none = current.filter((s) => s.counts.every((c) => !c)).map((s) => `“${s.term}”`);
  const where = dept >= 0 ? ` in ${META.depts[dept]}` : '';
  setStatus(none.length ? `${none.join(', ')}: in no thesis title${where}.` : '');
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
      ? `Line chart, thesis titles per 1,000 containing ${current.map((s) => s.term).join(', ')}, ${BINS[0].y0} to ${BINS.at(-1).y1}`
      : 'Empty chart' });

  const ax = el('g', { class: 'ax' });
  for (const t of ticks) {
    ax.append(el('line', { x1: M.l, x2: W - M.r, y1: y(t), y2: y(t), class: t === 0 ? 'base' : '' }));
    ax.append(el('text', { x: M.l - 6, y: y(t) + 4, 'text-anchor': 'end' }, fmtRate(t)));
  }
  BINS.forEach((b, i) => {
    const round = b.y0 - (b.y0 % 5);
    if (round % (narrow ? 40 : 20) !== 0) return;
    ax.append(el('text', { x: x(i), y: H - 8, 'text-anchor': 'middle' }, String(round)));
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
    li.innerHTML = '<span class="sw"></span><span></span><span class="peak"></span>';
    li.children[0].style.background = c;
    li.children[1].textContent = s.term;
    const n = s.counts.reduce((a, b) => a + b, 0);
    li.children[2].textContent = p == null ? '· never' : `· peak ${binLabel(BINS[p])} · ${n.toLocaleString('en-US')} titles`;
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
  const step = iw / (BINS.length - 1);
  BINS.forEach((b, i) => hit.append(el('rect', { x: x(i) - step / 2, y: M.t, width: step, height: ih + M.b, 'data-i': i })));
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
    tip.innerHTML = `<h3></h3><table></table>` +
      `<div style="font-size:11px;color:var(--ink-3);margin-top:4px"></div><div class="ex"></div>`;
    tip.querySelector('h3').textContent = `${b.y0}–${b.y1}`;
    tip.children[2].textContent = `${TOT[i].toLocaleString('en-US')} theses that period${dept >= 0 ? ' in this department' : ''}`;
    const tb = tip.querySelector('table');
    const sorted = [...current].sort((a, c) => (c.rates[i] ?? -1) - (a.rates[i] ?? -1));
    for (const s of sorted) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td><span class="sw"></span></td><td class="v"></td>';
      tr.querySelector('.sw').style.background = COLORS[s.slot];
      tr.children[0].append(s.term);
      tr.children[1].textContent = `${fmtRate(s.rates[i])}  (${s.counts[i].toLocaleString('en-US')})`;
      tb.append(tr);
    }
    const ex = tip.querySelector('.ex');
    if (pinned !== i) { ex.textContent = current.some((s) => s.counts[i] > 0) ? 'Click to read the titles.' : ''; }
    else {
      for (const s of sorted) {
        const list = examples(ROWS, BINS, i, s.term, dept, 3);
        if (!list.length) continue;
        const ul = document.createElement('ul');
        ul.style.listStyle = 'none';
        ul.style.padding = '0';
        for (const r of list) {
          const li = document.createElement('li');
          const a = document.createElement('a');
          a.href = VIEW + encodeURIComponent(r.id); a.target = '_blank'; a.rel = 'noopener';
          a.textContent = `${r.title} (${r.year})`;
          a.style.borderLeft = `3px solid ${COLORS[s.slot]}`;
          a.style.paddingLeft = '6px';
          li.append(a); ul.append(li);
        }
        ex.append(ul);
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
  head.innerHTML = '<th>Years</th><th>Theses</th>';
  for (const s of current) { const th = document.createElement('th'); th.textContent = `${s.term} / 1k`; head.append(th); }
  tbl.append(head);
  BINS.forEach((b, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${b.y0}–${b.y1}</td><td>${TOT[i].toLocaleString('en-US')}</td>`;
    for (const s of current) { const td = document.createElement('td'); td.textContent = fmtRate(s.rates[i]); tr.append(td); }
    tbl.append(tr);
  });
  t.replaceChildren(tbl);
}

async function main() {
  try {
    const [m, tsv] = await Promise.all([
      fetch('data/meta.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
      fetch('data/theses.tsv').then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); }),
    ]);
    META = m;
    ROWS = parseRows(tsv).rows;
  } catch (e) {
    setStatus('Could not load the data. Try reloading.', true);
    return;
  }
  BINS = bins(META.chartFirst, META.last);
  $('early').textContent = `The ${META.before.toLocaleString('en-US')} theses from ${META.first}–${META.chartFirst - 1} are too few to chart.`;
  $('count').textContent = META.count.toLocaleString('en-US');
  $('built').textContent = META.built;
  const sel = $('dept');
  // no department pass yet: no filter, not an empty one (.row's display:flex beats [hidden])
  if (!META.depts.length) sel.parentNode.style.display = 'none';
  META.depts.forEach((d, k) => {
    const o = document.createElement('option');
    o.value = String(k);
    o.textContent = `${d} (${META.deptCounts[k].toLocaleString('en-US')})`;
    sel.append(o);
  });
  const ul = $('presets');
  for (const p of META.presets) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = p.label; b.dataset.terms = p.terms.join(',');
    b.addEventListener('click', () => show(p.terms));
    li.append(b); ul.append(li);
  }
  const terms = () => parseTerms($('q').value);
  sel.addEventListener('change', () => { dept = +sel.value; show(terms()); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') unpin(); });
  $('form').addEventListener('submit', (e) => { e.preventDefault(); show(terms()); });
  let lastW = innerWidth;
  addEventListener('resize', () => { if (innerWidth !== lastW) { lastW = innerWidth; draw(); } });
  const st = decodeState(location.search, META.depts);
  dept = st.dept;
  sel.value = String(dept);
  show(st.terms && st.terms.length ? st.terms : META.presets[0].terms, { push: !!st.terms });
}

main();
