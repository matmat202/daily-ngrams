#!/usr/bin/env python3
"""data/story-counts.json -> site/story/story.json: when did the Daily start writing "she"?

    python3 build_story.py          # BUILD_OUT=... writes elsewhere (publish.sh compares)

data/story-counts.json is frozen by fetch_story.py: for every print year 1892-2014, how many
of the archive's articles contain each word at least once (the page's own count, the page's
own query). The story compares pairs, each a ratio of article counts in the same year:

  women / men   the paper writing about women as a group
  she / he      the paper writing about one woman, the subject of a sentence
  her / his     the same, a second way
  woman / man   the singulars, which never reach parity (said in the epilogue)

"Before" is 1892-1969 and "peacetime" leaves out 1942-1946, when the men had gone to war.

test/story.test.mjs recomputes every number below in JS from the same arrays (site/story/
layout.js stats()) and requires this python `check` block to agree.
"""
import json
import os
from statistics import median

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "data", "story-counts.json")
OUT = os.environ.get("BUILD_OUT", os.path.join(HERE, "site", "story", "story.json"))
WORDS = ["women", "men", "woman", "man", "she", "he", "her", "his"]
WAR = (1942, 1946)
TURN = 1970  # the first year of "after"


def main():
    C = json.load(open(SRC))
    Y = C["years"]
    D = {"source": "the Stanford Daily archive's search: articles containing each word, per print year",
         "fetched": C["fetched"], "years": Y, "total": C["total"], **{w: C[w] for w in WORDS}}
    ratio = lambda a, b: [x / y for x, y in zip(C[a], C[b])]
    sh, hh, wm, wo = ratio("she", "he"), ratio("her", "his"), ratio("women", "men"), ratio("woman", "man")
    at = lambda xs, y0, y1, war=True: [x for y, x in zip(Y, xs) if y0 <= y <= y1 and (war or not WAR[0] <= y <= WAR[1])]
    pre_peace = [(x, y) for y, x in zip(Y, sh) if y < TURN and not WAR[0] <= y <= WAR[1]]
    war = max(((x, y) for y, x in zip(Y, sh) if WAR[0] <= y <= WAR[1]))
    peace_max = max(pre_peace)
    after = [(x, y) for y, x in zip(Y, sh) if y > TURN]
    last5 = at(sh, Y[-1] - 4, Y[-1])
    D["check"] = {
        "sh_before": median(at(sh, Y[0], TURN - 1)),
        "wm_before": median(at(wm, 1920, TURN - 1)),
        "sh_band_lo": min(at(sh, 1920, TURN - 1, war=False)), "sh_band_hi": max(at(sh, 1920, TURN - 1, war=False)),
        "tot_lo": min(at(C["total"], 1920, TURN - 1)), "tot_hi": max(at(C["total"], 1920, TURN - 1)),
        "peace_max": peace_max[0], "peace_max_year": peace_max[1],
        "war_peak": war[0], "war_peak_year": war[1],
        "wm_parity_before": [y for y, x in zip(Y, wm) if y < TURN and x >= 1],
        "after_min": min(after)[0],
        "past_war": next(y for y, x in zip(Y, sh) if y > WAR[1] and x > war[0]),
        "wm_after_lo": min(at(wm, TURN + 2, Y[-1])), "wm_after_hi": max(at(wm, TURN + 2, Y[-1])),
        "wm_first_par": next(y for y, x in zip(Y, wm) if y >= TURN and x >= 1),
        "sh_end": sum(last5) / len(last5),
        "hh_before": median(at(hh, Y[0], TURN - 1)), "hh_end": sum(at(hh, Y[-1] - 4, Y[-1])) / 5,
        "wo_max": max(wo), "wo_max_year": Y[wo.index(max(wo))],
        "first": Y[0], "last": Y[-1], "n_articles": sum(C["total"]),
    }
    D["check"]["fold"] = D["check"]["sh_end"] / D["check"]["sh_before"]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(D, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    print("  ".join(f"{k} {round(v, 3) if isinstance(v, float) else v}" for k, v in D["check"].items()))


if __name__ == "__main__":
    main()
