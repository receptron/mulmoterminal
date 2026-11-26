---
name: mulmoterminal-data-analysis
description: Analyse a CSV, TSV or Excel file, or answer a question about one (is B better than A, what is unusual here, what comes next month, what drives sales, who is likely to cancel), and show the answer in MulmoTerminal's Canvas as a spreadsheet with live formulas (presentSpreadsheet) and charts (presentChart) behind it. Reads the file, checks its columns, computes summary statistics with Node, puts what the user may want to change in formulas and the rest in values, picks charts that fit the data, and says where everything was saved. Use when the user asks to analyse, summarise, explore or chart tabular data or asks such a question of it, to read a spreadsheet again after editing it, or to keep an analysis as a skill of their own to run on the next file of the same kind. The user writes no code. Works in whatever language the user writes in.
---

# Analyse a table of data

The user hands you rows and columns and wants to understand them. They do not write code and do
not reshape the data themselves; you do, with Node in the terminal, and show the result on the
Canvas. Talk to them in their language, and in words about their data, not about this procedure.

## What you need

- `presentSpreadsheet` and `presentChart`. In a project directory they exist only when **Canvas**
  was switched on before the session started. If you do not have them, say so and stop: tell the
  user to switch on Canvas in the launcher's MCP toggles, then choose **Restart the agent** in this
  cell's menu (it keeps the conversation) and ask once more. Reopening the cell is not enough: it
  reattaches to the running agent, which keeps the tools it started with.
- Node. Scripts are Node only — not Python, not a shell pipeline doing arithmetic.
- For a large file, `manageCollection` (the **Workspace data** tools). It is optional: without it a
  large file is aggregated by a script instead (see *A large file* below).

## 1. Read the file

Do not read a large file into the conversation. Look at its size first, then read only the head
(`head -n 20`). Let a script read the whole file.

Write the scripts in a working directory of their own, never in the user's repository:

```sh
work=$(mktemp -d) && cd "$work" && npm init -y >/dev/null && npm install csv-parse simple-statistics
```

Parse with `csv-parse` rather than splitting on commas, because quoted fields hold commas and line
breaks:

```js
import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
const rows = parse(readFileSync(process.argv[2]), { columns: true, skip_empty_lines: true, bom: true });
```

`delimiter: "\t"` reads a TSV. Every value comes back as a string; convert the numeric columns
yourself (strip thousands separators first: `"1,200"` is not a number to `Number`), and count the
ones that do not convert rather than dropping them silently.

Read an Excel file (`.xlsx`) with `exceljs`, installed in the same working directory
(`cd "$work" && npm install exceljs`). Read one worksheet at a time, and
say which worksheets it has and which you read. A cell there may hold a number, a date, a formula's
cached result or text; check each column the same way.

Before analysing anything, tell the user what you found:

- the number of rows;
- each column, and whether it holds numbers, dates or categories;
- how many values are empty or unreadable in each column.

If a column's meaning is unclear (`amt`, `v2`), ask once, rather than guessing.

### A large file

This section is for CSV and TSV. A large Excel file is read with `exceljs`'s streaming reader
(`new ExcelJS.stream.xlsx.WorkbookReader(path)`) and aggregated in the script; a collection reads
CSV only, so do not make one from it.

Look at the file's size first. If it is more than a few hundred kilobytes, count its records with
one streaming pass, not `wc -l` (a quoted field can hold a line break, so lines are not records).
The same pass counts, for each column you will treat as a number, the values that are empty, the
values that do not convert, and the values that convert only after you strip thousands separators;
and, for each column that could be the key (step 4 below), its empty values and whether any value
repeats:

```js
import { createReadStream } from "node:fs";
import { parse } from "csv-parse";
const parser = createReadStream(process.argv[2]).pipe(parse({ columns: true, skip_empty_lines: true, bom: true }));
for await (const row of parser) { /* count the record; check each numeric column */ }
```

Up to about 5,000 records, read the file with a script as above and put every row on the Data
sheet. **Above that, do not parse the whole file into memory and do not put its rows on a sheet.**
Aggregate it instead, and put the aggregated table on the sheet.

**With `manageCollection`**, make the file a read-only collection and aggregate it with DuckDB —
but only when every value in the numeric columns you will aggregate converts as it stands. The
collection drops a value it cannot read as a number from `sum` and `avg` without saying so, and
`"1,200"` is such a value; `min` and `max` compare the values as they are written, so in such a
column they compare text. If the streaming pass found any, aggregate with the script instead (below), and say how many values were empty or unreadable.

1. The file must sit inside the root the collection lives in (the workspace, or the project). If
   it is elsewhere, ask before copying it into `data/` there; never move the user's file. If
   `data/` already holds a file of that name, do not overwrite it: copy under a name that does not
   exist yet, and tell the user which.
2. Pick the collection's slug: lowercase letters, digits and hyphens, named after the data
   (`sales-2025`). Never start it with `mc-` (reserved for the presets, which are overwritten on
   every start) or `mulmoterminal-`. A slug that is taken would be overwritten: check that
   `manageCollection` `getSchema` answers "unknown collection" for it and that no skill directory
   of that name exists, and pick another name if either does.
3. Read how to define one: `manageCollection` with `action: "schemaDocs"` and the topic
   ``External data (CSV) collections — `dataSource` ``. Follow it, including where it says to write
   the files: a `SKILL.md` and a `schema.json` with `dataSource: { "type": "csv", "path": ... }`,
   fields named exactly as the header, the key field declared `type: "string"`.
   Then check that it was picked up: `manageCollection` `getSchema` for the slug. If it still
   answers "unknown collection", the schema failed validation: read the files back against the
   topic and fix them. If it is still unknown, aggregate with the script instead (below) and
   remove the files you wrote.
4. The key: a column whose values are unique, when there is one. When none is (rows of orders,
   readings, log lines), use a column without empty cells. `queryItems` still counts and sums every
   row; only the collection's own list view shows one row per key value. If every column has empty
   cells, use the one with fewest: the list view leaves out the rows whose key is empty, and
   `queryItems` still counts them. Say which of these applies to the user.
5. Aggregate with `manageCollection` `queryItems`, the parameters under `query`:

   ```json
   { "action": "queryItems", "slug": "sales-2025",
     "query": { "groupBy": ["store"],
                "aggregates": { "orders": { "op": "count" }, "sales": { "op": "sum", "column": "amount" } },
                "orderBy": [{ "field": "sales", "dir": "desc" }], "limit": 10000 } }
   ```

   Ops are `count`, `sum`, `avg`, `min`, `max`; `where` filters with `eq`, `ne`, `in`, `gt`, `gte`,
   `lt`, `lte`, `contains`. It scans the whole file. A result holds 1,000 rows unless you pass
   `limit` (at most 10,000), and it does not say when it stopped: if the result has exactly as many
   rows as the limit, treat it as possibly cut off. Then split the query with `where`, or aggregate with the
   script. `groupBy` takes column names, not expressions, so for months run one query per month
   with `where` (`date` `gte` the first day, `lt` the first day of the next month) unless the file
   has a month column. Never compute a total from `getItems`: it stops at 5,000 rows.
6. Check the overall `count` against the record count of the streaming pass before you go on.
7. Put the aggregated rows on the Data sheet as values, labelled as aggregated from the file (for
   example "Sales by month (aggregated from orders.csv)"). Statistics over the aggregated table
   (growth, shares, correlation between the aggregated columns, quartiles of the monthly totals)
   are formulas, as in step 3.
8. Tell the user the collection's name: it also appears in Collections, and editing or replacing
   the file updates it. A query result is a snapshot: to see changed data in the spreadsheet, ask
   for the analysis again.

**With the script**, when `manageCollection` is not there (a project cell where Workspace data was
not switched on) or the numbers need cleaning: aggregate in the streaming pass above, converting
each value as in *Read the file*, and keep only the per-group totals in memory. Put the aggregated
table on the sheet the same way, labelled as aggregated. When `manageCollection` was missing, say
that switching on Workspace data would let the file be aggregated as a collection.

Statistics that need every row rather than a group's sum or count (the median of all orders, a
percentile of individual values) cannot come from `queryItems`. Compute them in a streaming script,
or say they are over the aggregated table.

## 2. Summary statistics

Compute them with `simple-statistics` in the script, so the numbers come from code and not from
reading:

| What | Function |
|---|---|
| mean, median, mode | `mean`, `median`, `mode` |
| spread (sample, n-1) | `sampleStandardDeviation`, `sampleVariance` |
| quartiles, interquartile range | `quantile(values, [0.25, 0.5, 0.75])`, `interquartileRange` |
| min, max, sum | `min`, `max`, `sum` |
| two numeric columns | `sampleCorrelation`, `linearRegression`, `linearRegressionLine`, `rSquared` |
| comparing two groups | `tTestTwoSample` |

`quantile` interpolates the way Excel's `QUARTILE.INC` and `PERCENTILE.INC` do. Say so when you
show quartiles, because other tools (Python's `statistics.quantiles` by default) give slightly
different numbers.

For a category column, count the rows in each category. For a date column, give its range and look
for gaps.

Point out what looks wrong before what looks interesting: duplicate rows, values far outside the
quartiles, a total that does not add up.

## 3. The spreadsheet

Put the result in `presentSpreadsheet`. Split each number by whether the user may want to change it:

- **Formulas** for everything the sheet can compute: totals, ratios, growth, the assumptions a
  what-if depends on, and the statistics. A formula recalculates when the user edits a cell. The
  sheet has, besides the arithmetic and lookup functions:
  - spread and position: `AVERAGE`, `MEDIAN`, `MODE`, `STDEV` / `STDEVP`, `VAR` / `VARP`,
    `PERCENTILE`, `QUARTILE`, `PERCENTRANK.INC`, `LARGE`, `SMALL`, `RANK`, `SKEW`, `KURT`,
    `STANDARDIZE`, `GEOMEAN`, `HARMEAN`;
  - two columns: `CORREL` / `PEARSON`, `SLOPE`, `INTERCEPT`, `RSQ`, `STEYX`, `COVARIANCE.S` /
    `COVARIANCE.P`, `FORECAST.LINEAR`, `TREND`;
  - tests and distributions: `T.TEST`, `T.DIST`, `T.DIST.2T`, `T.DIST.RT`, `T.INV`, `T.INV.2T`,
    `NORM.DIST`, `NORM.S.DIST`, `NORM.INV`, `NORM.S.INV`, `CONFIDENCE.T`, `CONFIDENCE.NORM`;
  - by group: `COUNTIF(S)`, `SUMIF(S)`, `AVERAGEIF(S)`, `MAXIFS`, `MINIFS`.

  `PERCENTILE` and `QUARTILE` interpolate like the script's `quantile`; the current Excel names
  (`PERCENTILE.INC`, `STDEV.S`, …) work too. Check a formula against the script's number before
  you present it.
- **A workbook function** for a method no built-in function has but the cells can compute: a
  moving average, a weighted score, a custom index. Define it once in the sheet's `functions`
  and call it from formulas like any function, so it too recalculates:

  ```json
  { "name": "Data", "data": [...],
    "functions": [{ "name": "MOVING.AVG", "params": ["values", "n"],
                    "body": "const xs = values.flat().filter((v) => typeof v === 'number'); const tail = xs.slice(-n); return tail.reduce((a, b) => a + b, 0) / tail.length;" }] }
  ```

  `=MOVING.AVG(B2:B100, 7)` then works on any sheet of that workbook. The body is JavaScript,
  run sealed off (no files, network or timers) for at most 50 ms a call. A range arrives as rows
  of cells, a blank cell as `null`; a single cell and any other argument as its value. Return a number, text or
  true/false. A name is letters and digits joined by dots, and not a built-in's. If
  `presentSpreadsheet`'s reply names a function it could not use, fix it and present again.
  Check the function's result against the script's number, as with a formula.
- **Values** only for what neither can do: a result that needs data outside the workbook, a
  computation too heavy for 50 ms a call, or what a chart transform works out that the user wants as
  data (each row's cluster, a curve's coefficients; see *4. Charts*). A function the sheet lacks
  shows `#NAME?`. Compute these in the script and put the result in as a value (a number, or text
  such as a group's name). Label them as computed (for example "model fit (computed)"), because a
  value does not change when the user edits the data.

Use one sheet for the data and another for the summary, so a summary formula reads the data sheet
(`=AVERAGE(Data!C2:C201)`).

`presentSpreadsheet` replies with how many formula cells calculate to an error, naming up to five.
Fix them — the formula, the layout, or a value the script computes instead — and present again,
until it reports none, or only errors you mean the user to see (a lookup that finds nothing), before
you tell the user the spreadsheet is ready. The saved file holds formulas, not results, so that reply
is the only place you see them. A file above about 5,000 rows is aggregated first and its aggregated
table goes on the Data sheet (see *A large file*). Say that you did.

## 4. Charts

Use `presentChart`, and choose the chart from the shape of the data:

| Data | Chart |
|---|---|
| a value over time | line; bars if there are only a few periods; a time axis when the dates are uneven; sampling and zoom for thousands of points |
| comparing categories | bar, sorted, unless the categories have an order of their own |
| parts of a whole (few parts) | stacked bar; pie only for a handful of parts |
| two numeric columns | scatter; for the regression line, a `TREND` or `FORECAST.LINEAR` column on the sheet drawn as a line; for a curve (exponential, logarithmic, polynomial), `ecStat:regression` |
| the distribution of one column | histogram; a boxplot per group to compare groups (`mulmo:boxplotColumns` when each group is a column) |
| two measures of different size (sales and growth) | two value axes |
| which few causes make up most of a total | Pareto |
| how a total got from start to end | waterfall |
| how several numeric columns move together | correlation matrix (a heatmap of `CORREL` for each pair) |
| which rows are alike (customers by income and visits) | clusters (`mulmo:clustering`) on a scatter |
| a value per prefecture or country | map |
| values spanning several orders of magnitude | log scale |
| two categories crossed | heatmap |

Give each chart a title saying what it shows. Give each axis a name, with its unit. Mark what the
user should look at: an average line, the highest point, a shaded span.

**`presentChart`'s `option` description has a recipe for each of these.** Start from the recipe and
lay the sheet out the way it says: a recipe drawn from a range names the header that range needs,
and its series pick their columns by those names (`encode`). The option is JSON, so it holds no
functions; format labels with template strings (`{value} %`) or a format object
(`{ "kind": "currency", "currency": "JPY" }`, `percent`, `number`, `date`). Compute on the sheet
whatever the chart needs, so the chart follows edits:

- **histogram**: when the user does not need particular bins, `ecStat:histogram` counts the data
  column itself, and `config.method` picks the bins. When the user wants bins of their own, or the
  counts on the sheet, put the bins' edges in columns of their own beside the chart's range, and
  each count a `COUNTIFS` on the data (`=COUNTIFS(Data!B2:B201,">="&C2,Data!B2:B201,"<"&D2)`; the
  last bin `"<="`).
- **boxplot**: when each group is a column of its own (Store A, Store B), `mulmo:boxplotColumns`
  boxes those columns straight from the data range. When the groups are values in one column, put
  the five numbers per group on the sheet with `MIN`, `QUARTILE(…,1)`, `MEDIAN`, `QUARTILE(…,3)` and
  `MAX`. The sheet cannot filter a range by group, so sort the data sheet by group and point each
  row at its group's block.
- **Pareto**: the recipe says to sort on the sheet, but the sheet has no sort function, so the
  script orders the causes, largest first, and the sheet counts them. The cumulative share is a
  number from 0 to 100 (`=SUM($B$2:B2)/SUM($B$2:$B$9)*100`), not a fraction formatted as a
  percentage, since the axis runs to 100.
- **waterfall**: the change and the running total in columns beside the range; the drawn columns
  are `Base = MIN(total before, total after)`, `Up = MAX(change, 0)` and `Down = MAX(-change, 0)`,
  all non-negative.
- **correlation matrix**: a cross table with the column names along the top row and down the first
  column, a `CORREL` in each cell, drawn with `"layout": "matrix"` in the chart's `source`, which
  turns it into the `X | Y | Value` rows the heatmap recipe reads. Leave out a column that does not
  vary: its `CORREL` (and `STANDARDIZE` below) is `#DIV/0!`.
- **clusters**: `mulmo:clustering` groups rows by the columns in `config.dimensions`, and gives the
  same groups on every redraw. It measures distance in the columns' own units, so a column of
  incomes outweighs a column of visit counts: when the scales differ, add a standardised column for
  each (`=STANDARDIZE(B2,AVERAGE(B$2:B$201),STDEV(B$2:B$201))`) and cluster on those, while the
  scatter still shows the original columns. Group the rows **once**: a script's own k-means does not
  give the transform's groups or numbers, so never put both in one analysis. To show the groups,
  use the transform and put no group column on the sheet. When the user wants each row's group as
  data (to count or filter), compute it in the script into a computed column, and colour the
  scatter by that column with no transform, so the sheet and the chart show the same groups:
  `"visualMap": { "type": "piecewise", "dimension": "Group", "categories": [every group's name],
  "inRange": { "color": [one per group] } }`.
- **map**: one row per region, its name exactly as the map has it: `japan-ja` and `world-ja` take
  Japanese names (東京都), `japan` and `world` English ones. No other map is available.

**A fitted curve, a histogram, clusters (when the sheet holds no group column, see *clusters*) or a
box per column straight from the data** uses the recipe's transform (`ecStat:regression`, `ecStat:histogram`, `mulmo:clustering`,
`mulmo:boxplotColumns`): the chart's `source` is the data sheet's range, header row included
(`Data!B1:C201`), and the transform's `dimensions` name the columns by that header exactly. The
transform recomputes whenever the sheet is saved, so the chart follows edits. A blank cell, or text
that is not a number, is left out: the whole row from a fit, a histogram or clusters, only that
value from a box per column. What it computes is not on the sheet: if the user wants a curve's
coefficients, compute them in the script as computed values; for each row's cluster, see
*clusters* above.

**Long data needs no summary sheet to draw one line per group.** A data sheet of `Date | Region |
Sales` rows can be the source as it is, with `"groupBy": { "column": "Region" }`: it is drawn with
one column per region, and rows meeting in one cell are added up. Several ranges go in `sources`
instead of `source`, the i-th as `dataset[i]`.

Any order the script sets, such as the sorted bars, the Pareto causes and the groups' blocks behind
a grouped boxplot, is a computed value: the numbers follow edits, and the order and which rows
belong to a group do not. Say so, and see *When the user edits the spreadsheet*.

**Draw a chart of sheet data from the sheet**, so it follows the user's edits. Give the chart a
`source` and leave the data out of `option`:

```json
{ "title": "Sales by month", "source": { "spreadsheet": "<the path presentSpreadsheet reported>", "range": "Summary!A1:C13" },
  "option": { "xAxis": { "type": "category", "name": "Month" }, "yAxis": { "name": "Sales (JPY)" },
              "series": [{ "type": "bar" }, { "type": "bar" }] } }
```

The range's first row is the header (it names the series) and its first column the categories,
so lay the summary sheet out that way: one row per category, one column per series. The chart is
drawn from the calculated range, and drawn again whenever the sheet is saved. If `presentChart`
says it cannot read the range, fix the range rather than falling back. If it says a chart could not
be drawn, nothing was saved: fix that chart's option as the reply says and call it again.

Several charts of one analysis go in one `presentChart` call: `document.columns` (1–4) sets them
side by side, and `height` on a chart (160–1200 pixels) makes it taller or shorter.

Pass data inline in `option` only for what neither the sheet nor a transform can draw, such as a fit
of a form `ecStat:regression` does not have. Such a chart does **not** follow the sheet; say which
charts do and which do not.

## 5. Say where everything is

`presentSpreadsheet` and `presentChart` each reply with the absolute path of the file they saved,
under `<workspace>/artifacts/`. Copy your scripts next to them, so the analysis can be run again:

```sh
dest="<workspace>/artifacts/analysis/YYYY/MM/<spreadsheet id>"
mkdir -p "$dest" && cp "$work"/*.mjs "$work"/package.json "$dest"/
```

End by telling the user:

- the spreadsheet's path and the chart's path;
- where the scripts are;
- which values are formulas (workbook functions included, by name) and which are computed;
- which charts follow the sheet and which do not.

## 6. Offer to keep the analysis as a skill

When the user is happy with the result, ask once whether to keep this analysis as a skill of their
own, so the next file of the same kind (next month's export, another store) gets the same
spreadsheet and charts from one request. If they say yes:

**Ask where it should live**, and say what each means:

- for every terminal: the agent's user skills directory — for Claude Code `~/.claude/skills/`, or
  `$CLAUDE_CONFIG_DIR/skills/` when that is set;
- for this project only: `.claude/skills/` in the working directory.

**Name it** after the data and the question, in lowercase words joined by hyphens
(`cafe-sales-weekday-temperature`). Never start the name with `mulmoterminal-`: that prefix is
for the skills MulmoTerminal ships, and it does not install one of its own over a directory it did
not write, so a skill of yours under such a name would keep a shipped skill out. If the directory
already exists, ask before replacing it.

**Make the scripts reusable before copying them** into `<skill>/scripts/` with `package.json`.
Every value that came from the file you analysed is recomputed from the input at run time, or it
will silently describe the old file when the skill runs on the next one:

- the input file's path is an argument, never written into a script; for an Excel file the
  worksheet's name is one too, and `exceljs` stays in `package.json`;
- every range, row count and sheet size comes from the data (`Data!A1:G${rows.length + 1}`);
- categories, dates, the edges of bins the user chose, lookup tables and anything else derived
  from the rows are computed by the script, not pasted in;
- a fitted curve, an automatic histogram, clusters and a box per column stay transforms over the
  data range, as in *4. Charts*, never their output as it came out on this file; a group column the
  user asked for is computed by the script on each run, and the chart is coloured by it;
- the spreadsheet path the charts point at is an argument (it changes on every run);
- titles name the data kind, not this file's dates;
- workbook functions travel in the `functions` the scripts present, unchanged: they are the method,
  not the data.

Then read the scripts and the SKILL.md you are about to write as if for a stranger: no row of the
data, no value copied out of it, no absolute path and nothing secret goes into the skill. A skill
outlives the conversation and can be shared; the data stays where the user keeps it.

**Write `<skill>/SKILL.md`**, in the user's language:

- `name` and a `description` that says what data it is for, naming the columns it needs, so the
  agent picks it for a file of that shape and not for any CSV;
- the columns it expects, exactly as the header spells them. If a file lacks one, the skill stops
  and says which, rather than guessing;
- the steps to run it: copy `scripts/` into a fresh `mktemp -d`, `npm install`, run the scripts on
  the file the user names, present the spreadsheet, then the charts from the reported spreadsheet
  path;
- what to tell the user afterwards: the same findings as this analysis, which values are formulas
  and which computed, which charts follow the sheet, and where everything was saved;
- the date it was made, and the file it was made from by its name only (not its full path).

Do not put a file named `schema.json` in the skill directory: MulmoTerminal reads a skill directory
holding one as a collection.

When the analysis aggregated a large file through a collection, the skill does not carry that
collection: it names the next file, not this one. Write the steps of *A large file* into its
SKILL.md in full, since the kept skill cannot see this one: the streaming pass and when to fall back
to the script, the slug check, defining a collection for the file it is given, and the
`queryItems` queries with their `limit`, so the aggregation is the same on every run.

**Run it once before you hand it over**: follow the new SKILL.md yourself, from a fresh temporary
directory, on the file you just analysed, and check the spreadsheet comes out the same. Fix the
skill until it does. Then tell the user its name, where it is, and how to use it ("analyse
next-month.csv with cafe-sales-weekday-temperature", or `/cafe-sales-weekday-temperature
next-month.csv`). A new skill is picked up by sessions started after it was written.

## When the user edits the spreadsheet

Formulas recalculate in the sheet, and charts drawn from it (`source`) redraw on their own. You
are not told that the user edited it; they will tell you. Read the spreadsheet file again. It
holds what was typed, **formulas included and their results not**, so you see `=B7+C7`, not a
number. Work out the results in a script, and say what changed most.

If the sheet holds no computed values, and every chart follows it, that is all: do not present it
again. Otherwise the computed values and the inline charts are now stale. Then:

- recompute the computed values that depended on the edited cells, including any order the script
  set (sorted bars, a Pareto chart's causes, a grouped boxplot's blocks, a group column computed
  in the script) that the new data no longer follows;
- call `presentSpreadsheet` again with the whole spreadsheet: the user's edits, the formulas, each
  sheet's `functions` as the file holds them, and the new computed values;
- draw the charts again, with their `source` pointing at the **new** spreadsheet;
- copy the scripts as in step 5, into the folder named after the **new** spreadsheet id;
- say what changed most, and give the new spreadsheet's, chart's and scripts' paths.

**Never write the spreadsheet file yourself.** The open Canvas does not read it again, so it keeps
showing the old values, and the user's next edit there saves the whole old sheet back over yours.

The new `presentSpreadsheet` is a new file. The old spreadsheet, its chart and its scripts stay as
they were, and nothing links them to the new ones. So tell the user to edit the new spreadsheet
from now on, and that edits to the old one are not part of this analysis. The next time they ask
you to read it again, read the newest spreadsheet you presented; if they name the old one, ask
which they mean.

## Do not

- Do not compute statistics in your head and present them as exact.
- Do not round in the script; let the cell format round for display (`0.00`, `#,##0`, `0.0%`).
- Do not install anything outside the working directory, and do not add a dependency to the user's
  project.
- Do not drop rows quietly. Every row you leave out is counted and reported.
