# Launch Radar — token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/fariztelkom/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/fariztelkom/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar built from the sealed DefiLlama snapshot. Entered on [make.fun](https://make.fun/bounty/token-radar-01). It ranks protocols that record no
token by an implied value fitted from the snapshot's own live-token comparables, and gives every
ranked protocol a concrete seven-step farm plan.

## Run

Node 22.18 or later is required; there is no build step and no network access.

    mkdir -p out
    node main.ts --input /home/ejoy/makefun/radar-kit/token-radar-01-kit/input/snapshot.json --output out

The program writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and
`out/dossier.json`. `out/` is ignored by git and is never part of the entry.

## The model

`lib/model.ts` fits a global median market-cap/TVL ratio from protocols with a token and more than
$1M of TVL, then computes category medians (at least four comparables) and chain medians (at least
six), each shrunk toward the global fit. For each pre-token protocol the comparable is shrunk toward
the global median, then multiplied by clamped seven-day growth, tenure since DefiLlama first listed
it, and a size tilt. The board covers every watchlist slug, then the largest pre-token protocols
below the $50M floor, ranked by that implied value.

No protocol name is special-cased, and no value comes from the clock or from outside the snapshot:
two runs produce the same bytes.

## The page

`dashboard/index.html`, `dashboard/app.css` and `dashboard/app.js` render a dark editorial board
with sortable columns, search, a category filter, a live-token tab, a detail drawer with the model
breakdown and the farm plan, and a four-cell KPI strip. The three images in `screenshots/` show the
board, a protocol's detail and a filtered view. `vendor/makefun-board.ts` is the unmodified dossier
library supplied by the kit; `LICENSE` is copied from the kit starter.
