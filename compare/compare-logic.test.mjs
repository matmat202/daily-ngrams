// node site/compare/compare-logic.test.mjs — every pure function the Three Ngrams page
// depends on, plus the two shipped tables it reads checked through those functions. The
// Daily's counts are live, so they are faked here; the real archive is the shot's job.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as L from './compare-logic.js';
import { BINS } from '../ngram-logic.js';
import { parseRows } from '../theses/thesis-logic.js';
import { parseTable } from '../courses/course-logic.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${extra}`); } };
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);

// --- parseWord: the strictest of the three sources' rules -------------------------------
eq('one word, folded', L.parseWord('  Génes '), { term: 'genes', why: null });
eq('a hyphen is a two-word phrase', L.parseWord('in-person').term, 'in person');
eq('only the first comma part', L.parseWord('gene, war').term, 'gene');
ok('a prefix * is refused, naming why', L.parseWord('neur*').term === null && /Daily/.test(L.parseWord('neur*').why), L.parseWord('neur*').why);
ok('three words are refused', L.parseWord('history of science').term === null);
ok('punctuation alone is refused', L.parseWord('--').term === null);
eq('possessive dropped as the course table does', L.parseWord("women's").term, 'women');

// --- the time axis ----------------------------------------------------------------------
eq('a 5-year bin sits at its middle', L.binX({ y0: 1950, y1: 1954 }), 1952.5);
eq('a clipped bin sits at its own middle', L.binX({ y0: 2025, y1: 2026 }), 2026);
eq('an academic year sits in its spring', L.yearX('2009-10'), 2010);
const db = L.dailyBins();
eq('Daily bins start at FROM', db[0].y0, L.FROM);
ok('Daily bins keep their index into BINS', db.every((b) => BINS[b.i].y0 === b.y0 && BINS[b.i].src === b.src));
eq('Daily bins run to the web years', db.at(-1).src, 'web');
eq('Daily bins: 21 print + 3 web', db.length, 24);

// --- relative ---------------------------------------------------------------------------
eq('relative to its own max', L.relative([1, 2, 4, null]), [25, 50, 100, null]);
eq('all zero is all null, not 0%', L.relative([0, 0, null]), [null, null, null]);
eq('empty is empty', L.relative([]), []);

// --- series and peaks -------------------------------------------------------------------
// totals differ per bin (by index into BINS), so reading them by position would show
const totals = BINS.map((_, i) => 1000 + 100 * i);
const T0 = (lab) => totals[BINS.findIndex((b) => `${b.y0}–${String(b.y1).slice(2)}` === lab)];
const counts = db.map((b, k) => (b.y0 === 1965 ? 50 : b.src === 'web' ? 12 : 10));
const ds = L.dailySeries(counts, totals, 1.2);
eq('daily rate per 10,000 of its own bin', ds.find((p) => p.label === '1965–69').r, (50 / T0('1965–69')) * 10000);
eq('daily total is its own bin', ds[0].of, T0('1910–14'));
eq('web years divided by webScale', ds.at(-1).r, (12 / totals.at(-1)) * 10000 / 1.2);
eq('daily peak picks the bin', L.peakPoint(ds).label, '1965–69');
const dsNull = L.dailySeries(db.map((b) => (b.src === 'web' ? null : 3)), totals, 1.2);
eq('a web null stays null', dsNull.at(-1).r, null);
eq('peak ties go to the earliest', L.peakPoint([{ x: 1, r: 2 }, { x: 2, r: 2 }]).x, 1);
eq('no peak when never used', L.peakPoint([{ x: 1, r: 0 }, { x: 2, r: null }]), null);
eq('no peak for no series', L.peakPoint(null), null);
eq('gap rounds to 5 years', L.peakGap({ x: 1952.5 }, { x: 1977.5 }), 25);
eq('gap rounds an odd gap', L.peakGap({ x: 1952.5 }, { x: 1966 }), 15);
eq('gap is signed', L.peakGap({ x: 1992.5 }, { x: 1967.5 }), -25);
eq('gap needs both', L.peakGap(null, { x: 1 }), null);

// --- URL state --------------------------------------------------------------------------
eq('encode a phrase', L.encodeState('big game'), '?q=big+game');
eq('decode through parseWord', L.decodeState('?q=Gene%2Cwar'), 'gene');
eq('round trip', L.decodeState(L.encodeState('machine learning')), 'machine learning');
eq('no q is null', L.decodeState(''), null);
eq('source link', L.sourceUrl(L.SOURCES[1], 'big game'), '../theses/?q=big+game');
eq('three sources, Daily first', L.SOURCES.map((s) => s.id), ['daily', 'theses', 'courses']);

// --- the shipped tables, read the way the page reads them --------------------------------
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
if (existsSync(here('../theses/data/theses.tsv')) && existsSync(here('../courses/data/terms.tsv'))) {
  const tmeta = JSON.parse(readFileSync(here('../theses/data/meta.json'), 'utf8'));
  const { rows } = parseRows(readFileSync(here('../theses/data/theses.tsv'), 'utf8'));
  const cmeta = JSON.parse(readFileSync(here('../courses/data/meta.json'), 'utf8'));
  const { table } = parseTable(readFileSync(here('../courses/data/terms.tsv'), 'utf8'), cmeta.years.length);
  const ts = L.thesisSeries(rows, 'gene', tmeta.last);
  eq('thesis series starts at FROM', ts[0].label.slice(0, 4), String(L.FROM));
  ok('thesis series reaches the last year', ts.at(-1).label.includes(String(tmeta.last).slice(2)), ts.at(-1).label);
  // anti-vacuity: the measured finding the page is built on (state/scratch/ngram-lag) must
  // still come out of the shipped data, or a broken join would draw plausible flat lines
  const tp = L.peakPoint(ts);
  ok('gene peaks in thesis titles after 1985', tp && tp.x > 1985, JSON.stringify(tp));
  const rel = L.relative(ts.map((p) => p.r));
  ok('gene is under 20% of its peak before 1950', ts.every((p, k) => p.x > 1950 || rel[k] == null || rel[k] < 20));
  const tr = L.thesisSeries(rows, 'relation', tmeta.last);
  ok('relation peaks in thesis titles before 1960', L.peakPoint(tr).x < 1960, JSON.stringify(L.peakPoint(tr)));
  ok('thesis counts sum to the titles that match', ts.reduce((a, p) => a + p.n, 0) > 300);
  const cs = L.courseSeries(table, 'climate', cmeta);
  eq('course series: one point per year', cs.length, cmeta.years.length);
  ok('climate peaks in a recent course year', L.peakPoint(cs).x >= 2024, JSON.stringify(L.peakPoint(cs)));
  ok('climate starts well under its peak', L.relative(cs.map((p) => p.r))[0] < 40);
  eq('a word under the floor is null, not zeros', L.courseSeries(table, 'xyzzyplugh', cmeta), null);
  for (const w of L.PRESETS) {
    ok(`preset ${w} is in both tables`, L.courseSeries(table, w, cmeta) && L.peakPoint(L.thesisSeries(rows, w, tmeta.last)));
  }
} else { console.log('SKIP shipped-data checks: tables missing'); fail++; }

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
