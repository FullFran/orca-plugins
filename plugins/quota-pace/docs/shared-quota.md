# Shared Quota Architecture (Phase 4 Proposal)

## 1. Overview & Context

When sharing an AI subscription quota (e.g. Claude Code or Codex between Fran and Alejandro), the provider exposes a single global quota percentage $U_{\mathrm{global}}$.

To manage capacity sustainably without deceptive attribution or credential sharing, Quota Pace proposes a formal architecture for multi-participant tracking.

## 2. Three Operational Modes

### Mode 1: Individual Mode (Single Participant — Current v0.3)
- **Operation:** Only the local developer's Orca instance collects data.
- **Infrastructure:** Local only. No remote servers, no sync daemon, zero external communication.
- **Assumptions:** All quota consumption is measured against the single user's workflow.

### Mode 2: Manual Reserved Budgets (No Telemetry Sync)
- **Operation:** The global weekly capacity $R$ is partitioned into explicit budget allocations:
  - Fran: $w_1 = 50\%$
  - Alejandro: $w_2 = 50\%$
  - Common emergency reserve: $s = 10\%$
- **Policy:** Each participant configures their agreed share locally. If global consumption exceeds the planned allocation, the local panel displays the global state alongside the user's allocated slice.
- **Advantage:** Requires zero network synchronization or server setup.

### Mode 3: Authorized Multi-Collector Telemetry
- **Operation:** Each participant runs a local collector daemon inside their trusted environment.
- **Data Flow:**
  ```text
  Collector Fran (Local Orca)      ──┐
                                     ├── Telemetry Aggregator (Append-Only)
  Collector Alejandro (Local Orca) ──┘        │
                                              ▼
                                      Attribution Engine
                                              │
                                     ┌────────┴────────┐
                                     ▼                 ▼
                                Global Pace      User Allocations
  ```
- **Attribution Model:**
  $$U_{\mathrm{global}} = U_{\mathrm{Fran}} + U_{\mathrm{Alejandro}} + U_{\mathrm{unattributed}}$$
  Where:
  - **Measured:** Global quota reading directly from provider CLI ($U_{\mathrm{global}}$).
  - **Observed:** Local token metrics collected per participant ($T_i$).
  - **Estimated:** Attributed share of quota increment assigned to participant $i$ based on overlapping activity intervals and model weights.
  - **Unattributed:** Quota delta observed on provider that had no corresponding local telemetry event.

## 3. Data Contracts & Schemas

```typescript
export type ParticipantId = string // e.g. 'fran', 'alejandro'

export interface UsageEvent {
  /** Unique idempotent event ID: hash(participantId + machineId + startAt + seq) */
  eventId: string
  participantId: ParticipantId
  sessionId?: string
  /** ISO 8601 or epoch ms */
  startAt: number
  endAt: number
  /** Aggregated token counts across models */
  tokens: {
    model: string
    inputTokens: number
    outputTokens: number
    cacheWriteTokens: number
    cacheReadTokens: number
  }[]
  /** Equivalent estimated API cost (USD) for normalized weighting */
  estimatedCostUsd?: number
}

export interface ProviderQuotaReading {
  provider: string
  windowKey: string
  observedAt: number
  usedPercent: number
  resetsAt: number
}

export interface AttributionInterval {
  windowStart: number
  windowEnd: number
  deltaQuotaPercent: number
  attributed: Record<ParticipantId, {
    estimatedPercent: number
    observedTokens: number
    confidence: 'high' | 'medium' | 'low'
  }>
  unattributedPercent: number
}
```

## 4. Privacy, Security & Compliance

- **No Credential Sharing:** Participants never share API keys, session tokens, or OAuth secrets.
- **No Content Synchronization:** Prompts, code snippets, project names, and conversation logs are **never** collected or transmitted.
- **Encrypted Transport:** If an aggregator is configured, telemetry events are signed with participant public keys and transmitted over TLS.

## 5. Offline Operation & Event Reconciliation

- **Idempotency:** Events carry deterministic `eventId`s. Duplicate submissions are deduplicated automatically.
- **Delayed Delivery:** When a collector is offline, events are buffered in local storage and submitted when reconnected. The attribution engine recalculates interval estimates retroactively upon receiving delayed events without altering frozen historical baselines.
