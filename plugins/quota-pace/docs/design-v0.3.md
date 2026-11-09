# Quota Pace v0.3 Design & Precedents Audit

## 1. Audit of Existing Implementation (v0.2.0)

We audited `src/pace.ts`, `src/worker.ts`, and `src/panel.tsx`:
- `pace.ts`: Pure calculations spreading remaining quota from local midnight across remaining days.
- `worker.ts`: Background polling of `orca-ide account list --json` every 5m, storage in `orca.storage`.
- `panel.tsx`: Presentation of daily budget, progress bar, and provider issue list.

### Confirmed Bugs & Limitations (A–F)
- **Bug A (Midnight anchor):** Daily budget is retrospective from midnight. When `usedToday > allowanceToday`, the UI flags "over budget" even if abundant capacity remains. Fixed by separating historical daily budget from live sustainable allowance (`remainingTodayLive`).
- **Bug B (`daysLeft` indicator):** `daysLeft` was measured from midnight instead of `now`. Fixed by introducing `daysUntilReset` and `hoursUntilReset` calculated from real time.
- **Bug C (Token baseline estimation):** Assumed 1:1 proportionality between token counts and quota percent. Different models and token types (reasoning, cache) burn quota differently. Fixed by isolating estimates under `'estimate'` source, capping by real observations, and documenting approximations.
- **Bug D (Baseline selection rank):** Token estimates received artificial `firstSeenAt: midnight`, allowing lower-reliability estimates to override actual readings taken shortly after midnight. Fixed by prioritizing real readings and clamping estimates to real readings.
- **Bug E (Pre-midnight history):** `baselineFromHistory` picked the last reading before midnight regardless of age (e.g. 10 hours old). Fixed by evaluating reading age and staleness.
- **Bug F (Resets & calendar math):** DST transitions (23h/25h days) and midday resets ($T < m$) caused distorted allowances. Fixed with calendar-aware Date transitions and capping midday resets to remaining time.

## 2. Precedents Review

- **quotamax:** Proves value of agent capacity advice and weekly pacing; demonstrated that models require capacity reserves rather than consuming all headroom.
- **claude-codex-monitor:** Precedent for burn rate (pp/h), pace multiplier ($current / sustainable$), and projected exhaustion timestamp. Integrated into Phase 3.
- **tally:** Patterns for multi-subscription visualization and clean capacity summary.
- **AI Usage Tracker:** Model for multi-device telemetry, idempotent sync, and explicit unattributed usage ($U_{unattributed}$). Used in Phase 4 design.
- **agent-quotas:** Verified local collector pattern without credential sharing.
- **ccfuel:** Reinforced strict separation between measured provider quotas and estimated local usage.
- **Google SRE SLO Alerting:** Dual-window burn rate pattern (short 30m window for spikes vs 4h window for sustained trend) prevents false alerts.

## 3. What Was Verified vs Unverified

- **Verified in Code:** Rate limit schemas, weekly window parsing, local storage lifecycle, component check scenarios, and exact formulas for uniform allocation.
- **Unverified / Approximated:** Universal token-to-quota conversion factors (Anthropic and OpenAI do not publish exact per-token quota weights for subscription tiers). Token estimates remain flagged as estimates.

## 4. Architectural Decisions for v0.3

1. **Zero New Dependencies:** Implemented with standard TypeScript and Orca SDK APIs.
2. **Dual-Budget Display:** Preserves traditional daily budget (`allowanceToday`) alongside live sustainable allowance (`remainingTodayLive`).
3. **Robust Burn Rate Engine:** Detects `insufficient_data`, `stale`, `spike`, `unsustainable`, `normal`, and `exhausted` states without false precision.
4. **100% Backward Compatibility:** Retains all 0.2.0 stored baseline keys and schema fields.
