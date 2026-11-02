// Test fixture only; Orca never loads this file.
// Trimmed from a real `orca account list --json` (Orca 1.4.246) on 2026-11-02.
export const REAL_RATE_LIMITS = {
  claude: {
    provider: 'claude',
    session: null,
    weekly: {
      usedPercent: 60,
      windowMinutes: 10080,
      resetsAt: 1793872799675,
      resetDescription: 'jue, 10:59'
    },
    fableWeekly: {
      usedPercent: 0,
      windowMinutes: 10080,
      resetsAt: 1793872800000,
      resetDescription: 'jue, 11:00'
    },
    extraUsage: null,
    updatedAt: 1793654176113,
    error: null,
    status: 'ok'
  },
  codex: {
    provider: 'codex',
    session: {
      usedPercent: 2,
      windowMinutes: 300,
      resetsAt: 1793670880000,
      resetDescription: 'mar, 2:54'
    },
    weekly: {
      usedPercent: 37,
      windowMinutes: 10080,
      resetsAt: 1794077752000,
      resetDescription: 'sáb, 19:55'
    },
    updatedAt: 1793654023069,
    error: null,
    status: 'ok',
    rateLimitResetCredits: { availableCount: 2, credits: [] }
  },
  gemini: {
    provider: 'gemini',
    session: null,
    weekly: null,
    updatedAt: 1793654022465,
    error: 'Gemini CLI OAuth is disabled in settings',
    status: 'unavailable'
  },
  opencodeGo: {
    provider: 'opencode-go',
    session: null,
    weekly: null,
    monthly: null,
    updatedAt: 1793654022724,
    error: 'The OpenCode Go API key was rejected.',
    status: 'error'
  },
  antigravity: {
    provider: 'antigravity',
    session: { usedPercent: 0, windowMinutes: 300, resetsAt: 1793672026000, resetDescription: null },
    weekly: { usedPercent: 0, windowMinutes: 10080, resetsAt: 1794229150000, resetDescription: null },
    buckets: [{ name: 'Gemini Models · Weekly Limit Remaining' }],
    updatedAt: 1793654026601,
    error: null,
    status: 'ok'
  }
}

/** The whole answer of `orca account list --json` around the rate limits above. */
export const REAL_ACCOUNT_LIST = { id: 'x', ok: true, result: { claude: { accounts: [] }, rateLimits: REAL_RATE_LIMITS } }
