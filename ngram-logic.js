/* Pure logic for Stanford Daily Ngrams: terms, bins, queries, rates, ticks, URL state.
 * No DOM here, so node can test every function the page depends on
 * (site/ngram-logic.test.mjs). */

export const API = 'https://ehabp6fuc5.execute-api.us-east-1.amazonaws.com/prod';
export const ARCHIVE = 'https://archives.stanforddaily.com';
// The digitised run: first issue 1892-09-19, last 2014-06-13 (the archive's own bounds).
export const FIRST = '1892-09-19';
export const LAST = '2014-06-13';
export const MAX_TERMS = 4;
export const PER = 10000; // rates are "articles per 10,000"

// Five-year bins. Each bin's dates are clipped to the run, so the first and last are
// partial, and that is why every count is divided by its own bin's total.
export const BINS = (() => {
  const out = [];
  for (let y = 1890; y <= 2010; y += 5) {
    const start = y === 1890 ? FIRST : `${y}-01-01`;
    const end = y === 2010 ? LAST : `${y + 4}-12-31`;
    out.push({ y0: Math.max(y, 1892), y1: Math.min(y + 4, 2014), start, end });
  }
  return out;
})();

/* The calendar years inside one bin, each clipped to the run the same way, so a clicked
 * period can be split without a gap or overlap. build.py years() cuts the same dates for
 * the per-year totals; data.yearTotals[y - 1892] is year y's denominator. */
export const YEAR0 = 1892;
export function yearBins(bin) {
  const out = [];
  for (let y = bin.y0; y <= bin.y1; y++) {
    out.push({ y0: y, y1: y, start: y === YEAR0 ? FIRST : `${y}-01-01`, end: y === 2014 ? LAST : `${y}-12-31` });
  }
  return out;
}

/* Per-year rates for one bin: counts[k] over yearTotals for bin.y0 + k. */
export const yearRates = (counts, bin, yearTotals) =>
  rates(counts, yearBins(bin).map((b) => yearTotals[b.y0 - YEAR0]));

export const binLabel = (b) => `${b.y0}–${String(b.y1).slice(2)}`;

/* A term the search index can take literally. Lucene has a dozen operators; rather than
 * escape them all, keep letters (any script), digits, spaces, apostrophes and hyphens, and
 * drop the rest. Returns null when nothing searchable is left. */
export function cleanTerm(s) {
  const t = String(s ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}' -]+/gu, ' ')
    .replace(/(^|\s)['-]+|['-]+(?=\s|$)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || !/[\p{L}\p{N}]/u.test(t)) return null;
  return t.slice(0, 40).trim();
}

/* "computer, internet ,Big Game" -> ["computer","internet","big game"]: comma-separated,
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

// One word is a term query; anything with a space or hyphen is a phrase.
export const termClause = (t) => (/[ -]/.test(t) ? `"${t}"` : t);

export function lucene(term, bin) {
  const date = `publish_date:[${bin.start}T00:00:00Z TO ${bin.end}T23:59:59Z]`;
  const text = term == null ? '' : `article_text:${termClause(term)} AND `;
  return `${text}${date} AND (article_type:article)`;
}

export function countUrl(term, bin) {
  const p = new URLSearchParams({ 'q.parser': 'lucene', q: lucene(term, bin), size: '0' });
  return `${API}?${p}`;
}

// The archive's own search page for the same word and dates: the way to read the articles.
export function archiveUrl(term, bin) {
  const p = new URLSearchParams({
    article_text: termClause(term), start_date: bin.start, end_date: bin.end,
    page: '1', pagelen: '20', article_type_article: 'true',
    article_type_advertisement: 'false', sort: 'relevance',
  });
  return `${ARCHIVE}/search?${p}`;
}

/* Counts -> rates per PER articles. A bin with no total (should not happen) or a missing
 * count is null, never 0: "no data" and "never said" must not draw the same. */
export function rates(counts, totals) {
  return totals.map((tot, i) => {
    const c = counts[i];
    if (!tot || c == null || !Number.isFinite(c)) return null;
    return (c / tot) * PER;
  });
}

// The highest bin, ties to the earliest. Null when every bin is null or zero.
export function peak(rs) {
  let best = -1;
  rs.forEach((r, i) => { if (r != null && r > 0 && (best < 0 || r > rs[best])) best = i; });
  return best < 0 ? null : best;
}

/* Axis ticks: 0 and round steps (1/2/5 x 10^n) to at least max, 3-6 ticks. */
export function niceTicks(max) {
  if (!(max > 0)) return [0, 1];
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const top = Math.ceil(max / step - 1e-9) * step;
  const out = [];
  for (let v = 0; v <= top + step / 2; v += step) out.push(+v.toPrecision(12));
  return out;
}

export function fmtRate(r) {
  if (r == null) return '—';
  if (r === 0) return '0';
  if (r >= 100) return Math.round(r).toLocaleString('en-US');
  if (r >= 10) return r.toFixed(1);
  if (r >= 1) return r.toFixed(2);
  return r.toPrecision(2);
}

// URL state: ?q=computer,big+game. Read with parseTerms so a hand-edited URL is cleaned
// the same way the input box is.
export const encodeState = (terms) => (terms.length ? `?q=${terms.map(encodeURIComponent).join(',')}` : '');
export function decodeState(search) {
  const q = new URLSearchParams(search || '').get('q');
  return q == null ? null : parseTerms(q);
}

/* Run fn over items with at most `limit` in flight; results keep the input order. The
 * archive is a student paper's search box, not a CDN, so a word costs 25 requests and
 * this keeps them from all landing at once. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
