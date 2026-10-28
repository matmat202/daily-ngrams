/* Pure logic for Stanford Course Ngrams: terms, lookup, rates, URL state. No DOM here, so
 * node can test every function the page depends on (course-logic.test.mjs). The chart
 * helpers shared with the Daily page are imported from ../ngram-logic.js, not copied.
 *
 * The page never sees course text. projects/course-ngrams/build.py counts, per academic
 * year, the courses using each word and two-word phrase, and ships that table; a term is
 * looked up, so the key built here must be the key build.py wrote. */
export { niceTicks, fmtRate, peak } from '../ngram-logic.js';

export const MAX_TERMS = 4;
export const MAX_WORDS = 2;
export const PER = 1000; // rates are "courses per 1,000"
export const SEARCH = 'https://explorecourses.stanford.edu/search';

/* Lower case, accents off, curly quotes straight: build.py fold() does the same. */
export function fold(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'");
}

/* The table key for what was typed, or why there is none. Words are letters and digits
 * (an apostrophe inside a word is kept, a possessive 's is dropped, as build.py does);
 * a hyphen is a space, so "in-person" is the phrase "in person". */
export function termKey(s) {
  const raw = fold(s);
  if (/\*/.test(raw)) return { key: null, why: 'no * here: type the whole word' };
  const words = raw.replace(/[^\p{L}\p{N}']+/gu, ' ').split(' ')
    .map((w) => w.replace(/^'+|'+$/g, '').replace(/'s$/, '').replace(/'+$/, ''))
    .filter(Boolean);
  if (!words.length) return { key: null, why: 'nothing to look up' };
  if (words.length > MAX_WORDS) return { key: null, why: `phrases of at most ${MAX_WORDS} words` };
  return { key: words.join(' '), why: null };
}

/* "Climate, in-person ,climate" -> ["climate", "in person"]: comma-separated, keyed,
 * de-duplicated, at most MAX_TERMS. What cannot be keyed is returned beside, with why. */
export function parseTerms(input) {
  const seen = new Set();
  const terms = [], refused = [];
  for (const raw of String(input ?? '').split(',')) {
    if (!raw.trim()) continue;
    const { key, why } = termKey(raw);
    if (!key) { refused.push({ raw: raw.trim(), why }); continue; }
    if (!seen.has(key)) { seen.add(key); terms.push(key); }
    if (terms.length === MAX_TERMS) break;
  }
  return { terms, refused };
}

/* data/terms.tsv: term, a tab, one count per year comma separated. A line whose count
 * list is not exactly `years` integers is dropped and counted, not guessed at. */
export function parseTable(tsv, years) {
  const table = new Map();
  let bad = 0;
  for (const line of String(tsv).split('\n')) {
    if (!line) continue;
    const tab = line.indexOf('\t');
    const cs = tab < 0 ? [] : line.slice(tab + 1).split(',').map(Number);
    if (tab < 1 || cs.length !== years || !cs.every((n) => Number.isInteger(n) && n >= 0)) { bad++; continue; }
    table.set(line.slice(0, tab), cs);
  }
  return { table, bad };
}

/* Counts for a term, or null when it is under the shipping floor (rare, or never used):
 * the page must say "too rare to chart", never draw a confident zero. */
export const lookup = (table, term) => table.get(term) ?? null;

/* Counts -> courses per PER. A year with no courses is null, never 0. */
export function rates(cs, totals) {
  return totals.map((t, i) => (!t || cs?.[i] == null ? null : (cs[i] / t) * PER));
}

/* How much a term moved: its rate in the last three years over the first three. Null when
 * either end is zero, since a ratio from nothing is not a number worth printing. */
export function change(rs, n = 3) {
  const avg = (xs) => (xs.length && xs.every((x) => x != null) ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const a = avg(rs.slice(0, n)), b = avg(rs.slice(-n));
  return a && b ? b / a : null;
}

export function fmtChange(k) {
  if (k == null) return '';
  if (k >= 1) return `×${k >= 10 ? Math.round(k) : k.toFixed(1)}`;
  return `÷${1 / k >= 10 ? Math.round(1 / k) : (1 / k).toFixed(1)}`;
}

/* ExploreCourses' own search for a term in one academic year ("2009-10" -> 20092010), so a
 * point on the chart opens the courses behind it. With a department code, only that
 * department's (a school has no such filter in ExploreCourses, so it gets the whole year). */
export function searchUrl(term, label, dept = '') {
  const y0 = Number(label.slice(0, 4));
  const p = new URLSearchParams({ view: 'catalog', q: term, academicYear: `${y0}${y0 + 1}` });
  if (dept) p.set(`filter-departmentcode-${dept}`, 'on');
  return `${SEARCH}?${p}`;
}

// URL state: ?q=climate,machine+learning&g=CS. Read with parseTerms so a hand-edited URL is
// cleaned the same way the input box is.
export function encodeState(terms, group = '') {
  const p = new URLSearchParams();
  if (terms.length) p.set('q', terms.join(','));
  if (group) p.set('g', group);
  const s = String(p);
  return s ? `?${s}` : '';
}
export function decodeState(search) {
  const q = new URLSearchParams(search || '').get('q');
  return q == null ? null : parseTerms(q).terms;
}

/* The group named by ?g=, or null for all of Stanford. Matched on id, ignoring case, so
 * ?g=cs works; an unknown id is null (everything), never an empty chart. */
export function decodeGroup(search, groups) {
  const g = new URLSearchParams(search || '').get('g');
  if (!g) return null;
  const want = g.toLowerCase();
  return (groups || []).find((x) => x.id.toLowerCase() === want) ?? null;
}

/* The menu: schools first, then each school's departments under it, both by label.
 * -> [{label, groups}] for <optgroup>s. A department whose school has no group of its
 * own (too small) still gets listed, under its school's name. */
export function menu(groups) {
  const schools = groups.filter((g) => g.kind === 'school').sort((a, b) => a.label.localeCompare(b.label));
  const out = [{ label: 'Schools', groups: schools }];
  const by = new Map();
  for (const g of groups) if (g.kind === 'dept') (by.get(g.school) ?? by.set(g.school, []).get(g.school)).push(g);
  for (const name of [...by.keys()].sort((a, b) => a.localeCompare(b))) {
    out.push({ label: name, groups: by.get(name).sort((a, b) => a.label.localeCompare(b.label)) });
  }
  return out;
}
