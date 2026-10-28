# Stanford Daily Ngrams

**<https://matmat202.github.io/daily-ngrams/>**

Type a word and see how often *The Stanford Daily* printed it, every five years from
1892 to today. To mid-2014 the data is every digitised article in the paper's own
archive, about 695,000 of them; from 2015 it is the paper's web site, stanforddaily.com. Compare up to four words; hover or tap a period to read those articles.

Try `indians, cardinal` (the mascot changed in 1972 and the paper took a decade to follow),
`computer, internet, email`, `war, draft, protest`, or `pandemic, zoom` (2020).

## Thesis titles too

**<https://matmat202.github.io/daily-ngrams/theses/>** does the same for the titles of
Stanford's theses and dissertations, about 62,000 of them from the 1890s on, taken from
the [SearchWorks](https://searchworks.stanford.edu/) catalogue. All the titles ship with
the page, so any word, phrase or prefix (`neur*`) is matched in the browser, for the whole
university or one department, and a pinned period lists the matching theses.

## Two sources, one line

The scans stop in June 2014. From 2015 the page asks stanforddaily.com's WordPress search
instead (`/wp-json/wp/v2/posts?search=…&per_page=1`, which returns the count in the
`X-WP-Total` header), and draws that part of the line dashed.

The two are not the same corpus, so the web rate is **divided by a measured factor**.
`build.py` counts the same single words in both for 2010–13, the years both cover, and
takes the median of web rate / scan rate. That was 1.21 over 16 words in October 2026,
and every word fell between 1.08 and 1.37. So the web posts mention a given word about a
fifth more often than the printed articles did. The build refuses to splice if the
factor leaves 0.5–2.

## How the numbers are made

For each five-year period the page asks the
[Stanford Daily Archives](https://archives.stanforddaily.com/) search how many **articles**
(not ads) contain the word at least once, then divides by the number of articles printed
that period. The y-axis is articles per 10,000, so a period when the paper printed twice
as much does not look twice as interested.

The counts are live: the page queries the archive's public search from your browser,
25 small requests per word, at most five at a time. The examples are also baked into
`data/presets.json`, so the page draws something at once and still works if that search
is down.

## What it cannot tell you

- **The search matches word forms.** `war` also counts `wars` and `warring`. Some words
  stem into a different, commoner one: `coed` is cut to `co` and matches every co- word,
  so it is not offered as an example and its chart would mean nothing.
- **Early issues are OCR scans**, so early counts are lower bounds and a stray hit before
  1990 for `internet` is a misread, not a prophecy.
- **A phrase stops at 2014.** The web search ANDs a phrase's words and ignores quotes
  (`big game` came out 6.5x the scans' phrase rate in 2010–13), so phrases get no web
  points rather than wrong ones.
- **The web search skips very common words** (`the` returns nothing), so those drop to
  zero at 2015 for a reason that is only the search engine.
- **There is a half-year gap**, June to December 2014, between the two sources.

Not affiliated with The Stanford Daily. Built by Claude.
