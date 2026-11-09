# Quota Pace

A right-sidebar panel that answers key capacity questions for each weekly AI-agent quota:
how much can I spend today sustainably, what is my current burn rate, and am I on track to
exhaust my quota before the reset?

Read-only: it never changes an account, credentials, or settings.

## What it shows

One card per weekly window Orca reports (`windowMinutes` 10080), such as "Claude",
"Claude · Fable", "Codex" or "Antigravity":

- **Live allowance today & Sustainable pace**: how much quota can be spent from the current
  moment until midnight without compromising uniform allocation over the remainder of the week
  (e.g. `Live allowance: 4.8 pp · Sustainable: 0.50 pp/h`).
- **Live allowance (adaptive)**: activity-weighted allowance when a historical activity profile is available,
  weighting remaining quota according to typical hourly habits rather than flat hours
  (e.g. `Live allowance (adaptive): 5.2 pp (estimated, 30d profile)`).
- **Current pace & Multiplier**: burn rate over recent usage (in pp/h) and pace multiplier relative
  to sustainable pace (e.g. `Current pace: 0.82 pp/h (1.64x pace)`). Identifies brief spikes,
  unsustainable trends, low consumption, and explicit insufficient data / stale states.
- **Projected exhaustion**: warns proactively when current burn rate would exhaust the quota before
  the weekly reset.
- **Daily budget & Progress**: traditional retrospective day share (`X% left today of Y%` or `X% over today's Y%`),
  usage bar, daily deviation, and remaining days until reset.
- **Data transparency notes**: explicitly shows whether each baseline and forecast is **measured**
  (official provider reading, claudeops history) or **estimated** (Orca token statistics, recent usage slope).

Providers without a weekly window are listed briefly: errors with Orca's message, and disconnected providers
in a single muted line.

## Formulas

### 1. Sustainable Live Allowance from Now (v0.3)

Calculated continuously from current timestamp $t$, next local midnight $m$, reset timestamp $T$,
weekly remaining quota $R = \max(0, 100 - \text{usedNow})$, and safety reserve fraction $s$:

```text
B_hoy = R * (1 - s) * max(0, min(m, T) - t) / (T - t)    (for T > t)
sustainablePerHour = (R * (1 - s)) / hoursUntilReset
hoursUntilReset = max(0, (T - t) / 3,600,000)
```

**Worked example:**
With 34 percentage points remaining ($R = 34$), 68.65 hours until reset, 9.65 hours until midnight,
and no reserve ($s = 0$):
- Sustainable pace: $34 / 68.65 \approx 0.50 \text{ pp/h}$
- Live allowance today: $34 \times (9.65 / 68.65) \approx 4.8 \text{ pp}$

### 2. Adaptive Activity-Weighted Allowance (v0.4)

When an activity profile file is available, quota is distributed according to expected hourly activity $w(t)$:

```text
B_adaptive(a, b) = R * (1 - s) * ∫_a^b w(t) dt / ∫_a^T w(t) dt
```

where $a = t$ (now) and $b = \min(m, T)$. The integral is evaluated piecewise constant per local hour
across real timestamps, handling partial hours at $t$, midnight $m$, and reset $T$, as well as DST
transitions (23h and 25h days).

When $w(t) \equiv 1$ (all-ones weights), $B_{\text{adaptive}}$ is mathematically equivalent to the uniform
live allowance $B_{\text{hoy}}$.

### 3. Traditional Daily Budget (Anchor at Local Midnight)

For each window, with `startOfToday` local midnight:

```text
usedAtStart     = usedPercent first observed today
daysLeft        = (resetsAt - startOfToday) / 1 day        (fractional)
allowanceToday  = (100 - usedAtStart) / daysLeft           (capped at 100 - usedAtStart)
usedToday       = max(0, usedNow - usedAtStart)
remainingToday  = allowanceToday - usedToday               (negative = over budget)
dailyDeviation  = usedToday - allowanceToday
```

### 4. Burn Rate & Exhaustion Engine

- **Short window (30m)**: detects transient consumption spikes.
- **Sustained window (4h)**: calculates baseline trend slope $\Delta \text{used} / \Delta t$ in pp/h.
- **Pace multiplier**: $\text{currentBurnRate} / \text{sustainableBurnRate}$.
- **States**:
  - `insufficient_data`: fewer than 2 readings or span $< 10$ minutes.
  - `stale`: readings older than 45 minutes.
  - `spike`: short-term rate significantly exceeds 4-hour trend and sustainable pace.
  - `unsustainable`: sustained burn rate exceeds sustainable pace ($> 1.2\times$).
  - `low` / `normal`: within sustainable capacity.
  - `exhausted`: quota at 100% used.
- **Projected exhaustion**: $\text{now} + (R / \text{currentBurnRate}) \times 1\text{ hour}$ when exhaustion precedes $T$.

## Activity Profile Contract & Fallback Rules

- **Path**: `<orca config dir>/quota-pace-profile.json` (resolves `$XDG_CONFIG_HOME/orca` or `~/.config/orca` on Linux).
- **Format (v1)**:
  ```json
  {
    "version": 1,
    "generatedAt": "2026-11-09T14:00:00Z",
    "timezone": "Europe/Madrid",
    "from": "2026-10-10",
    "to": "2026-11-09",
    "days": 30,
    "weights": [168 numbers]
  }
  ```
  - `weights[d*24 + h]`: relative expected activity for local weekday $d$ (`Date.getDay()`: 0 = Sunday … 6 = Saturday) and local hour $h$ (0–23), in the profile's timezone.
  - Mean of the 168 values is 1. Weights represent relative shape only, never raw tokens or percentages.
- **Validation & Fallback**:
  - **Missing file**: falls back to uniform live allowance with a quiet note (`profile: none (uniform)`).
  - **Schema validation**: requires `version === 1`, exactly 168 non-negative finite numbers, `sum > 0`, finite `days`. Any violation falls back to uniform with note `profile ignored: <reason>`.
  - **Sufficient history**: requires `days >= 14` (`MIN_PROFILE_DAYS = 14`). Profiles with fewer days fall back to uniform with note `profile has N days, needs 14`.
  - **Timezone handling**: hours and weekdays are computed directly in the profile's declared timezone via `Intl.DateTimeFormat`. If the timezone string is invalid, the plugin falls back to uniform with note `profile ignored: invalid timezone "<tz>"`.

## Measured vs Estimated

- **Measured (high reliability)**:
  - Official provider rate limits from `orca-ide account list --json`.
  - Historical snapshots recorded before midnight by claudeops (`~/.claudeops/snapshot-cache.json`).
  - First-party readings recorded by this plugin during the day.
- **Estimated (approximate)**:
  - Token-derived baselines from Orca's daily token statistics (`orca-<provider>-usage.json`).
    Token counts are an approximation because different models and reasoning tokens carry different quota weights.
  - Burn rate slope and exhaustion timestamps (projected from recent discrete samples).
  - Activity-weighted live allowance (`Live allowance (adaptive)`), derived from the historical usage distribution in `quota-pace-profile.json` and labelled with the profile's day count.

## Storage & Backward Compatibility

- `storage:own`: stores daily baselines (`baselines`) and recent sample history (`samples`).
- Samples cap: raised from 200 to 2500 samples (`SAMPLES_CAP`), ensuring a full week of 5-minute polling ($\ge 2016$ samples) is stored to cover the weekly burn window while keeping storage bounded.
- Fully backward-compatible with 0.2.0 and 0.3.0 stored data; previous fields retain their exact meaning.

## Develop & Test

```sh
orca-ide plugin test plugins/quota-pace --json   # 79 tests covering all spec rules
orca-ide plugin check plugins/quota-pace --json  # renders panel scenarios
```
