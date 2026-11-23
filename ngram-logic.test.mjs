// node site/ngram-logic.test.mjs — every pure function the page depends on, plus the
// shipped data checked against the logic that reads it. Exit 1 on any failure.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as L from './ngram-logic.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${extra}`); }
};
// JSON.stringify turns NaN and +-Infinity into `null`, so a plain stringify compare cannot
// tell a NaN from a deliberate null -- and this module returns null for "not counted". That
// blindness let `relative`'s `max > 0` guard be flipped to `max >= 0` (0/0 -> NaN) with every
// test still passing. J() tags non-finite numbers so they can never read as null.
const J = (v) => JSON.stringify(v, (_k, x) => (typeof x === 'number' && !Number.isFinite(x) ? `#${x}` : x));
const eq = (name, a, b) => ok(name, J(a) === J(b), `got ${J(a)} want ${J(b)}`);

// --- bins ---------------------------------------------------------------------------
const PRINT = L.BINS.filter((b) => b.src === 'print'), WEB = L.BINS.filter(L.isWeb);
eq('25 scanned five-year bins', PRINT.length, 25);
eq('3 web bins', WEB.map(L.binLabel), ['2015–19', '2020–24', '2025–26']);
eq('every bin names its source', L.BINS.every((b) => b.src === 'print' || b.src === 'web'), true);
eq('scans come first, then the web, never interleaved', L.BINS.findIndex(L.isWeb), 25);
eq('first bin starts at the first issue', L.BINS[0].start, '1892-09-19');
eq('first bin label is clipped', L.binLabel(L.BINS[0]), '1892–94');
eq('last scanned bin ends at the last issue', PRINT.at(-1).end, '2014-06-13');
eq('last scanned bin years', [PRINT.at(-1).y0, PRINT.at(-1).y1], [2010, 2014]);
eq('web starts on WEB_FIRST', WEB[0].start, L.WEB_FIRST);
eq('web ends on WEB_LAST, the day the baked totals stop', WEB.at(-1).end, L.WEB_LAST);
ok('the two sources share no day', PRINT.at(-1).end < WEB[0].start);
// contiguous within a source: each bin starts the day after the previous one ends, so no
// article is counted twice or dropped between bins
const contig = (bs) => bs.every((b, i) => i === 0 ||
  new Date(b.start + 'T00:00:00Z') - new Date(bs[i - 1].end + 'T00:00:00Z') === 86400000);
ok('scanned bins are contiguous with no gap or overlap', contig(PRINT));
ok('web bins are contiguous with no gap or overlap', contig(WEB));

// --- years inside a bin (the click drill-down) -------------------------------------
{
  const ys = L.BINS.flatMap(L.yearBins);
  eq('135 years in the run (123 scanned, 12 web)', ys.length, 135);
  eq('years run 1892..2026 with no year twice', ys.map((y) => y.y0), Array.from({ length: 135 }, (_, i) => 1892 + i));
  eq('first year starts at the first issue', ys[0].start, '1892-09-19');
  eq('last scanned year ends at the last issue', ys[122].end, '2014-06-13');
  eq('last year ends on WEB_LAST', ys.at(-1).end, L.WEB_LAST);
  eq('a year keeps its bin\'s source', [ys[122].src, ys[123].src], ['print', 'web']);
  eq('a full bin has five years', L.yearBins(L.BINS[10]).map((b) => b.y0), [1940, 1941, 1942, 1943, 1944]);
  eq('the clipped first bin has three', L.yearBins(L.BINS[0]).map((b) => b.y0), [1892, 1893, 1894]);
  // a bin's years tile it exactly: same first day, same last day, one day apart
  let tiles = true;
  for (const b of L.BINS) {
    const y = L.yearBins(b);
    if (y[0].start !== b.start || y.at(-1).end !== b.end) tiles = false;
    for (let i = 1; i < y.length; i++) {
      if (new Date(y[i].start + 'T00:00:00Z') - new Date(y[i - 1].end + 'T00:00:00Z') !== 86400000) tiles = false;
    }
  }
  ok("each bin's years tile it with no gap or overlap", tiles);
  // the rate for year k must divide by year k's own total, not the bin's or a neighbour's
  const tot = Array.from({ length: 123 }, (_, i) => 1000 + i);
  const r = L.yearRates([10, 20, 30, 40, 50], L.BINS[10], tot);
  eq('yearRates divides by each year\'s own total', r.map((x) => +x.toFixed(4)),
    [1940, 1941, 1942, 1943, 1944].map((y, k) => +(((k + 1) * 10) / (1000 + y - 1892) * 1e4).toFixed(4)));
  const tot2 = Array.from({ length: 135 }, () => 1000);
  eq('yearRates divides web years by the scale', L.yearRates([20, 40], WEB[2], tot2, 2), [100, 200]);
  eq('yearRates leaves web years alone with no scale', L.yearRates([20, 40], WEB[2], tot2), [200, 400]);
  eq('yearRates leaves scanned years alone', L.yearRates([20], L.BINS[0], tot2, 2).slice(0, 1), [200]);
}

// --- terms --------------------------------------------------------------------------
eq('lower-cased and trimmed', L.cleanTerm('  Computer '), 'computer');
eq('lucene operators dropped', L.cleanTerm('war* AND (peace)'), 'war and peace');
eq('quotes dropped', L.cleanTerm('"big game"'), 'big game');
eq('colon cannot inject a field', L.cleanTerm('publish_date:[1900 TO 2000]'), 'publish date 1900 to 2000');
eq('curly apostrophe kept as straight', L.cleanTerm('Women’s'), "women's");
eq('hyphenated word kept', L.cleanTerm('co-ed'), 'co-ed');
eq('stray hyphens trimmed', L.cleanTerm('- war -'), 'war');
eq('non-latin letters kept', L.cleanTerm('Ñandú'), 'ñandú');
eq('punctuation only is null', L.cleanTerm('*&^%'), null);
eq('empty is null', L.cleanTerm(''), null);
eq('null is null', L.cleanTerm(null), null);
// ?? not ||: only null/undefined mean "nothing"; a 0 is the term "0" (bin/mutate survivor).
eq('0 is the term "0"', L.cleanTerm(0), '0');
eq('parseTerms(0) is ["0"]', L.parseTerms(0), ['0']);
ok('long input capped', L.cleanTerm('a'.repeat(100)).length <= 40);
eq('comma list parsed', L.parseTerms('computer, Internet ,big game'), ['computer', 'internet', 'big game']);
eq('duplicates removed', L.parseTerms('war, War, WAR'), ['war']);
eq('blanks skipped', L.parseTerms(',,war,,'), ['war']);
eq('nothing dropped at four', L.droppedTerms('a, b, c, d'), []);
eq('the fifth and sixth are dropped, in order', L.droppedTerms('a, b, c, d, e, f'), ['e', 'f']);
eq('a duplicate past four is not "dropped"', L.droppedTerms('a, b, c, d, A, e, e'), ['e']);
eq('dropped are cleaned', L.droppedTerms('a,b,c,d, Big Game!'), ['big game']);
eq('nothing dropped from nothing', [L.droppedTerms(''), L.droppedTerms(null)], [[], []]);
eq('a shared link past four names what it left out', L.decodeDropped('?q=a,b,c,d,e%2C%20Big%20Game'), ['e', 'big game']);
eq('a link of four drops nothing', L.decodeDropped('?q=a,b,c,d'), []);
eq('no q, or no search at all, drops nothing', [L.decodeDropped('?x=1'), L.decodeDropped(''), L.decodeDropped(undefined)], [[], [], []]);
eq('capped at four', L.parseTerms('a1,b2,c3,d4,e5'), ['a1', 'b2', 'c3', 'd4']);

// --- queries ------------------------------------------------------------------------
const b = L.BINS[12];
eq('one word is a bare term', L.lucene('war', b),
  `article_text:war AND publish_date:[${b.start}T00:00:00Z TO ${b.end}T23:59:59Z] AND (article_type:article)`);
ok('two words are a phrase', L.lucene('big game', b).startsWith('article_text:"big game" AND'));
ok('hyphen is a phrase', L.lucene('co-ed', b).startsWith('article_text:"co-ed" AND'));
ok('null term counts every article', L.lucene(null, b).startsWith('publish_date:'));
ok('ads are excluded', L.lucene('war', b).endsWith('AND (article_type:article)'));
const cu = new URL(L.countUrl('big game', b));
eq('count url asks for no hits', cu.searchParams.get('size'), '0');
eq('count url uses lucene', cu.searchParams.get('q.parser'), 'lucene');
eq('count url round-trips the query', cu.searchParams.get('q'), L.lucene('big game', b));
const au = new URL(L.archiveUrl('big game', b));
eq('archive link is the archive search page', au.origin + au.pathname, 'https://archives.stanforddaily.com/search');
eq('archive link carries the phrase', au.searchParams.get('article_text'), '"big game"');
eq('archive link carries the dates', [au.searchParams.get('start_date'), au.searchParams.get('end_date')], [b.start, b.end]);

// --- the web source ---------------------------------------------------------------
{
  const w = WEB[0];
  eq('a web bin counts from the web', new URL(L.countUrl('war', w)).origin, 'https://stanforddaily.com');
  const u = new URL(L.webCountUrl('war', w));
  eq('web count asks for one post, ids only', [u.searchParams.get('per_page'), u.searchParams.get('_fields')], ['1', 'id']);
  eq('web count searches the word', u.searchParams.get('search'), 'war');
  eq('web after is one second before the first day', u.searchParams.get('after'), '2014-12-31T23:59:59');
  eq('web before is midnight after the last day', u.searchParams.get('before'), '2020-01-01T00:00:00');
  eq('null term counts every post', new URL(L.webCountUrl(null, w)).searchParams.has('search'), false);
  // adjacent web bins: one's before is the next one's after + 1 s, so no post is in both
  const a = new URL(L.webCountUrl('x', WEB[0])).searchParams.get('before');
  const n = new URL(L.webCountUrl('x', WEB[1])).searchParams.get('after');
  eq('adjacent web bins meet at the second', Date.parse(a + 'Z') - Date.parse(n + 'Z'), 1000);
  ok('one word counts on the web', L.webCounts('war'));
  ok('a phrase does not', !L.webCounts('big game'));
  ok('a hyphenated word does not', !L.webCounts('co-ed'));
  const r = new URL(L.archiveUrl('war', w));
  eq('web reading link is the site search', r.origin + r.pathname + r.search, 'https://stanforddaily.com/?s=war');
  const bs = [L.BINS[0], WEB[0], WEB[1]];
  eq('scaled divides web rates only', L.scaled([12, 12, null], bs, 1.2).map((x) => x == null ? x : +x.toFixed(6)), [12, 10, null]);
  eq('scaled ignores a bad scale', L.scaled([12, 12], bs, 0), [12, 12]);
  eq('a scale under 1 still divides', L.scaled([12, 12], bs, 0.5), [12, 24]);
}

// --- rates & peak -------------------------------------------------------------------
eq('rate per 10k', L.rates([5, 0], [10000, 20000]), [5, 0]);
eq('missing count is null, not 0', L.rates([null, 3], [100, 100]), [null, 300]);
eq('zero total is null', L.rates([1], [0]), [null]);
// Compared with ===: JSON (and so eq) writes NaN and Infinity as null too.
eq('a count that is not a number is null, and so is a missing total', L.rates([NaN, Infinity, 1, null], [10, 10, undefined, 0]).map((x) => x === null), [true, true, true, true]);
eq('nothing searchable is null', ['!!!', '', '- -', "'", '¿?', null, undefined].map((x) => L.cleanTerm(x) === null), [true, true, true, true, true, true, true]);
eq('peak: a first bin bigger than the rest', [L.peak([5, 3]), L.peak([5]), L.peak([5, 1, 1])], [0, 0, 0]);
eq('peak is the max', L.peak([1, 5, 3]), 1);
eq('peak ties to the earliest', L.peak([2, 5, 5]), 1);
eq('peak skips nulls', L.peak([null, 2, null]), 1);
eq('no peak when all zero', L.peak([0, 0, null]), null);

// --- ticks & format -----------------------------------------------------------------
const tk = (m) => L.niceTicks(m);
eq('ticks for 47', tk(47), [0, 20, 40, 60]);
eq('ticks for 1000', tk(1000), [0, 500, 1000]);
eq('ticks for 1001', tk(1001), [0, 500, 1000, 1500]);
eq('ticks for 0.3', tk(0.3), [0, 0.1, 0.2, 0.3]);
eq('ticks for 0', tk(0), [0, 1]);
for (const m of [0.07, 3, 9.9, 47, 123, 2500, 9999]) {
  const t = tk(m);
  ok(`ticks cover ${m}`, t.at(-1) >= m && t[0] === 0 && t.length >= 3 && t.length <= 6, JSON.stringify(t));
}
eq('format big', L.fmtRate(1234.5), '1,235');
eq('format mid', L.fmtRate(12.345), '12.3');
eq('format small', L.fmtRate(1.234), '1.23');
eq('format tiny', L.fmtRate(0.01234), '0.012');
eq('format null', L.fmtRate(null), '—');
eq('format zero', L.fmtRate(0), '0');
eq('format at each edge', [100, 99.5, 10, 9.99, 1, 0.999].map(L.fmtRate), ['100', '99.5', '10.0', '9.99', '1.00', '1.0']);
eq('ticks when a quarter of the max is already round', [tk(4), tk(8), tk(20)], [[0, 1, 2, 3, 4], [0, 2, 4, 6, 8], [0, 5, 10, 15, 20]]);

// --- url state ----------------------------------------------------------------------
eq('state encodes', L.encodeState(['big game', 'axe']), '?q=big%20game,axe');
eq('state round-trips', L.decodeState(L.encodeState(['big game', "women's"])), ['big game', "women's"]);
eq('no q is null', L.decodeState('?x=1'), null);
eq('hand-edited url is cleaned', L.decodeState('?q=WAR*,%22peace%22'), ['war', 'peace']);
eq('empty state', L.encodeState([]), '');

// --- mapLimit -----------------------------------------------------------------------
{
  let inflight = 0, most = 0;
  const out = await L.mapLimit([30, 5, 20, 1, 10, 2, 8], 3, async (ms, i) => {
    inflight++; most = Math.max(most, inflight);
    await new Promise((r) => setTimeout(r, ms));
    inflight--; return i * 10;
  });
  eq('mapLimit keeps input order', out, [0, 10, 20, 30, 40, 50, 60]);
  ok('mapLimit never exceeds the limit', most <= 3, `most=${most}`);
  ok('mapLimit actually runs in parallel', most === 3, `most=${most}`);
  let threw = false;
  try { await L.mapLimit([1, 2], 2, async (x) => { if (x === 2) throw new Error('x'); return x; }); }
  catch { threw = true; }
  ok('mapLimit rejects when a call fails', threw);
}

// --- the live tail: the open period runs to today, not to the last build -------------
{
  const last = L.BINS.at(-1);
  eq('no tail on or before WEB_LAST', [L.tailPlan(L.BINS, L.WEB_LAST), L.tailPlan(L.BINS, '2026-01-01')], [null, null]);
  for (const bad of [null, undefined, '', 'today', '2026-11-1', 20261112]) eq(`no tail for a bad date ${JSON.stringify(bad)}`, L.tailPlan(L.BINS, bad), null);
  const p = L.tailPlan(L.BINS, '2026-11-12');
  eq('tail moves the last bin to today', [p.bin.start, p.bin.end, p.bin.y0, p.bin.y1, p.bin.src], [last.start, '2026-11-12', 2025, 2026, 'web']);
  eq('tail asks only the open year', p.years.map((y) => [y.y0, y.start, y.end]), [[2026, '2026-01-01', '2026-11-12']]);
  eq('tail does not touch BINS', L.BINS.at(-1).end, L.WEB_LAST);
  const q = L.tailPlan(L.BINS, '2027-03-04');
  eq('a new year inside the bin: both open years asked', q.years.map((y) => [y.y0, y.end]), [[2026, '2026-12-31'], [2027, '2027-03-04']]);
  eq('label follows the new year', L.binLabel(q.bin), '2025–27');
  eq('2031 clamps to the bin span (a new bin needs a build)', [L.tailPlan(L.BINS, '2031-02-01').bin.end, L.tailPlan(L.BINS, '2031-02-01').bin.y1], ['2029-12-31', 2029]);
  eq('no tail if the last bin is scanned', L.tailPlan(L.BINS.slice(0, 25), '2026-11-12'), null);
  // apply: synthetic totals so the arithmetic is checked, not just echoed
  const yt = Array.from({ length: 135 }, (_, i) => 100 + i);   // 2025 -> 233, 2026 -> 234
  const tot = L.BINS.map((_, i) => 1000 + i);
  const a = L.applyTail(L.BINS, tot, yt, p, [300]);
  eq('the new year total replaces the baked one', a.yearTotals[2026 - L.YEAR0], 300);
  eq('the bin total is its years summed', a.totals.at(-1), 233 + 300);
  eq('other bins keep their totals', a.totals.slice(0, -1), tot.slice(0, -1));
  eq('the bins end today', a.bins.at(-1).end, '2026-11-12');
  eq('inputs are not mutated', [yt[2026 - L.YEAR0], tot.at(-1), L.BINS.at(-1).end], [234, 1027, L.WEB_LAST]);
  const b = L.applyTail(L.BINS, tot, yt, q, [300, 50]);
  eq('a new year grows the per-year table', [b.yearTotals.length, b.yearTotals[2027 - L.YEAR0], b.totals.at(-1)], [136, 50, 233 + 300 + 50]);
  eq('every year of the new bin has a total', L.yearBins(b.bins.at(-1)).every((y) => b.yearTotals[y.y0 - L.YEAR0] > 0), true);
  eq('fewer posts than the baked count is a bad answer', L.applyTail(L.BINS, tot, yt, p, [200]), null);
  eq('a few deleted posts are not', L.applyTail(L.BINS, tot, yt, p, [230]) != null, true);
  for (const bad of [[0], [-3], [NaN], [1.5], [], [300, 300], null, ['300']]) eq(`a bad live total ${JSON.stringify(bad)} keeps the baked run`, L.applyTail(L.BINS, tot, yt, p, bad), null);
  // A year the build never counted has a baked total of 0, and then the 0.95 floor cannot
  // fire -- the "every count is a positive integer" guard is the only thing left. The [0]
  // case above does NOT pin that guard: with a baked 234 the floor rejects 0 as well, so a
  // mutant of the guard stays green on it. These two use a baked 0, where only one guard can.
  {
    const zero = yt.slice(); zero[2026 - L.YEAR0] = 0;
    eq('a live count of 0 is rejected even where the 95% floor cannot fire', L.applyTail(L.BINS, tot, zero, p, [0]), null);
    eq('a live count of 1 is accepted there', L.applyTail(L.BINS, tot, zero, p, [1]).yearTotals[2026 - L.YEAR0], 1);
  }
  // the floor is "fewer than 95%", not "95% or fewer": at exactly 95% nothing was deleted.
  // 20 * 0.95 is exactly 19 in IEEE doubles, so this lands on the boundary, not beside it.
  {
    const twenty = yt.slice(); twenty[2026 - L.YEAR0] = 20;
    eq('20 * 0.95 is exactly 19, so this is the boundary', 20 * 0.95, 19);
    eq('exactly 95% of the baked count is accepted', L.applyTail(L.BINS, tot, twenty, p, [19]).yearTotals[2026 - L.YEAR0], 19);
    eq('a hair under 95% is not', L.applyTail(L.BINS, tot, twenty, p, [18]), null);
  }
  eq('no plan keeps the baked run', L.applyTail(L.BINS, tot, yt, null, [300]), null);
  // the identity the build holds must survive the splice, on the real shipped totals
  {
    const D0 = JSON.parse(readFileSync(fileURLToPath(new URL('data/presets.json', import.meta.url)), 'utf8'));
    const r = L.applyTail(L.BINS, D0.totals, D0.yearTotals, q, [D0.yearTotals.at(-1) + 90, 40]);
    eq('extended per-year totals still add up to each bin', r.bins.map((bn) => L.yearBins(bn).reduce((s, y) => s + r.yearTotals[y.y0 - L.YEAR0], 0)), r.totals);
  }
  eq('day label', [L.dayLabel('2026-11-12'), L.dayLabel('2027-01-01')], ['Nov 12, 2026', 'Jan 1, 2027']);
}

// --- the shipped data ---------------------------------------------------------------
const here = fileURLToPath(new URL('.', import.meta.url));
const D = JSON.parse(readFileSync(here + 'data/presets.json', 'utf8'));
// build.py cuts the bins and the per-year totals from its own copy of the dates; the page
// divides by them by position, so its bins must be the same ones, field for field.
eq('the page\'s bins are build.py\'s', L.BINS, D.bins);
eq('a year total for every year the bins cover', D.yearTotals.length, L.BINS.at(-1).y1 - L.YEAR0 + 1);
eq('the bins run to the last day fetched', [L.BINS.at(-1).end, L.WEB_LAST], [D.webLast, D.webLast]);
eq('data bins are the logic bins', D.bins, L.BINS);
ok('every bin has articles', D.totals.length === L.BINS.length && D.totals.every((t) => t > 1000), JSON.stringify(D.totals));
ok('about 695k scanned articles', Math.abs(D.totals.slice(0, 25).reduce((a, c) => a + c, 0) - 695000) < 20000);
ok('135 per-year totals', Array.isArray(D.yearTotals) && D.yearTotals.length === 135 && D.yearTotals.every((t) => t > 0));
eq('data was counted to the day the logic stops at', D.webLast, L.WEB_LAST);
{
  const rs = Object.values(D.calibration.ratios).sort((a, b) => a - b);
  const med = rs.length % 2 ? rs[(rs.length - 1) / 2] : (rs[rs.length / 2 - 1] + rs[rs.length / 2]) / 2;
  ok('at least 8 words calibrate the splice', rs.length >= 8, String(rs.length));
  ok('webScale is the median ratio', Math.abs(D.webScale - med) < 0.001, `${D.webScale} vs ${med}`);
  ok('webScale is a plausible splice (0.5-2)', D.webScale >= 0.5 && D.webScale <= 2, String(D.webScale));
}
eq('per-year totals add up to each bin', L.BINS.map((b) => L.yearBins(b).reduce((a, y) => a + D.yearTotals[y.y0 - L.YEAR0], 0)), D.totals);
ok('at least five presets', D.presets.length >= 5);
for (const p of D.presets) {
  ok(`preset ${p.id} has 1-4 terms`, p.terms.length >= 1 && p.terms.length <= L.MAX_TERMS);
  for (const t of p.terms) {
    eq(`preset term "${t}" is already clean`, L.cleanTerm(t), t);
    const c = D.counts[t];
    ok(`preset term "${t}" has a count per bin`, Array.isArray(c) && c.length === L.BINS.length &&
      c.every((n, i) => Number.isInteger(n) || (n === null && L.isWeb(L.BINS[i]) && !L.webCounts(t))));
    ok(`preset term "${t}" has web counts iff it is one word`, c.slice(25).every((n) => (n === null) === !L.webCounts(t)));
    ok(`preset term "${t}" is never more than every article`, c.every((n, i) => n == null || n <= D.totals[i]));
    ok(`preset term "${t}" is found somewhere`, c.some((n) => n > 0));
  }
}
// "coed" stems to "co" in the archive index and matches every co- word; a preset that
// does that charts the wrong word with full confidence.
ok('no preset word that the index stems into another word', !D.presets.some((p) => p.terms.includes('coed')));
// The headline example has to show the thing it claims: internet rises from ~0.
{
  const r = L.rates(D.counts.internet, D.totals);
  // OCR noise puts a stray hit or two in early bins (1 of 7,141 articles in 1892-94).
  ok('internet is ~0 before 1990 and peaks after 1995', Math.max(...r.slice(0, 20)) < 2 && L.peak(r) >= 21, JSON.stringify(r.map((x) => +x.toFixed(2))));
}
// And the web years have to show something the scans cannot: the pandemic in 2020-24.
{
  const r = L.scaled(L.rates(D.counts.pandemic, D.totals), L.BINS, D.webScale);
  const i2020 = L.BINS.findIndex((b) => b.y0 === 2020);
  ok('pandemic peaks in 2020-24', L.peak(r) === i2020, JSON.stringify(r.map((x) => x == null ? x : +x.toFixed(1))));
  ok('pandemic 2020-24 is 10x its 2015-19 rate', r[i2020] > 10 * r[i2020 - 1]);
}

// --- end-of-line labels ------------------------------------------------------------
// A stand-in font: 7px a character, about 600 12px system-ui. "sustainability" is a courses
// preset that the old 13-character cap cut to "sustainabili…" on the default view.
{
  const m7 = (t) => 7 * [...t].length;
  const desk = L.fitLabels(['climate', 'sustainability', 'energy'], m7, { max: 150 });
  eq('a 14-letter preset is shown whole', desk.texts, ['climate', 'sustainability', 'energy']);
  eq('the margin fits the widest label plus pad and gap', desk.margin, 98 + 12);
  ok('every shown label fits inside the margin', desk.texts.every((t) => m7(t) + 12 <= desk.margin));
  eq('short labels get a short margin', L.fitLabels(['war'], m7).margin, 33);
  eq('no labels: the minimum margin', L.fitLabels([], m7).margin, 24);
  const phone = L.fitLabels(['entrepreneurship', 'ai'], m7, { max: 100 });
  ok('a label too wide for a phone is shortened with "…"', phone.texts[0].endsWith('…') && phone.texts[0].length < 16, phone.texts[0]);
  ok('the shortened label fits', m7(phone.texts[0]) + 12 <= phone.margin && phone.margin <= 100, JSON.stringify(phone));
  eq('it keeps as many characters as fit', phone.texts[0], 'entrepreneu…');
  eq('a short label next to it is untouched', phone.texts[1], 'ai');
  eq('no dangling space before "…"', L.fitLabels(['big game tonight'], m7, { max: 75 }).texts[0], 'big game…');
  // The four edges of the shrink loop and the default cap. The stand-in font and the shipped
  // presets never make a label exactly as wide as the room, and never shrink one to a single
  // character, so none of these cases was reachable from m7.
  const m10 = (t) => 10 * [...t].length;
  const box = { min: 0, pad: 0, gap: 0 };
  eq('a label exactly as wide as the room is kept whole', L.fitLabels(['a'], m10, { ...box, max: 10 }).texts, ['a']);
  eq('one unit too wide, and a one-character label becomes just the ellipsis', L.fitLabels(['a'], m10, { ...box, max: 9 }).texts, ['…']);
  eq('it drops exactly one character when that is enough', L.fitLabels(['ab'], m10, { ...box, max: 11 }).texts, ['a…']);
  eq('it never shrinks a long label past one character', L.fitLabels(['sustainability'], m10, { ...box, max: 11 }).texts, ['s…']);
  eq('the default max is 120', L.fitLabels(['sustainability'], (t) => 11 * [...t].filter((c) => c !== '…').length, box).margin, 110);
  eq('no labels and no minimum: the margin is just pad and gap', L.fitLabels([], m10, { min: 0 }).margin, 12);

  // Every preset term on the three pages, at a desktop margin, is drawn whole.
  const here = fileURLToPath(new URL('.', import.meta.url));
  const daily = JSON.parse(readFileSync(here + 'data/presets.json', 'utf8')).presets.flatMap((p) => p.terms ?? L.parseTerms(p.q ?? ''));
  ok('the Daily presets were read', daily.length >= 10, daily.length);
  ok('no Daily preset is shortened on a desktop', L.fitLabels(daily, m7, { max: 150 }).texts.every((t) => !t.endsWith('…')));
}

// --- words the index does not keep ------------------------------------------------
// The shapes are the measured ones (2026-11-19): "the" came back as each scanned bin's exact
// total and 0 on the web; "stanford" ran 25-72% of the scans.
{
  const here = fileURLToPath(new URL('.', import.meta.url));
  const D = JSON.parse(readFileSync(here + 'data/presets.json', 'utf8'));
  const { bins, totals } = D;
  const scan = bins.map((b) => !L.isWeb(b));
  const the = totals.map((t, i) => (scan[i] ? t : 0));
  ok('"the": every scanned bin is its total, so it is ignored', L.ignoredByIndex(the, totals, bins));
  ok('the web half does not have to agree (it reads ~0)', L.ignoredByIndex(the.map((c, i) => (scan[i] ? c : 3)), totals, bins));
  const one = the.slice(); one[0] -= 1;
  ok('one scanned bin short of its total: a real word', !L.ignoredByIndex(one, totals, bins));
  const last = the.slice(); last[bins.findIndex(L.isWeb) - 1] -= 1;
  ok('the LAST scanned bin short of its total: a real word', !L.ignoredByIndex(last, totals, bins));
  ok('"stanford" at 72% is kept', !L.ignoredByIndex(totals.map((t) => Math.round(t * 0.72)), totals, bins));
  const gaps = the.map((c, i) => (i < 3 ? c : null));
  ok('three known bins at their totals are enough', L.ignoredByIndex(gaps, totals, bins));
  ok('two are not', !L.ignoredByIndex(gaps.map((c, i) => (i < 2 ? c : null)), totals, bins));
  ok('nothing known: not ignored', !L.ignoredByIndex(totals.map(() => null), totals, bins));
  ok('no counts at all: not ignored, and no throw', !L.ignoredByIndex(undefined, totals, bins));
  ok('a never-said word (all zeros) is not ignored', !L.ignoredByIndex(totals.map(() => 0), totals, bins));
  // Two boundaries the audit had accepted as unreachable, added 2026-11-20 after the
  // equivalence sweep was widened and showed both were killable, not equivalent.
  // A bin with no articles at all must be SKIPPED, not read as a count agreeing with its
  // total: with `>` relaxed to `>=`, all-zero totals start agreeing and the word is flagged.
  ok('bins with zero totals are skipped, not counted as agreement',
    !L.ignoredByIndex(bins.map(() => 0), bins.map(() => 0), bins));
  // And a total of exactly 1 is a real scanned bin: with the 0 raised to 1 it is skipped,
  // leaving fewer than three seen bins and losing the flag.
  ok('a total of exactly one is still a scanned bin',
    L.ignoredByIndex(bins.map(() => 1), bins.map(() => 1), bins));
  // The shipped presets were baked through the same search, so none of them can be flagged.
  ok('no baked preset term is flagged', Object.values(D.counts).every((c) => !L.ignoredByIndex(c, totals, bins)));
}
{
  // plotted: draw the axis only when some line rises above zero
  const z = { rates: [0, 0, null, 0] }, r = { rates: [0, null, 0.4, 0] };
  ok('plotted: nothing asked is nothing drawn', !L.plotted([]));
  ok('plotted: undefined is nothing, and no throw', !L.plotted(undefined));
  ok('plotted: a never-said word alone is not drawn', !L.plotted([z]));
  ok('plotted: all-null rates (a phrase with no counts) are not drawn', !L.plotted([{ rates: [null, null] }]));
  ok('plotted: one real line beside a zero line is drawn', L.plotted([z, r]));
  ok('plotted: the real line may come first', L.plotted([r, z]));
  ok('plotted: a single positive bin at the very end counts', L.plotted([{ rates: [0, 0, 0, 1e-6] }]));
}

// --- the "each at its peak" scale --------------------------------------------------------
{
  eq('relative: the peak is 100 and the rest scale with it', L.relative([0, 15, 30, 7.5]), [0, 50, 100, 25]);
  eq('relative: the peak may be anywhere, not only the last bin', L.relative([40, 10, 20]), [100, 25, 50]);
  eq('relative: null (a phrase after 2014) stays null', L.relative([10, 20, null]), [50, 100, null]);
  eq('relative: a never-printed word has no peak, so no line', L.relative([0, 0, 0]), [null, null, null]);
  eq('relative: all-null stays all-null', L.relative([null, null]), [null, null]);
  // the point of the scale: covid at 1,813 and divest at 93 both reach 100
  const big = L.relative([0, 1813, 232]), small = L.relative([93.2, 20, 0]);
  eq('relative: two words of very different size share one top', [Math.max(...big), Math.max(...small)], [100, 100]);
  eq('relative: does not modify its input', (() => { const a = [1, 2]; L.relative(a); return a; })(), [1, 2]);
  eq('peak ticks run 0-100', L.PEAK_TICKS, [0, 25, 50, 75, 100]);
  // URL: the default scale leaves old links byte-identical; peak rides along and round-trips
  eq('state: rate scale adds nothing', L.encodeState(['axe'], 'rate'), '?q=axe');
  eq('state: peak scale is encoded', L.encodeState(['big game', 'axe'], 'peak'), '?q=big%20game,axe&scale=peak');
  eq('state: peak with no words still says so', L.encodeState([], 'peak'), '?scale=peak');
  eq('scale decodes peak', L.decodeScale('?q=axe&scale=peak'), 'peak');
  eq('scale defaults to rate', L.decodeScale('?q=axe'), 'rate');
  eq('scale: an unknown value is the default', L.decodeScale('?scale=log'), 'rate');
  eq('scale: empty search is the default', L.decodeScale(''), 'rate');
  eq('scale: words still decode beside it', L.decodeState('?q=big%20game,axe&scale=peak'), ['big game', 'axe']);
}

// --- boundaries the round-number tests never reached (2026-11-23 mutation sweep) ---------
{
  // relative(): the guard is `max > 0`, and every existing test has a peak well above 1,
  // so `max > 1` passed all of them. A rare phrase really can peak below 1 per 10,000.
  eq('relative: a peak below 1 still scales to 100', L.relative([0.4, 0.8]), [50, 100]);
  eq('relative: a peak of exactly 1 is a peak, not "never printed"', L.relative([0.25, 1]), [25, 100]);
  eq('relative: a sub-1 peak beside a zero', L.relative([0, 0.5]), [0, 100]);
  // The all-zero case is already tested above; assert the NaN explicitly, because the old
  // JSON.stringify compare could not tell 0/0 from the null it is supposed to return.
  ok('relative: an all-zero series is null, never NaN',
     L.relative([0, 0, 0]).every((v) => v === null), JSON.stringify(L.relative([0, 0, 0])));

  // clipBins(): a five-year bin ends 4 years after it starts, never 5, or the bins overlap.
  for (const b of L.BINS) {
    const endY = +b.end.slice(0, 4);
    ok(`bin ${L.binLabel(b)} ends in its own last year`, endY === b.y1, `end ${b.end} y1 ${b.y1}`);
  }
  for (let i = 0; i + 1 < L.BINS.length; i++) {
    const a = L.BINS[i], c = L.BINS[i + 1];
    if (a.src !== c.src) continue;
    ok(`bin ${L.binLabel(a)} does not overlap ${L.binLabel(c)}`, a.end < c.start, `${a.end} vs ${c.start}`);
  }

  // clipBins() direct: the shipped FIRST/LAST never land inside the window where the bin-end
  // comparison can flip, so with BINS alone `${y + 4}` and `${y + 5}` in the CONDITION pick the
  // same branch for every bin. Feeding it a `last` that IS a five-year end exercises the
  // boundary the shipped data cannot reach. (clipBins is exported only so this can be tested.)
  {
    const b = L.clipBins('print', '1990-01-01', '1994-12-31');
    eq('clipBins: a run ending exactly on a bin end is one whole bin',
       b.map((x) => [x.start, x.end]), [['1990-01-01', '1994-12-31']]);
    const c = L.clipBins('print', '1990-01-01', '1995-06-30');
    eq('clipBins: one day past a bin end opens the next bin, clipped',
       c.map((x) => [x.start, x.end]), [['1990-01-01', '1994-12-31'], ['1995-01-01', '1995-06-30']]);
    const d = L.clipBins('web', '1992-03-04', '1999-12-31');
    eq('clipBins: a mid-bin start keeps the real first day and five-year ends after it',
       d.map((x) => [x.start, x.end, x.y0, x.y1]),
       [['1992-03-04', '1994-12-31', 1992, 1994], ['1995-01-01', '1999-12-31', 1995, 1999]]);
  }

  // tailPlan(): `last.y0 - (last.y0 % 5)` rounds the last bin down to its five-year start.
  // Every shipped bin starts on a multiple of 5, which makes `-` and `+` give the same
  // answer, so the sweep could not tell them apart. A last bin that does NOT start on a
  // multiple of 5 is reachable the moment WEB_FIRST moves, and there the two differ.
  const offBin = { y0: 2026, y1: 2026, start: '2026-01-01', end: '2026-10-25', src: 'web' };
  const off = L.tailPlan([offBin], '2030-06-01');
  eq('tailPlan clamps an off-cycle last bin to 2029, not 2031', off && off.bin.end, '2029-12-31');
  // and pin the premise itself, so this stays honest if the data moves
  ok('every bin starts on its own five-year boundary or the series start',
     L.BINS.every((b) => b.y0 % 5 === 0 || b.start === L.FIRST || b.start === L.WEB_FIRST),
     JSON.stringify(L.BINS.map((b) => b.y0)));
}

console.log(`${fail ? 'FAILED' : 'ok'}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
