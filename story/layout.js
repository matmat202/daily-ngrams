/* Where every mark sits on each step of the story. Pure: no DOM, so test/story.test.mjs
 * runs every layout at several plot sizes. Modelled on crypto-lifetimes/site/story.
 *
 * One chart, x = print year, y = a ratio of article counts in the same year (1 = parity):
 *   "groups":  women / men (grey), and the parity rule
 *   "she":     the same, and she / he (red)
 *   "war":     the same, with 1942-1946 shaded
 *   "turn":    she / he (red) and her / his (dark), with everything after 1970 shaded
 */
export const STEPS = { groups: 'groups', she: 'she', war: 'war', turn: 'turn' };
export const WAR = [1942, 1946], TURN = 1970;

const median = (xs) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
export const ratio = (D, a, b) => D[a].map((x, i) => x / D[b][i]);
const memo = new WeakMap();

/* -> the numbers the story quotes; build_story.py's `check` holds the same */
export function stats(D) {
  if (memo.has(D)) return memo.get(D);
  const Y = D.years, last = Y.at(-1);
  const sh = ratio(D, 'she', 'he'), hh = ratio(D, 'her', 'his'), wm = ratio(D, 'women', 'men'), wo = ratio(D, 'woman', 'man');
  const inWar = (y) => y >= WAR[0] && y <= WAR[1];
  const at = (xs, y0, y1, war = true) => xs.filter((_, i) => Y[i] >= y0 && Y[i] <= y1 && (war || !inWar(Y[i])));
  const best = (pairs) => pairs.reduce((b, p) => (p[0] > b[0] ? p : b));
  const pairs = (xs, keep) => xs.map((x, i) => [x, Y[i]]).filter(([, y]) => keep(y));
  const peace = best(pairs(sh, (y) => y < TURN && !inWar(y))), war = best(pairs(sh, inWar));
  const S = {
    sh_before: median(at(sh, Y[0], TURN - 1)), wm_before: median(at(wm, 1920, TURN - 1)),
    sh_band_lo: Math.min(...at(sh, 1920, TURN - 1, false)), sh_band_hi: Math.max(...at(sh, 1920, TURN - 1, false)),
    tot_lo: Math.min(...at(D.total, 1920, TURN - 1)), tot_hi: Math.max(...at(D.total, 1920, TURN - 1)),
    peace_max: peace[0], peace_max_year: peace[1], war_peak: war[0], war_peak_year: war[1],
    wm_parity_before: Y.filter((y, i) => y < TURN && wm[i] >= 1),
    after_min: Math.min(...at(sh, TURN + 1, last)),
    past_war: Y.find((y, i) => y > WAR[1] && sh[i] > war[0]),
    wm_after_lo: Math.min(...at(wm, TURN + 2, last)), wm_after_hi: Math.max(...at(wm, TURN + 2, last)),
    wm_first_par: Y.find((y, i) => y >= TURN && wm[i] >= 1),
    sh_end: mean(at(sh, last - 4, last)),
    hh_before: median(at(hh, Y[0], TURN - 1)), hh_end: mean(at(hh, last - 4, last)),
    wo_max: Math.max(...wo), wo_max_year: Y[wo.indexOf(Math.max(...wo))],
    first: Y[0], last, n_articles: D.total.reduce((a, b) => a + b, 0),
    sh, hh, wm,
  };
  S.fold = S.sh_end / S.sh_before;
  memo.set(D, S);
  return S;
}

/* -> {X, Y, L, R, T, B, marks, labs: [[x, y, text, cls]], xt, yt} in px of w x h.
 * marks: {kind: 'line', cls, pts: [[x, y]...], tip} | {kind: 'band'|'rule', cls, x, y, w, h, tip} */
export function layout(name, D, w, h) {
  if (!STEPS[name]) throw new Error(`unknown step ${name}`);
  const S = stats(D);
  const narrow = w < 420;
  const L = narrow ? 30 : 40, R = w - (narrow ? 44 : 70), T = 26, B = h - 22;
  const x0 = S.first, x1 = S.last, y1 = 1.3;
  const X = (v) => L + ((v - x0) / (x1 - x0)) * (R - L);
  const Yv = (v) => B - (Math.min(v, y1) / y1) * (B - T);
  const marks = [], labs = [];
  const band = (a, b, tip) => marks.push({ kind: 'band', cls: 'band', x: X(a - 0.5 < x0 ? x0 : a - 0.5), y: T, w: X(Math.min(b + 0.5, x1)) - X(a - 0.5 < x0 ? x0 : a - 0.5), h: B - T, tip });
  if (name === 'war') band(WAR[0], WAR[1], `${WAR[0]}–${WAR[1]}: the war years`);
  if (name === 'turn') band(TURN + 1, x1, `after ${TURN}`);
  marks.push({ kind: 'rule', cls: 'par', x: L, y: Yv(1) - 0.75, w: R - L, h: 1.5, tip: 'parity: as many articles say one word as the other' });
  const line = (xs, cls, text, tip) => {
    marks.push({ kind: 'line', cls, pts: xs.map((v, i) => [X(D.years[i]), Yv(v)]), tip });
    const tail = xs.slice(-5).reduce((a, b) => a + b, 0) / 5;
    labs.push([R + 4, Yv(tail) + 4, text, `lab ${cls}`]);
  };
  if (name !== 'turn') line(S.wm, 'wm', 'women', 'women / men');
  if (name !== 'groups') line(S.sh, 'sh', 'she', 'she / he');
  if (name === 'turn') line(S.hh, 'hh', 'her', 'her / his');
  const xt = (narrow ? [1900, 1950, 2000] : [1900, 1925, 1950, 1975, 2000]).map((v) => [v, String(v)]);
  const yt = [[0, '0'], [0.5, '0.5'], [1, '1:1']];
  // end labels whose lines finish close together (she and her) are pushed apart, lower one down
  labs.sort((a, b) => a[1] - b[1]);
  for (let i = 1; i < labs.length; i++) if (labs[i][1] - labs[i - 1][1] < 13) labs[i][1] = labs[i - 1][1] + 13;
  return { kind: name, X, Y: Yv, L, R, T, B, xt, yt, marks, labs };
}
