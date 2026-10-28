import {
  QUARTERS, filter, group, schoolCounts, courseUrl, yearLabel, nextQuarter, readState, writeState,
  unitsLabel, haystack,
} from './new-logic.js';

const $ = (id) => document.getElementById(id);
const num = (n) => n.toLocaleString('en-US');
let DATA = null;
let state = { q: '', quarter: '', school: '', ger: '' };

const h = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) n.append(k);
  return n;
};

function setStatus(msg, err = false) {
  $('status').textContent = msg;
  $('status').classList.toggle('err', err);
}

function card(c) {
  const meta = h('div', { class: 'meta' });
  for (const q of c.q) meta.append(h('span', { class: 'chip q', text: q }));
  if (!c.q.length) meta.append(h('span', { class: 'chip', text: 'not scheduled yet' }));
  if (c.u) meta.append(h('span', { class: 'chip', text: unitsLabel(c.u) }));
  for (const g of c.g) meta.append(h('span', { class: 'chip', text: g }));
  return h('li', { class: 'course' },
    h('div', { class: 't' }, h('a', { href: courseUrl(c.codes[0], DATA.meta.year), text: c.t })),
    h('div', { class: 'codes', text: c.codes.join(' · ') }),
    meta,
    c.d ? h('p', { text: c.d }) : null,
    c.i.length ? h('div', { class: 'who', text: c.i.join('; ') }) : null);
}

function render() {
  const hits = filter(DATA.courses, state);
  const out = $('out');
  out.replaceChildren();
  for (const s of group(hits)) {
    out.append(h('h2', {}, s.school + ' ', h('span', { class: 'n', text: num(s.n) })));
    for (const d of s.depts) {
      out.append(h('h3', {}, d.dept + ' ', h('span', { class: 'n', text: num(d.courses.length) })));
      out.append(h('ul', { class: 'list' }, ...d.courses.map(card)));
    }
  }
  const all = DATA.courses.length;
  const where = [state.quarter === 'none' ? 'not yet scheduled' : state.quarter && `in ${state.quarter}`,
    state.school && `in ${state.school}`, state.ger && 'fulfilling a Ways requirement',
    state.q && `matching “${state.q}”`].filter(Boolean).join(', ');
  setStatus(hits.length === all ? `${num(all)} new courses.`
    : hits.length ? `${num(hits.length)} of ${num(all)} new courses ${where}.`
      : `No new course ${where}. Try fewer words or another quarter.`);
  for (const b of $('quarters').querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(b.dataset.q === state.quarter));
  }
  history.replaceState(null, '', location.pathname + writeState(state));
}

function build() {
  const m = DATA.meta;
  for (const c of DATA.courses) c._h = haystack(c);
  $('yl').textContent = yearLabel(m.year);
  $('titles').textContent = num(m.titles);
  $('n').textContent = num(m.n);
  $('built').textContent = m.built;
  $('hist').textContent = Object.entries(m.history).filter(([y]) => y !== m.year)
    .map(([y, n]) => `${yearLabel(y)} ${num(n)}`).join(', ');

  const counts = Object.fromEntries(QUARTERS.map((q) => [q, DATA.courses.filter((c) => c.q.includes(q)).length]));
  const none = DATA.courses.filter((c) => !c.q.length).length;
  const qs = $('quarters');
  for (const [q, label] of [['', 'Any quarter'], ...QUARTERS.filter((q) => counts[q]).map((q) => [q, `${q} ${counts[q]}`]),
    ...(none ? [['none', `Not scheduled ${none}`]] : [])]) {
    const b = h('button', { type: 'button', 'data-q': q, 'aria-pressed': 'false', text: label });
    b.addEventListener('click', () => { state.quarter = q; render(); });
    qs.append(h('li', {}, b));
  }
  const sel = $('school');
  const schools = schoolCounts(DATA.courses);
  for (const { school, n } of schools) sel.append(h('option', { value: school, text: `${school} (${n})` }));

  state = readState(location.search, schools.map((s) => s.school));
  if (!state.explicit) state.quarter = nextQuarter(Date.now(), m.year);
  $('q').value = state.q;
  sel.value = state.school;
  $('ways').checked = state.ger === 'WAY-';

  let t = 0;
  $('q').addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => { state.q = $('q').value.trim(); render(); }, 120);
  });
  sel.addEventListener('change', () => { state.school = sel.value; render(); });
  $('ways').addEventListener('change', () => { state.ger = $('ways').checked ? 'WAY-' : ''; render(); });
  render();
}

fetch('data/new.json')
  .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
  .then((d) => { DATA = d; build(); })
  .catch((e) => setStatus(`Could not load the list (${e.message}). Reload to try again.`, true));
