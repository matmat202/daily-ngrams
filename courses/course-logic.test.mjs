// node site/courses/course-logic.test.mjs — every pure function the courses page depends
// on, plus the shipped data checked against the logic that reads it. Exit 1 on any failure.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as L from './course-logic.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${extra}`); }
};
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
const key = (s) => L.termKey(s).key;

// --- keys: must be what build.py wrote ------------------------------------------------
eq('fold: accents, case, curly quotes', L.fold('Émile’s ÉCOLE'), "emile's ecole");
eq('a word is lower-cased', key('  Climate '), 'climate');
eq('a hyphen is a space', key('in-person'), 'in person');
eq('a phrase is single-spaced', key('Machine   Learning'), 'machine learning');
eq('a possessive is dropped', key('Stanford’s'), 'stanford');
eq('an inner apostrophe is kept', key("O'Neill"), "o'neill");
eq('a trailing apostrophe is dropped', key("students'"), 'students');
eq('punctuation is a space', key('(ethics)'), 'ethics');
eq('digits are words', key('COVID-19'), 'covid 19');
eq('three words are refused', key('history of science'), null);
ok('three words say why', /at most 2/.test(L.termKey('history of science').why));
eq('a star is refused', key('neur*'), null);
eq('punctuation only is refused', key('--!!'), null);
{
  const p = L.parseTerms('climate, Climate ,, in-person, a b c, d, e, f, g');
  eq('parseTerms dedupes, keys, caps at 4', p.terms, ['climate', 'in person', 'd', 'e']);
  eq('parseTerms reports what it refused', p.refused.map((r) => r.raw), ['a b c']);
}

// --- table, lookup, rates --------------------------------------------------------------
{
  const { table, bad } = L.parseTable(['climate\t1,2,3', 'in person\t0,0,9', 'bad', 'short\t1,2', 'neg\t1,-1,2', 'x\t1,2.5,3', '\t1,2,3', ''].join('\n'), 3);
  eq('parseTable keeps good lines', [...table.keys()], ['climate', 'in person']);
  eq('parseTable counts the bad ones', bad, 5);
  eq('lookup a phrase', L.lookup(table, 'in person'), [0, 0, 9]);
  eq('a term under the floor is null, not zeros', L.lookup(table, 'zoom'), null);
  eq('rates per 1,000 courses', L.rates([1, 0, 5], [4, 2, 10]), [250, 0, 500]);
  eq('a year with no courses is null', L.rates([0, 1], [0, 5]), [null, 200]);
  eq('rates of nothing are all null', L.rates(null, [4, 5]), [null, null]);
}

// --- change ----------------------------------------------------------------------------
eq('change: last three over first three', L.change([1, 1, 1, 5, 3, 3, 3]), 3);
eq('change from zero is null', L.change([0, 0, 0, 1, 2, 3]), null);
eq('change with a missing year is null', L.change([1, null, 1, 2, 2, 2]), null);
eq('fmtChange up', L.fmtChange(3), '×3.0');
eq('fmtChange down', L.fmtChange(0.25), '÷4.0');
eq('fmtChange large', L.fmtChange(14.4), '×14');
eq('fmtChange none', L.fmtChange(null), '');

// --- links and URL state ---------------------------------------------------------------
{
  const u = new URL(L.searchUrl('machine learning', '2009-10'));
  eq('search link names the academic year', u.searchParams.get('academicYear'), '20092010');
  eq('search link carries the term', u.searchParams.get('q'), 'machine learning');
  eq('state round-trips', L.decodeState(L.encodeState(['climate', 'machine learning'])), ['climate', 'machine learning']);
  eq('no state is empty', L.encodeState([]), '');
  eq('no q is null', L.decodeState(''), null);
  eq('a hand-edited q is cleaned', L.decodeState('?q=Climate,(In-Person)'), ['climate', 'in person']);
}

// --- shared helpers really are the Daily page's ---------------------------------------
{
  const D = await import('../ngram-logic.js');
  ok('niceTicks is shared, not copied', L.niceTicks === D.niceTicks);
  ok('fmtRate is shared, not copied', L.fmtRate === D.fmtRate);
}

// --- the shipped data, read the way the page reads it ---------------------------------
const dir = fileURLToPath(new URL('./data/', import.meta.url));
if (existsSync(dir + 'terms.tsv')) {
  const meta = JSON.parse(readFileSync(dir + 'meta.json', 'utf8'));
  const n = meta.years.length;
  const { table, bad } = L.parseTable(readFileSync(dir + 'terms.tsv', 'utf8'), n);
  eq('shipped lines all parse', bad, 0);
  eq('term count matches meta', table.size, meta.terms);
  ok('at least 15 academic years', n >= 15, `got ${n}`);
  ok('years run consecutively', meta.years.every((y, i) => i === 0 || +y.slice(0, 4) === +meta.years[i - 1].slice(0, 4) + 1), meta.years.join(' '));
  ok('every year holds 8,000+ courses', meta.totals.every((t) => t >= 8000), JSON.stringify(meta.totals));
  eq('totals and medians are one per year', [meta.totals.length, meta.medianWords.length], [n, n]);
  let under = 0, over = 0;
  for (const [k, cs] of table) {
    if (cs.reduce((a, b) => a + b, 0) < meta.minDocs) under++;
    if (cs.some((c, i) => c > meta.totals[i])) over++;
    if (L.termKey(k).key !== k) { fail++; console.log(`FAIL shipped key is not its own key: "${k}" -> "${L.termKey(k).key}"`); break; }
  }
  eq('no shipped term is under the floor', under, 0);
  eq('no term is used by more courses than exist', over, 0);
  ok('one- and two-word terms both ship', table.has('climate') && table.has('machine learning'));
  // Anti-vacuity: words whose history is known must move the way it says, so a table that
  // is all zeros, all one row, or shifted by a year cannot pass.
  const r = (t) => L.rates(L.lookup(table, t), meta.totals);
  const ix = (label) => meta.years.indexOf(label);
  const covid = L.lookup(table, 'covid') || [];
  // Past bulletins carry a few later edits (one 2018-19 course names covid), so "absent"
  // means at most 2 courses, against dozens once the pandemic reached the bulletin.
  ok('"covid" is near-absent before 2019-20 and common after', ix('2021-22') > 0 && covid.slice(0, ix('2019-20')).every((c) => c <= 2) && covid[ix('2021-22')] > 20, JSON.stringify(covid));
  const ml = r('machine learning');
  ok('"machine learning" at least doubles since 2009-10', ml.at(-2) > 2 * ml[0], `${ml[0]} -> ${ml.at(-2)}`);
  const the = r('the');
  ok('"the" is in most courses but not every one', the.every((x) => x > 500 && x < 1000), JSON.stringify(the.map(Math.round)));
  ok('a word matches its plural: "network" >= "networks"', (L.lookup(table, 'network') || []).every((c, i) => c >= (L.lookup(table, 'networks') || [])[i]));
  // Cross-listing codes are stripped: FEMGEN was in 461 titles of 2025-26 before. What
  // remains is prose ("FEMGEN majors"), at most 8 a year when this was written.
  ok('subject codes are stripped: "femgen" stays rare', (L.lookup(table, 'femgen') || []).every((c) => c < 20), JSON.stringify(L.lookup(table, 'femgen')));
  for (const p of meta.presets) {
    ok(`preset "${p.label}" terms are already keys`, p.terms.every((t) => key(t) === t), JSON.stringify(p.terms));
    ok(`preset "${p.label}" is in the table`, p.terms.every((t) => table.has(t)), JSON.stringify(p.terms.filter((t) => !table.has(t))));
  }
} else {
  console.log('SKIP shipped-data checks: no data/terms.tsv yet');
  fail++;
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
