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

// --- groups (course-dept): URL state, menu, links ---------------------------------------
{
  const G = [
    { id: 'CS', kind: 'dept', label: 'Computer Science', school: 'Engineering' },
    { id: 'humanities-sciences', kind: 'school', label: 'Humanities & Sciences' },
    { id: 'HISTORY', kind: 'dept', label: 'History', school: 'Humanities & Sciences' },
    { id: 'engineering', kind: 'school', label: 'Engineering' },
    { id: 'AA', kind: 'dept', label: 'Aeronautics and Astronautics', school: 'Engineering' },
    { id: 'law', kind: 'school', label: 'Law' },
    { id: 'ANTHRO', kind: 'dept', label: 'Anthropology', school: 'Humanities & Sciences' },
  ];
  eq('state with a group round-trips', [L.decodeState(L.encodeState(['ai'], 'CS')), L.decodeGroup(L.encodeState(['ai'], 'CS'), G)?.id], [['ai'], 'CS']);
  eq('no group leaves no g=', L.encodeState(['ai']), '?q=ai');
  eq('a group with no terms still encodes', L.encodeState([], 'CS'), '?g=CS');
  eq('?g= matches ignoring case', L.decodeGroup('?g=cs', G)?.id, 'CS');
  eq('an unknown ?g= is all of Stanford', L.decodeGroup('?g=NOPE', G), null);
  eq('no ?g= is all of Stanford', L.decodeGroup('?q=ai', G), null);
  const m = L.menu(G);
  // Seven groups given out of order: schools, then each school's departments, all by label.
  eq('menu sections in order', m.map((x) => x.label), ['Schools', 'Engineering', 'Humanities & Sciences']);
  eq('schools by label', m[0].groups.map((g) => g.id), ['engineering', 'humanities-sciences', 'law']);
  eq('departments by label within a school', m[1].groups.map((g) => g.id), ['AA', 'CS']);
  eq('every group appears once', m.flatMap((x) => x.groups).length, G.length);
  const u = new URL(L.searchUrl('ai', '2025-26', 'CS'));
  eq('a department link filters ExploreCourses', u.searchParams.get('filter-departmentcode-CS'), 'on');
  ok('no department, no filter', ![...new URL(L.searchUrl('ai', '2025-26')).searchParams.keys()].some((k) => k.startsWith('filter-')));
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
  // --- groups: each file read the way the page reads it, checked against all of Stanford
  const groups = meta.groups || [];
  ok('schools and departments ship', groups.filter((g) => g.kind === 'school').length >= 8 && groups.filter((g) => g.kind === 'dept').length >= 50, `${groups.length} groups`);
  eq('group ids are unique', new Set(groups.map((g) => g.id)).size, groups.length);
  eq('group files are unique ignoring case', new Set(groups.map((g) => g.file.toLowerCase())).size, groups.length);
  const T = new Map();
  for (const g of groups) {
    const gt = L.parseTable(readFileSync(dir + 'g/' + g.file, 'utf8'), n);
    T.set(g.id, gt.table);
    if (gt.bad || gt.table.size !== g.terms || g.totals.length !== n) { fail++; console.log(`FAIL group ${g.id}: bad ${gt.bad}, ${gt.table.size} terms vs meta ${g.terms}`); continue; }
    let gover = 0, gunder = 0;
    for (const [k, cs] of gt.table) {
      if (cs.reduce((a, b) => a + b, 0) < meta.groupMin) gunder++;
      if (cs.some((c, i) => c > g.totals[i])) gover++;
    }
    if (gover || gunder) { fail++; console.log(`FAIL group ${g.id}: ${gover} terms over its totals, ${gunder} under the floor`); }
    pass++;
  }
  ok('every school or department total fits inside Stanford\'s', groups.every((g) => g.totals.every((t, i) => t <= meta.totals[i])));
  const schools = groups.filter((g) => g.kind === 'school');
  // A course is in one department's school or (cross-listed) several, so Stanford's count
  // lies between the biggest school's and the sum of the schools', plus the few courses of
  // schools too small to list (meta.unlisted, VPTL's 43). The sum only bounds a term every
  // school ships: under a school's floor its count is unknown, not 0. A table assigned to
  // the wrong year, or a school file holding one department, breaks one side.
  const un = meta.unlisted || meta.years.map(() => 0);
  let between = 0, checked = 0, full = 0;
  for (const term of ['the', 'research', 'climate', 'machine learning', 'history', 'ai', 'ethics', 'students']) {
    const all = L.lookup(table, term);
    const per = schools.map((g) => T.get(g.id).get(term));
    const everyone = per.every(Boolean);
    full += everyone;
    for (let i = 0; i < n; i++) {
      checked++;
      const xs = per.map((cs) => (cs ? cs[i] : 0));
      if (Math.max(...xs) <= all[i] && (!everyone || all[i] <= xs.reduce((a, b) => a + b, 0) + un[i])) between++;
    }
  }
  eq('Stanford\'s count lies between the largest school\'s and the schools\' sum', between, checked);
  ok('the sum bound was tested on 3+ terms every school ships', full >= 3, `${full}`);
  const totalsBetween = meta.totals.every((t, i) => Math.max(...schools.map((g) => g.totals[i])) <= t && t <= schools.reduce((a, g) => a + g.totals[i], 0) + un[i]);
  ok('the unlisted schools are small', un.reduce((a, b) => a + b, 0) < 500, JSON.stringify(un));
  ok('Stanford\'s course total lies between the largest school\'s and the sum', totalsBetween);
  // A department is inside its school: same term, same year, never more courses.
  let inside = 0, din = 0;
  for (const g of groups.filter((x) => x.kind === 'dept')) {
    const s = schools.find((x) => x.label === g.school);
    if (!s) continue;
    din++;
    const dt = T.get(g.id), st = T.get(s.id);
    if (g.totals.some((t, i) => t > s.totals[i])) continue;
    let okd = true;
    for (const [k, cs] of dt) { const sc = st.get(k); if (sc && cs.some((c, i) => c > sc[i])) { okd = false; break; } }
    if (okd) inside++;
  }
  ok('every department sits inside its school', din > 50 && inside === din, `${inside}/${din}`);
  // Anti-vacuity, known history: CS uses "machine learning" far more than History does,
  // and Doerr (sustainability) uses "climate" more than Stanford as a whole.
  const rate = (id, t) => { const g = groups.find((x) => x.id === id); return L.rates(T.get(id).get(t), g.totals); };
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  ok('CS uses "machine learning" 10x more than Stanford does', avg(rate('CS', 'machine learning')) > 10 * avg(L.rates(L.lookup(table, 'machine learning'), meta.totals)));
  ok('Doerr uses "climate" 3x more than Stanford does', avg(rate('sustainability-doerr', 'climate')) > 3 * avg(L.rates(L.lookup(table, 'climate'), meta.totals)));
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
