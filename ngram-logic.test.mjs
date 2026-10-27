// node site/ngram-logic.test.mjs — every pure function the page depends on, plus the
// shipped data checked against the logic that reads it. Exit 1 on any failure.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as L from './ngram-logic.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${extra}`); }
};
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);

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
ok('long input capped', L.cleanTerm('a'.repeat(100)).length <= 40);
eq('comma list parsed', L.parseTerms('computer, Internet ,big game'), ['computer', 'internet', 'big game']);
eq('duplicates removed', L.parseTerms('war, War, WAR'), ['war']);
eq('blanks skipped', L.parseTerms(',,war,,'), ['war']);
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

console.log(`${fail ? 'FAILED' : 'ok'}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
