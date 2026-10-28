// node site/theses/thesis-logic.test.mjs — every pure function the theses page depends
// on, plus the shipped data checked against the logic that reads it. Exit 1 on any failure.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as L from './thesis-logic.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${extra}`); }
};
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
const hits = (term, title) => { const re = L.matcher(term); return !!re && re.test(L.fold(title)); };

// --- fold and terms -------------------------------------------------------------------
eq('fold: accents, case, curly quotes', L.fold('Émile’s ÉCOLE'), "emile's ecole");
eq('cleanTerm keeps a phrase', L.cleanTerm('  Deep   Learning '), 'deep learning');
eq('cleanTerm drops operators', L.cleanTerm('neural (net)'), 'neural net');
eq('cleanTerm keeps a trailing star', L.cleanTerm('Neur*'), 'neur*');
eq('cleanTerm: a star mid-word is a space', L.cleanTerm('ne*ur'), 'ne ur');
eq('cleanTerm refuses a 2-letter prefix', L.cleanTerm('ab*'), null);
eq('cleanTerm refuses a phrase prefix', L.cleanTerm('deep lea*'), null);
eq('cleanTerm refuses punctuation only', L.cleanTerm('--**'), null);
eq('parseTerms dedupes, cleans, caps at 4', L.parseTerms('a, B ,a, c, d, e'), ['a', 'b', 'c', 'd']);
eq('parseTerms skips empties', L.parseTerms(',, neural ,'), ['neural']);

// --- matching -------------------------------------------------------------------------
ok('whole word', hits('art', 'The art of war'));
ok('not inside a word', !hits('art', 'A party in the department'));
ok('a word matches its plural', hits('network', 'Neural networks for vision'));
ok('a word matches -es', hits('class', 'Equivalence classes of knots'));
ok('a plural does not reach further', !hits('network', 'Networking in rural India'));
ok('a phrase matches as typed', hits('deep learning', 'Deep learning for proteins'));
ok('a phrase across a hyphen', hits('deep learning', 'Deep-learning methods'));
ok('a phrase does not match its words apart', !hits('deep learning', 'Learning deep structure'));
ok('a prefix matches longer words', hits('neur*', 'Neuroscience of memory'));
ok('a prefix is anchored at a word start', !hits('neur*', 'Aneurysm repair'));
ok('accents fold on both sides', hits('ecole', "L'École normale"));
ok('a digit term', hits('1968', 'Students in 1968'));
ok('regex characters are literal', L.matcher('c++') ? !hits('c++', 'cccc') : true);
eq('a term with nothing searchable has no matcher', L.matcher('***'), null);

// --- bins -----------------------------------------------------------------------------
{
  const bs = L.bins(1893, 2026);
  eq('first bin clipped to the first year', L.binLabel(bs[0]), '1893–94');
  eq('last bin clipped to the last year', L.binLabel(bs.at(-1)), '2025–26');
  eq('28 bins from 1893 to 2026 (1890s clipped)', bs.length, 28);
  let tiles = bs.every((b, i) => i === 0 || b.y0 === bs[i - 1].y1 + 1);
  ok('bins tile the years with no gap or overlap', tiles);
  eq('binOf finds a middle year', L.bins(1893, 2026)[L.binOf(bs, 1952)].y0, 1950);
  eq('binOf outside the span is -1', [L.binOf(bs, 1892), L.binOf(bs, 2027)], [-1, -1]);
  // the edge a `y < last` slip drops: a last year that starts a bin of its own
  eq('a last year on a bin boundary gets its own bin', L.bins(1950, 1955).map(L.binLabel), ['1950–54', '1955']);
  eq('a one-year bin is labelled by its year', L.binLabel({ y0: 2026, y1: 2026 }), '2026');
}

// --- rows, totals, counts, rates ------------------------------------------------------
{
  const tsv = [
    '1950\t0\ta1\tNeural nets', '1951\t1\ta2\tThe art of war', '1952\t0\ta3\tNetworks of neurons',
    '1956\t1\ta4\tDeep learning', '1956\t-1\ta5\tUntitled study', 'bad line', '1957\tx\ta6\tNo dept',
    '', '1958\t0\ta7\tTabs\tin title',
  ].join('\n');
  const { rows, bad } = L.parseRows(tsv);
  eq('parseRows keeps good lines', rows.map((r) => r.id), ['a1', 'a2', 'a3', 'a4', 'a5', 'a7']);
  eq('parseRows counts the bad ones', bad, 2);
  eq('a tab inside a title survives', rows.at(-1).title, 'Tabs\tin title');
  const bs = L.bins(1950, 1958);
  eq('totals per bin, all departments', L.totals(rows, bs), [3, 3]);
  eq('totals for one department', L.totals(rows, bs, 0), [2, 1]);
  eq('counts per bin', L.counts(rows, bs, 'neur*'), [2, 0]);
  eq('counts respect the department', L.counts(rows, bs, 'learning', 0), [0, 0]);
  eq('counts for a phrase', L.counts(rows, bs, 'deep learning'), [0, 1]);
  eq('rates per 1,000 titles', L.rates([1, 0], [4, 2]), [250, 0]);
  eq('a bin with no titles is null, not 0', L.rates([0, 0], [0, 5]), [null, 0]);
  eq('examples newest first', L.examples(rows, bs, 0, 'neur*').map((r) => r.id), ['a3', 'a1']);
  eq('examples cap at n', L.examples(rows, bs, 0, 'neur*', -1, 1).map((r) => r.id), ['a3']);
  eq('examples respect the department', L.examples(rows, bs, 1, 'deep learning', 0), []);
}

// --- URL state ------------------------------------------------------------------------
{
  const depts = ['Department of Physics', 'School of Education'];
  const s = L.encodeState(['neural', 'deep learning'], 'School of Education');
  eq('state round-trips terms and department', L.decodeState(s, depts), { terms: ['neural', 'deep learning'], dept: 1 });
  eq('no state is empty', L.encodeState([], ''), '');
  eq('an unknown department is dropped', L.decodeState('?q=x&d=Nope', depts).dept, -1);
  eq('no q is null terms', L.decodeState('', depts).terms, null);
  eq('a hand-edited q is cleaned', L.decodeState('?q=Neur*,(war)', depts).terms, ['neur*', 'war']);
}

// --- shared helpers really are the Daily page's ---------------------------------------
{
  const D = await import('../ngram-logic.js');
  ok('niceTicks is shared, not copied', L.niceTicks === D.niceTicks);
  ok('fmtRate is shared, not copied', L.fmtRate === D.fmtRate);
}

// --- the shipped data, read the way the page reads it ---------------------------------
const dir = fileURLToPath(new URL('./data/', import.meta.url));
if (existsSync(dir + 'theses.tsv')) {
  const meta = JSON.parse(readFileSync(dir + 'meta.json', 'utf8'));
  const { rows, bad } = L.parseRows(readFileSync(dir + 'theses.tsv', 'utf8'));
  eq('shipped rows all parse', bad, 0);
  eq('row count matches meta', rows.length, meta.count);
  ok('at least 55,000 theses shipped', rows.length >= 55000, `got ${rows.length}`);
  ok('rows sorted by year', rows.every((r, i) => i === 0 || r.year >= rows[i - 1].year));
  eq('first and last year match meta', [rows[0].year, rows.at(-1).year], [meta.first, meta.last]);
  ok('ids are unique', new Set(rows.map((r) => r.id)).size === rows.length);
  ok('every department index is in range', rows.every((r) => r.dept >= -1 && r.dept < meta.depts.length));
  // Departments come from a second fetch pass; when it has run, most rows must carry one.
  if (meta.depts.length) {
    const share = rows.filter((r) => r.dept >= 0).length / rows.length;
    ok('most theses carry a department', share > 0.5, `share ${share.toFixed(3)}`);
    eq('department counts match the rows', meta.deptCounts, meta.depts.map((_, k) => rows.filter((r) => r.dept === k).length));
  }
  const bs = L.bins(meta.chartFirst, meta.last);
  const tot = L.totals(rows, bs);
  eq('bin totals plus the uncharted early years add up to every row', tot.reduce((a, b) => a + b, 0) + meta.before, rows.length);
  eq('meta.before counts the rows before the chart', rows.filter((r) => r.year < meta.chartFirst).length, meta.before);
  // every charted bin but the running last one is dense enough that one title is not a trend
  ok(`every full charted bin holds ${meta.minBin}+ theses`, tot.slice(0, -1).every((n) => n >= meta.minBin), JSON.stringify(tot));
  ok('the bin before the chart is too thin to chart', L.totals(rows, L.bins(meta.chartFirst - 5, meta.chartFirst - 1))[0] < meta.minBin);
  // Anti-vacuity: words whose history is known must move the way history says, so a
  // matcher that matches nothing (or everything) cannot pass.
  const r = (t) => L.rates(L.counts(rows, bs, t), tot);
  const at = (rs, y) => rs[L.binOf(bs, y)];
  const comp = r('computer*');
  ok('"computer*" is rarer in 1950-54 than in 1990-94', (at(comp, 1950) ?? 0) < at(comp, 1990), `${at(comp, 1950)} vs ${at(comp, 1990)}`);
  const ml = r('machine learning');
  ok('"machine learning" is far commoner in 2020-24 than 1990-94', at(ml, 2020) > 5 * (at(ml, 1990) || 0.01), `${at(ml, 1990)} vs ${at(ml, 2020)}`);
  ok('no ordinary word matches every title', at(r('the'), 2000) < 900);
  for (const p of meta.presets) {
    ok(`preset "${p.label}" terms are already clean`, p.terms.every((t) => L.cleanTerm(t) === t), JSON.stringify(p.terms));
    ok(`preset "${p.label}" is found`, p.terms.every((t) => L.counts(rows, bs, t).some((c) => c > 0)));
  }
} else {
  console.log('SKIP shipped-data checks: no data/theses.tsv yet');
  fail++;
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
