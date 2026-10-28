/* Pure logic for Three Ngrams: one word in the Daily, thesis titles and course bulletins on
 * one chart. No DOM here, so node can test every function the page depends on
 * (compare-logic.test.mjs). Each source keeps its own matching rules and its own bins; this
 * file only puts them on one time axis, each scaled to its own peak, because "articles per
 * 10,000" and "titles per 1,000" are not one unit and a shared y-axis would pretend they were. */
import * as D from '../ngram-logic.js';
import * as T from '../theses/thesis-logic.js';
import * as C from '../courses/course-logic.js';
export { niceTicks } from '../ngram-logic.js';

export const FROM = 1910; // the thesis page's own chart start; the Daily's earlier bins are cut to match
// Words whose three lines disagree (state/scratch/ngram-lag) or agree, to start from.
export const PRESETS = ['gene', 'computer', 'teaching', 'memory', 'climate', 'women', 'programming', 'war'];

export const SOURCES = [
  { id: 'daily', label: 'The Stanford Daily', unit: 'articles', page: '../' },
  { id: 'theses', label: 'Thesis titles', unit: 'titles', page: '../theses/' },
  { id: 'courses', label: 'Course bulletins', unit: 'courses', page: '../courses/' },
];

/* One word or a two-word phrase that all three sources can take, or why not. The strictest
 * rule wins: courses look up at most two words, and only the thesis page knows `*`. */
export function parseWord(input) {
  const raw = String(input ?? '').split(',')[0];
  if (/\*/.test(raw)) return { term: null, why: 'no * here: the Daily and the courses have no prefix search' };
  const { key, why } = C.termKey(raw);
  if (!key) return { term: null, why };
  if (!D.cleanTerm(key) || !T.cleanTerm(key)) return { term: null, why: 'nothing to look up' };
  return { term: key, why: null };
}

/* Where a point sits on the year axis: the middle of a 5-year bin (1950-54 -> 1952.5), and
 * the spring of an academic year ("2009-10" -> 2010), when most of its courses are taught. */
export const binX = (b) => (b.y0 + b.y1 + 1) / 2;
export const yearX = (label) => Number(label.slice(0, 4)) + 1;

/* Rates -> percent of their own highest value. Null stays null ("no data"); a series with
 * no positive value at all is all null, never a flat line at 0%, since a word a source
 * never used has no peak to be a share of. */
export function relative(rs) {
  const max = Math.max(0, ...rs.filter((r) => r != null));
  if (!(max > 0)) return rs.map(() => null);
  return rs.map((r) => (r == null ? null : (100 * r) / max));
}

/* The Daily's bins from FROM on, with their index into the full BINS (for totals). */
export const dailyBins = () => D.BINS.map((b, i) => ({ ...b, i })).filter((b) => b.y1 >= FROM);

/* Daily counts (one per dailyBins() bin, null where the web cannot count a phrase) ->
 * [{x, r}] rates per 10,000, web years scaled to the scans as the Daily page does. */
export function dailySeries(counts, totalsAll, webScale) {
  const bs = dailyBins();
  const rs = D.scaled(D.rates(counts, bs.map((b) => totalsAll[b.i])), bs, webScale);
  return bs.map((b, k) => ({ x: binX(b), r: rs[k], label: D.binLabel(b), n: counts[k], of: totalsAll[b.i] }));
}

export function thesisSeries(rows, term, last) {
  const bs = T.bins(FROM, last);
  const ts = T.totals(rows, bs), cs = T.counts(rows, bs, term);
  const rs = T.rates(cs, ts);
  return bs.map((b, k) => ({ x: binX(b), r: rs[k], label: T.binLabel(b), n: cs[k], of: ts[k] }));
}

/* Courses: null when the term is under the table's shipping floor, so the page says
 * "too rare" rather than drawing zeros. */
export function courseSeries(table, term, meta) {
  const cs = C.lookup(table, term);
  if (!cs) return null;
  const rs = C.rates(cs, meta.totals);
  return meta.years.map((y, k) => ({ x: yearX(y), r: rs[k], label: y, n: cs[k], of: meta.totals[k] }));
}

/* The point with the highest rate, ties to the earliest; null if none is above zero. */
export function peakPoint(series) {
  if (!series) return null;
  const k = D.peak(series.map((p) => p.r));
  return k == null ? null : series[k];
}

/* "Thesis titles peaked in 1990–94, the Daily in 1965–69: 25 years earlier." The gap is
 * between the middles of the two peak periods, rounded to 5 years since both are 5-year
 * bins. Null when either source never used the word. */
export function peakGap(a, b) {
  if (!a || !b) return null;
  return Math.round((b.x - a.x) / 5) * 5;
}

// URL state: ?q=gene. One word, read back with parseWord.
export const encodeState = (term) => (term ? `?q=${encodeURIComponent(term).replace(/%20/g, '+')}` : '');
export function decodeState(search) {
  const q = new URLSearchParams(search || '').get('q');
  return q == null ? null : parseWord(q).term;
}

// The source's own page for the same word, where its rules, tooltips and links live.
export const sourceUrl = (src, term) => `${src.page}?q=${encodeURIComponent(term).replace(/%20/g, '+')}`;
