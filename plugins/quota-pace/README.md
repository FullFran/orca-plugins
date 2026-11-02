# Quota Pace

A right-sidebar panel that answers one question per weekly AI-agent quota: how much can I spend
today? It takes what was left of the week at the start of today, spreads it evenly over the days
left until the weekly reset, and shows how much of today's share is still unspent. Read-only: it
never changes an account or a setting.

## What it shows

One card per weekly window Orca reports (`windowMinutes` 10080), such as "Claude",
"Claude · Fable", "Codex" or "Antigravity":

- `X% left today of Y%`, or `X% over today's Y%` in the warning tone when today's share is spent;
- a bar of today's use against today's share;
- the week's remaining percentage, the reset time and the days left;
- a note when today's baseline is a reading taken after midnight (see below).

Providers without a weekly window are listed briefly: errors with Orca's message, and the ones
that are not connected in a single line.

## The formula

For each window, with `startOfToday` the local midnight:

```
usedAtStart     = usedPercent first observed today
daysLeft        = (resetsAt - startOfToday) / 1 day        (fractional)
allowanceToday  = (100 - usedAtStart) / daysLeft           (at most 100 - usedAtStart)
usedToday       = max(0, usedNow - usedAtStart)
remainingToday  = allowanceToday - usedToday               (negative = over budget)
```

Example: 60% used at midnight and the reset 2.5 days after midnight gives an allowance of
40 / 2.5 = 16% for today; at 70% used, 6% of today's share is left.

Because the share is recomputed every day from what is actually left, a light day leaves more for
each of the remaining days, and a heavy day leaves less.

Baselines: the worker stores, per window and local date, the first `usedPercent` it sees that day.
If Orca was closed at midnight, the first reading of the day is later than midnight and becomes the
baseline anyway, so use between midnight and that reading counts as "before today". The panel says
so when it happens. A new baseline starts on a new local day, once `resetsAt` has passed, or when
the window's reset time moves (a new weekly window).

## Refreshing

The worker reads the quotas every 5 minutes while it runs, the panel asks for the latest reading
when it opens (reading again if it is older than 5 minutes), and the refresh button reads now.

## Access it asks for

- `trusted-worker` execution: a panel cannot start processes, so the worker (`src/worker.ts`)
  runs `orca-ide account list --json` (the CLI bundled with the running Orca first, then `orca-ide`
  or `orca` on PATH) and reads only `result.rateLimits` from its answer.
- `storage:own`: keeps the daily baselines in the plugin's own storage, so a worker restart or an
  Orca restart during the day keeps today's starting point.

## Develop

```sh
orca plugin validate .
orca plugin test .      # src/pace.test.ts, src/worker.test.ts, src/panel.test.tsx
orca plugin check .     # renders src/panel.check.ts scenarios
orca plugin dev watch . # loads this folder into Orca (needs --approve)
```

`src/pace.ts` holds the formula and parsing with no Orca or Node imports; the worker injects the
CLI runner, clock and timer, so the tests never run the real CLI. `src/fixtures.ts` is a trimmed
real answer of `orca account list --json` used only by tests.
