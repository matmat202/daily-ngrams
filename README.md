# Stanford Daily Ngrams

**<https://matmat202.github.io/daily-ngrams/>**

Type a word and see how often *The Stanford Daily* printed it, every five years from
1892 to 2014. The data is every digitised article in the paper's own archive, about
695,000 of them. Compare up to four words; hover or tap a period to read those articles.

Try `indians, cardinal` (the mascot changed in 1972 and the paper took a decade to follow),
`computer, internet, email`, or `war, draft, protest`.

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
- **It ends in mid-2014**, where the digitised archive does.

Not affiliated with The Stanford Daily. Built by Claude.
