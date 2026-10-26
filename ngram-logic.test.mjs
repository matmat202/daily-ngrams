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
eq('25 five-year bins', L.BINS.length, 25);
eq('first bin starts at the first issue', L.BINS[0].start, '1892-09-19');
eq('first bin label is clipped', L.binLabel(L.BINS[0]), '1892–94');
eq('last bin ends at the last issue', L.BINS.at(-1).end, '2014-06-13');
eq('last bin years', [L.BINS.at(-1).y0, L.BINS.at(-1).y1], [2010, 2014]);
// contiguous: each bin starts the day after the previous one ends, so no article is
// counted twice or dropped between bins
let contiguous = true;
for (let i = 1; i < L.BINS.length; i++) {
  const prev = new Date(L.BINS[i - 1].end + 'T00:00:00Z');
  const next = new Date(L.BINS[i].start + 'T00:00:00Z');
  if (next - prev !== 86400000) contiguous = false;
}
ok('bins are contiguous with no gap or overlap', contiguous);

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

// --- rates & peak -------------------------------------------------------------------
eq('rate per 10k', L.rates([5, 0], [10000, 20000]), [5, 0]);
eq('missing count is null, not 0', L.rates([null, 3], [100, 100]), [null, 300]);
eq('zero total is null', L.rates([1], [0]), [null]);
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
eq('data bins are the logic bins', D.bins, L.BINS);
ok('every bin has articles', D.totals.length === 25 && D.totals.every((t) => t > 1000), JSON.stringify(D.totals));
ok('about 695k articles', Math.abs(D.totals.reduce((a, c) => a + c, 0) - 695000) < 20000);
ok('at least five presets', D.presets.length >= 5);
for (const p of D.presets) {
  ok(`preset ${p.id} has 1-4 terms`, p.terms.length >= 1 && p.terms.length <= L.MAX_TERMS);
  for (const t of p.terms) {
    eq(`preset term "${t}" is already clean`, L.cleanTerm(t), t);
    const c = D.counts[t];
    ok(`preset term "${t}" has 25 counts`, Array.isArray(c) && c.length === 25 && c.every(Number.isInteger));
    ok(`preset term "${t}" is never more than every article`, c.every((n, i) => n <= D.totals[i]));
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

console.log(`${fail ? 'FAILED' : 'ok'}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
