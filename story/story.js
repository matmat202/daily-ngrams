/* The scrolling story: each <section class="step"> names a layout in data-step; as the
 * reader scrolls into a step, the chart redraws in that layout. Numbers in the prose are
 * not typed in: a <b data-fact="..."> is computed here from story.json, and
 * test/story.test.mjs checks each against the `check` block build_story.py computed in
 * python. Modelled on crypto-lifetimes/site/story. */
import { layout, stats, STEPS } from './layout.js';

/* a ratio as "one in N" reads better than 0.144 */
const oneIn = (r) => `one for every ${Math.round(1 / r)}`;
const pct = (r) => `${Math.round(r * 100)}%`;
const n = (v) => v.toLocaleString('en-US');

/* Unknown names throw: a typo must not render as blank */
export function fact(D, f) {
  const S = stats(D);
  switch (f) {
    case 'sh_before': case 'hh_before': return oneIn(S[f]);
    case 'wm_before': case 'sh_band_lo': case 'sh_band_hi': case 'peace_max': case 'war_peak': case 'after_min':
    case 'wm_after_lo': case 'wm_after_hi': case 'wo_max': case 'sh_end': case 'hh_end': case 'sh_before_pct': return pct(S[f === 'sh_before_pct' ? 'sh_before' : f]);
    case 'tot_lo': case 'tot_hi': case 'n_articles': return n(S[f]);
    case 'peace_max_year': case 'war_peak_year': case 'past_war': case 'wm_first_par': case 'wo_max_year': case 'first': case 'last': return String(S[f]);
    case 'wm_parity_before': return S[f].join(' and ');
    case 'fold': return `${Math.round(S.fold)} times`;
    case 'fetched': return D.fetched;
    default: throw new Error(`unknown fact ${f}`);
  }
}

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

async function main() {
  const D = await (await fetch('story.json')).json();
  for (const e of document.querySelectorAll('[data-fact]')) e.textContent = fact(D, e.dataset.fact);
  const steps = [...document.querySelectorAll('.step')];
  for (const s of steps) if (!STEPS[s.dataset.step]) throw new Error(`unknown step ${s.dataset.step}`);
  const plot = document.getElementById('plot');
  const svg = el('svg', { id: 'chart' });
  const gAxis = el('g', { class: 'axis' }), gS = el('g'), gLab = el('g', { class: 'labels' });
  svg.append(gAxis, gS, gLab);
  plot.append(svg);
  const tick = (g, x, y, text, cls = 'tick') => { const t = el('text', { x, y, class: cls }); t.textContent = text; g.append(t); };
  const grid = (x1, y1, x2, y2, cls = 'grid') => gAxis.append(el('line', { x1, x2, y1, y2, class: cls }));

  let shown = -1;
  const draw = (i) => {
    const name = steps[i].dataset.step;
    const box = plot.getBoundingClientRect(), W = box.width, H = box.height;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const L = layout(name, D, W, H);
    const narrow = W < 420;
    gAxis.replaceChildren(); gLab.replaceChildren();
    for (const [v, label] of L.xt) { grid(L.X(v), L.T, L.X(v), L.B); tick(gAxis, L.X(v), L.B + 15, label, 'tick mid'); }
    for (const [v, label] of L.yt) { grid(L.L, L.Y(v), L.R, L.Y(v)); tick(gAxis, L.L - 5, L.Y(v) + 4, label, 'tick end'); }
    grid(L.L, L.B, L.R, L.B, 'grid axisline');
    const cap = {
      groups: narrow ? '“women” per “men”, by year' : 'articles saying “women” for each saying “men”, by year',
      she: narrow ? '…and “she” per “he”' : 'the same, and articles saying “she” for each saying “he”',
      war: narrow ? 'the war years shaded' : 'the same, with 1942–1946 shaded',
      turn: narrow ? '“she” per “he”, “her” per “his”' : '“she” per “he” (red) and “her” per “his” (dark), after 1970 shaded',
    }[name];
    tick(gAxis, 4, L.T - 10, cap, 'tick cat');
    for (const [x, y, text, cls] of L.labs) tick(gLab, x, y, text, cls);
    gS.replaceChildren();
    for (const m of L.marks) {
      const e = m.kind === 'line'
        ? el('polyline', { points: m.pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '), class: `ln ${m.cls}` })
        : el('rect', { x: m.x, y: m.y, width: Math.max(0, m.w), height: Math.max(0, m.h), class: m.cls });
      if (m.tip) { e.append(el('title')); e.firstChild.textContent = m.tip; }
      gS.append(e);
    }
    document.body.dataset.step = i;
    window.__story = { step: i, name, shown: L.marks.length };
  };

  const pick = () => {
    const line = innerHeight * 0.5;
    let i = 0;
    for (let k = 0; k < steps.length; k++) if (steps[k].getBoundingClientRect().top < line) i = k;
    if (i !== shown) { shown = i; draw(i); }
  };
  addEventListener('scroll', pick, { passive: true });
  addEventListener('resize', () => { shown = -1; pick(); });
  pick();
}

if (typeof document !== 'undefined') main().catch((e) => {
  document.body.classList.add('failed');
  document.getElementById('err').textContent = String(e.message || e);
  console.error(e);
});
