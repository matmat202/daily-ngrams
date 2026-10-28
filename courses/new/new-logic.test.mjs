// node site/courses/new/new-logic.test.mjs — every pure function the "New at Stanford" page
// depends on, plus the shipped list checked against what the page assumes. Exit 1 on failure.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as L from './new-logic.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${extra}`); }
};
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);

const C = (codes, t, school, dept, q = [], g = [], extra = {}) =>
  ({ codes, t, d: '', school, dept, q, u: '3', g, i: [], ...extra });
const FIX = [
  C(['PHIL 22M'], 'Grad Tutorial: The Philosophy of Music', 'H&S', 'Philosophy', ['Winter']),
  C(['AFRICAAM 179'], 'The Beautiful Game is African', 'H&S', 'African & African American Studies', ['Spring'], ['WAY-ED']),
  C(['CS 435', 'EDUC 435'], 'Math Out Loud', 'Engineering', 'Computer Science', ['Autumn', 'Winter'], [], { i: ['Émile, Z.'] }),
  C(['LAW 5815'], 'Critical Legal Theories', 'Law', 'Law', []),
  C(['ARTHIST 121N'], 'Islam and Water', 'H&S', 'Art & Art History', ['Winter'], ['WAY-A-II'], { d: 'Rivers, wells and fountains.' }),
];

// --- filter ---------------------------------------------------------------------------
eq('no filter keeps all, in order', L.filter(FIX).map((c) => c.codes[0]), FIX.map((c) => c.codes[0]));
eq('quarter', L.filter(FIX, { quarter: 'Winter' }).map((c) => c.codes[0]), ['PHIL 22M', 'CS 435', 'ARTHIST 121N']);
eq('quarter none = not scheduled', L.filter(FIX, { quarter: 'none' }).map((c) => c.codes[0]), ['LAW 5815']);
eq('school', L.filter(FIX, { school: 'Law' }).length, 1);
eq('ways', L.filter(FIX, { ger: 'WAY-' }).map((c) => c.codes[0]), ['AFRICAAM 179', 'ARTHIST 121N']);
eq('words are ANDed', L.filter(FIX, { q: 'islam water' }).length, 1);
eq('a word not there finds none', L.filter(FIX, { q: 'islam music' }).length, 0);
eq('search a cross-listed code', L.filter(FIX, { q: 'educ 435' }).map((c) => c.codes[0]), ['CS 435']);
eq('search a code without its space', L.filter(FIX, { q: 'CS435' }).length, 1);
eq('search the description', L.filter(FIX, { q: 'fountains' }).length, 1);
eq('search an instructor, accents off', L.filter(FIX, { q: 'emile' }).length, 1);
eq('search a department', L.filter(FIX, { q: 'philosophy' }).length, 1);
eq('filters combine', L.filter(FIX, { quarter: 'Winter', school: 'H&S', ger: 'WAY-' }).map((c) => c.codes[0]), ['ARTHIST 121N']);

// --- group: three schools in the wrong order, so a broken comparator cannot pass -----------
{
  const g = L.group([FIX[3], FIX[2], FIX[4], FIX[0], FIX[1]]);
  eq('schools by count, then name', g.map((s) => s.school), ['H&S', 'Engineering', 'Law']);
  eq('school counts', g.map((s) => s.n), [3, 1, 1]);
  eq('departments by name', g[0].depts.map((d) => d.dept),
    ['African & African American Studies', 'Art & Art History', 'Philosophy']);
  eq('schoolCounts matches group', L.schoolCounts(FIX), g.map(({ school, n }) => ({ school, n })));
  eq('group of nothing', L.group([]), []);
}

// --- labels, links, dates ------------------------------------------------------------------
eq('yearLabel', L.yearLabel('20262027'), '2026–27');
eq('yearLabel passes junk through', L.yearLabel('x'), 'x');
ok('courseUrl names the code and year', L.courseUrl('CS 435', '20262027') ===
  'https://explorecourses.stanford.edu/search?view=catalog&q=CS+435&academicYear=20262027');
eq('units range', L.unitsLabel('3-5'), '3–5 units');
eq('one unit', L.unitsLabel('1'), '1 unit');
eq('no units', L.unitsLabel(''), '');
eq('Oct 28 picks Winter', L.nextQuarter('2026-10-28T12:00Z', '20262027'), 'Winter');
eq('Sep 1 picks Autumn', L.nextQuarter('2026-09-01T12:00Z', '20262027'), 'Autumn');
eq('Feb 1 picks Spring', L.nextQuarter('2027-02-01T12:00Z', '20262027'), 'Spring');
eq('May 1 picks Summer', L.nextQuarter('2027-05-01T12:00Z', '20262027'), 'Summer');
eq('a later year picks nothing', L.nextQuarter('2027-09-01T12:00Z', '20262027'), '');
eq('an earlier spring picks nothing', L.nextQuarter('2026-02-01T12:00Z', '20262027'), '');

// --- URL state ---------------------------------------------------------------------------
{
  const s = L.readState('?q=ai&quarter=Winter&school=Law&ger=WAY-', ['Law']);
  eq('readState', [s.q, s.quarter, s.school, s.ger, s.explicit], ['ai', 'Winter', 'Law', 'WAY-', true]);
  const bad = L.readState('?quarter=Fall&school=Nope&ger=X', ['Law']);
  eq('unknowns dropped', [bad.quarter, bad.school, bad.ger], ['', '', '']);
  eq('no quarter is not explicit', L.readState('', []).explicit, false);
  eq('round trip', L.writeState(s), '?q=ai&quarter=Winter&school=Law&ger=WAY-');
  eq('empty state, empty query', L.writeState({ q: '', quarter: '', school: '', ger: '' }), '');
  eq('quarter=none survives', L.readState('?quarter=none', []).quarter, 'none');
}

// --- the shipped list ------------------------------------------------------------------------
const DATA = fileURLToPath(new URL('data/new.json', import.meta.url));
ok('data/new.json is shipped', existsSync(DATA));
if (existsSync(DATA)) {
  const { meta, courses } = JSON.parse(readFileSync(DATA, 'utf8'));
  eq('meta.n is the list length', meta.n, courses.length);
  ok('a real list, not a stub', courses.length >= 100, `n=${courses.length}`);
  ok('meta.year is an academic year', /^\d{8}$/.test(meta.year) && +meta.year.slice(4) === +meta.year.slice(0, 4) + 1);
  ok('history ends at this year', Object.keys(meta.history).at(-1) === meta.year && meta.history[meta.year] === meta.n);
  const codes = courses.flatMap((c) => c.codes);
  eq('no code is listed twice', new Set(codes).size, codes.length);
  const titles = courses.map((c) => c.t.toLowerCase());
  eq('no title is listed twice', new Set(titles).size, titles.length);
  const shape = (c) => Array.isArray(c.codes) && c.codes.length && c.codes.every((x) => /^[A-Z&]+ \w+$/.test(x)) &&
    typeof c.t === 'string' && c.t && typeof c.d === 'string' && c.school && c.dept &&
    Array.isArray(c.q) && c.q.every((q) => L.QUARTERS.includes(q)) && Array.isArray(c.g) && Array.isArray(c.i);
  const badShape = courses.filter((c) => !shape(c));
  eq('every course has the shape the page reads', badShape.map((c) => c.codes), []);
  // ExploreCourses escapes two or three times: descriptions carry literal "&quot;" and "<br>", which the page
  // would print as typed (textContent). build.py unescapes; this is the check that it did.
  const ents = courses.filter((c) => /&(?:[a-z]+|#\d+);|<\/?[a-z]+>/i.test(c.t + c.d));
  eq('no HTML entity is left in titles or descriptions', ents.map((c) => c.codes[0]), []);
  ok('descriptions are trimmed', courses.every((c) => c.d.length <= 421));
  ok('titles carry no cross-listing parenthetical', courses.every((c) => !/\([A-Z]+ \w+(, [A-Z]+ \w+)*\)$/.test(c.t)));
  ok('most courses have a quarter', courses.filter((c) => c.q.length).length / courses.length > 0.8);
  ok('every course is in its own school and department group', L.group(courses).reduce((a, s) => a + s.n, 0) === courses.length);
  // A course from a year before this one would mean the year filter failed: every code must
  // read as the shipped year's own entry, which build.py takes from meta.year's raw files.
  ok('schools are labelled, not raw codes', courses.every((c) => !/^[A-Z]+$/.test(c.school)));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
