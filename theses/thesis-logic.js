/* Pure logic for Stanford Thesis Ngrams: terms, matching, bins, counts, URL state.
 * No DOM here, so node can test every function the page depends on
 * (thesis-logic.test.mjs). The chart helpers shared with the Daily page (ticks, rate
 * formatting, peak) are imported from ../ngram-logic.js rather than copied. */
export { niceTicks, fmtRate, peak } from '../ngram-logic.js';

export const MAX_TERMS = 4;
export const PER = 1000; // rates are "titles per 1,000"
export const STEP = 5;
export const VIEW = 'https://searchworks.stanford.edu/view/';

/* Lower case, accents off, curly quotes straight: "Émile’s" and "emile's" are one word. The
 * titles are folded by the same function when the data loads, so both sides agree. */
export function fold(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'");
}

/* A term the matcher can take literally: letters (any script), digits, spaces, apostrophes,
 * hyphens, and one trailing * for a prefix ("neur*"). Anything else becomes a space. Null
 * when nothing searchable is left, or when a prefix is shorter than 3 letters ("a*" would
 * match most titles and say nothing). */
export function cleanTerm(s) {
  let t = fold(s).replace(/[^\p{L}\p{N}' *-]+/gu, ' ');
  const star = /\*\s*$/.test(t);
  t = t.replace(/\*/g, ' ')
    .replace(/(^|\s)['-]+|['-]+(?=\s|$)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
    .trim();
  if (!t || !/[\p{L}\p{N}]/u.test(t)) return null;
  if (star) {
    if (t.replace(/[^\p{L}\p{N}]/gu, '').length < 3 || / /.test(t)) return null;
    return `${t}*`;
  }
  return t;
}

/* "neural, deep learning ,Neural" -> ["neural", "deep learning"]: comma-separated,
 * cleaned, de-duplicated, at most MAX_TERMS. */
export function parseTerms(input) {
  const seen = new Set();
  const out = [];
  for (const raw of String(input ?? '').split(',')) {
    const t = cleanTerm(raw);
    if (t && !seen.has(t)) { seen.add(t); out.push(t); }
    if (out.length === MAX_TERMS) break;
  }
  return out;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const W = '[\\p{L}\\p{N}]';

/* The regex a folded title is tested with. Whole words only, so "art" is not "party".
 * A single word also matches its plural (-s, -es), so "network" finds "networks"; a
 * phrase matches as typed, with any run of spaces or hyphens between its words; "neur*"
 * matches any word that starts with neur. */
export function matcher(term) {
  const t = cleanTerm(term);
  if (!t) return null;
  if (t.endsWith('*')) return new RegExp(`(?<!${W})${esc(t.slice(0, -1))}${W}*`, 'u');
  const words = t.split(/[ -]+/).filter(Boolean).map(esc);
  const body = words.join('[ -]+');
  const plural = words.length === 1 ? '(?:e?s)?' : '';
  return new RegExp(`(?<!${W})${body}${plural}(?!${W})`, 'u');
}

/* Five-year bins on round years, the first and last clipped to the data's own span. */
export function bins(first, last, step = STEP) {
  const out = [];
  for (let y = first - (first % step); y <= last; y += step) {
    out.push({ y0: Math.max(y, first), y1: Math.min(y + step - 1, last) });
  }
  return out;
}
// 'Department of Physics' -> 'Physics' for the menu; build.py short() does the same.
export const shortDept = (d) => String(d).replace(/^(Department of|Dept\. of) /, '');

export const binOf = (bs, year) => bs.findIndex((b) => year >= b.y0 && year <= b.y1);
export const binLabel = (b) => (b.y0 === b.y1 ? String(b.y0) : `${b.y0}–${String(b.y1).slice(2)}`);

/* data/theses.tsv, one thesis a line: year, department index (-1: none), SearchWorks id,
 * title. The build writes it sorted by year. Lines that do not parse are dropped and
 * counted, not guessed at. */
export function parseRows(tsv) {
  const rows = [];
  let bad = 0;
  for (const line of String(tsv).split('\n')) {
    if (!line) continue;
    const [y, d, id, ...rest] = line.split('\t');
    const year = Number(y), dept = Number(d), title = rest.join('\t');
    if (!Number.isInteger(year) || !Number.isInteger(dept) || !id || !title) { bad++; continue; }
    rows.push({ year, dept, id, title, f: fold(title) });
  }
  return { rows, bad };
}

/* Titles per bin, and how many of them match each term, for one department or all
 * (dept = -1 means every thesis, including those with no department on record). */
export function totals(rows, bs, dept = -1) {
  const t = new Array(bs.length).fill(0);
  for (const r of rows) {
    if (dept >= 0 && r.dept !== dept) continue;
    const i = binOf(bs, r.year);
    if (i >= 0) t[i]++;
  }
  return t;
}

export function counts(rows, bs, term, dept = -1) {
  const re = matcher(term);
  const c = new Array(bs.length).fill(0);
  if (!re) return c;
  for (const r of rows) {
    if (dept >= 0 && r.dept !== dept) continue;
    if (!re.test(r.f)) continue;
    const i = binOf(bs, r.year);
    if (i >= 0) c[i]++;
  }
  return c;
}

/* Counts -> titles per PER. A bin with no titles at all is null, never 0: "no theses that
 * period" and "theses, but none used the word" must not draw the same. */
export function rates(cs, ts) {
  return ts.map((tot, i) => (!tot || cs[i] == null ? null : (cs[i] / tot) * PER));
}

/* The matching titles in one bin, newest first, at most n: what the tooltip lists. */
export function examples(rows, bs, i, term, dept = -1, n = 5) {
  const re = matcher(term);
  if (!re || !bs[i]) return [];
  const { y0, y1 } = bs[i];
  const out = [];
  for (let k = rows.length - 1; k >= 0 && out.length < n; k--) {
    const r = rows[k];
    if (r.year < y0 || r.year > y1 || (dept >= 0 && r.dept !== dept)) continue;
    if (re.test(r.f)) out.push(r);
  }
  return out;
}

// URL state: ?q=neural,deep+learning&d=Department+of+Physics. Read with parseTerms so a
// hand-edited URL is cleaned the same way the input box is; an unknown department is
// dropped rather than charting an empty filter.
export function encodeState(terms, deptName) {
  const p = new URLSearchParams();
  if (terms.length) p.set('q', terms.join(','));
  if (deptName) p.set('d', deptName);
  const s = p.toString();
  return s ? `?${s}` : '';
}
export function decodeState(search, depts = []) {
  const p = new URLSearchParams(search || '');
  const q = p.get('q');
  const d = depts.indexOf(p.get('d'));
  return { terms: q == null ? null : parseTerms(q), dept: d };
}
