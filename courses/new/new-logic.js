/* Pure logic for "New at Stanford": filters, grouping, URL state. No DOM, so node can test
 * every function the page depends on (new-logic.test.mjs). The list itself is decided by
 * projects/course-new/build.py; this file only narrows and arranges what it shipped. */

export const QUARTERS = ['Autumn', 'Winter', 'Spring', 'Summer'];
export const SEARCH = 'https://explorecourses.stanford.edu/search';

/* Lower case, accents off: "Émile" finds "emile". */
export function fold(s) {
  return String(s ?? '').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

/* What one course is searched by: title, every code, department, instructors, description. */
export function haystack(c) {
  return fold([c.t, c.codes.join(' '), c.codes.join(' ').replace(/ /g, ''), c.dept, c.school,
    (c.i || []).join(' '), c.d].join(' \u0001 '));
}

/* Courses matching every filter, in shipped order. q: words, each must appear (AND);
 * quarter: one of QUARTERS, or 'none' for not yet scheduled, or '' for any;
 * school: exact school label or ''; ger: a requirement prefix ('WAY-' for the Ways) or ''. */
export function filter(courses, { q = '', quarter = '', school = '', ger = '' } = {}) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  return courses.filter((c) => {
    if (school && c.school !== school) return false;
    if (quarter === 'none' ? c.q.length > 0 : quarter && !c.q.includes(quarter)) return false;
    if (ger && !c.g.some((g) => g.startsWith(ger))) return false;
    if (!words.length) return true;
    const h = c._h ?? haystack(c);
    return words.every((w) => h.includes(w));
  });
}

/* [{school, n, depts: [{dept, courses}]}], schools by course count (most first, ties by
 * name), departments by name. Counts are of what was passed in, not of the whole year. */
export function group(courses) {
  const bySchool = new Map();
  for (const c of courses) {
    if (!bySchool.has(c.school)) bySchool.set(c.school, new Map());
    const d = bySchool.get(c.school);
    if (!d.has(c.dept)) d.set(c.dept, []);
    d.get(c.dept).push(c);
  }
  return [...bySchool].map(([school, d]) => ({
    school,
    n: [...d.values()].reduce((a, l) => a + l.length, 0),
    depts: [...d].map(([dept, list]) => ({ dept, courses: list }))
      .sort((a, b) => a.dept.localeCompare(b.dept)),
  })).sort((a, b) => b.n - a.n || a.school.localeCompare(b.school));
}

/* Schools with their counts, for the menu: same order as group(). */
export function schoolCounts(courses) {
  return group(courses).map(({ school, n }) => ({ school, n }));
}

/* ExploreCourses search for one code in the shipped academic year ("20262027"). */
export function courseUrl(code, year) {
  const p = new URLSearchParams({ view: 'catalog', q: code, academicYear: year });
  return `${SEARCH}?${p}`;
}

/* "20262027" -> "2026–27". */
export function yearLabel(y) {
  const s = String(y);
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}–${s.slice(6)}` : s;
}

/* The quarter a student would be choosing for on `date`, within the shipped year: after
 * Autumn's add deadline the next pick is Winter, and so on. Stanford's quarters start in
 * late September, early January, late March and late June; enrollment for each opens about
 * six weeks before. A date outside the year gives '' (no default). */
export function nextQuarter(date, year) {
  const y0 = Number(String(year).slice(0, 4));
  if (!Number.isFinite(y0)) return '';
  const d = new Date(date);
  const t = (m, day, yy = y0) => new Date(Date.UTC(yy, m - 1, day)).getTime();
  const now = d.getTime();
  if (now < t(4, 1)) return '';                  // before the bulletin is a real choice
  if (now < t(10, 15)) return 'Autumn';
  if (now < t(1, 20, y0 + 1)) return 'Winter';
  if (now < t(4, 10, y0 + 1)) return 'Spring';
  if (now < t(7, 10, y0 + 1)) return 'Summer';
  return '';
}

/* URL state: ?q=&quarter=&school=&ger=. Unknown quarters and schools are dropped, so a
 * stale link shows everything rather than nothing. */
export function readState(search, schools) {
  const p = new URLSearchParams(search);
  const quarter = p.get('quarter') || '';
  const school = p.get('school') || '';
  return {
    q: (p.get('q') || '').slice(0, 80),
    quarter: QUARTERS.includes(quarter) || quarter === 'none' ? quarter : '',
    school: schools.includes(school) ? school : '',
    ger: p.get('ger') === 'WAY-' ? 'WAY-' : '',
    explicit: p.has('quarter'),
  };
}

export function writeState({ q, quarter, school, ger }) {
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (quarter) p.set('quarter', quarter);
  if (school) p.set('school', school);
  if (ger) p.set('ger', ger);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/* "3-5" -> "3–5 units", "1" -> "1 unit", "" -> "". */
export function unitsLabel(u) {
  if (!u) return '';
  return `${String(u).replace('-', '–')} unit${u === '1' ? '' : 's'}`;
}
