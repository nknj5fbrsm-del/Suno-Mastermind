type UsageMeta = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
};

type TokenUsageEvent = {
  timestamp: number;
  model: string;
  feature: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimated: boolean;
};

type TokenUsageSnapshot = {
  sessionTotal: number;
  todayTotal: number;
  lastEvent: TokenUsageEvent | null;
  quota: {
    dailyBudgetTokens: number;
    remainingTodayTokens: number;
    usageRatio: number;
    lastQuotaErrorAt: number | null;
    cooldownUntil: number | null;
    recentQuotaErrors: number;
    status: "green" | "yellow" | "red";
    canGenerateLikely: boolean;
  };
};

const DAILY_STORAGE_KEY = "suno_token_usage_daily_v1";
const QUOTA_STATE_STORAGE_KEY = "suno_token_quota_state_v1";
const DEFAULT_DAILY_BUDGET_TOKENS = 300_000;
const RECENT_QUOTA_WINDOW_MS = 10 * 60 * 1000;
const HARD_QUOTA_BLOCK_MS = 2 * 60 * 1000;

let sessionTotal = 0;
let lastEvent: TokenUsageEvent | null = null;
const listeners = new Set<(snapshot: TokenUsageSnapshot) => void>();
let lastQuotaErrorAt: number | null = null;
let cooldownUntil: number | null = null;
const quotaErrorTimestamps: number[] = [];

const todayKey = (): string => new Date().toISOString().slice(0, 10);

const readDailyTotals = (): Record<string, number> => {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(DAILY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const writeDailyTotals = (totals: Record<string, number>): void => {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(totals));
  } catch {
    // Ignore storage errors (private mode / quota).
  }
};

const updateTodayTotal = (delta: number): number => {
  const key = todayKey();
  const totals = readDailyTotals();
  const current = Number(totals[key] ?? 0);
  const next = Math.max(0, current + delta);
  totals[key] = next;
  writeDailyTotals(totals);
  return next;
};

const getTodayTotal = (): number => {
  const key = todayKey();
  const totals = readDailyTotals();
  return Number(totals[key] ?? 0);
};

const readQuotaState = (): { lastQuotaErrorAt: number | null; cooldownUntil: number | null; errors: number[] } => {
  if (typeof window === "undefined") return { lastQuotaErrorAt: null, cooldownUntil: null, errors: [] };
  try {
    const raw = localStorage.getItem(QUOTA_STATE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const errors = Array.isArray(parsed?.errors)
      ? parsed.errors.map((x: unknown) => Number(x)).filter((n: number) => Number.isFinite(n))
      : [];
    return {
      lastQuotaErrorAt: Number.isFinite(Number(parsed?.lastQuotaErrorAt)) ? Number(parsed.lastQuotaErrorAt) : null,
      cooldownUntil: Number.isFinite(Number(parsed?.cooldownUntil)) ? Number(parsed.cooldownUntil) : null,
      errors,
    };
  } catch {
    return { lastQuotaErrorAt: null, cooldownUntil: null, errors: [] };
  }
};

const writeQuotaState = (): void => {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      QUOTA_STATE_STORAGE_KEY,
      JSON.stringify({
        lastQuotaErrorAt,
        cooldownUntil,
        errors: quotaErrorTimestamps,
      })
    );
  } catch {
    // Ignore storage errors (private mode / quota).
  }
};

const getQuotaHealth = () => {
  const now = Date.now();
  const todayTotal = getTodayTotal();
  const dailyBudgetTokens = DEFAULT_DAILY_BUDGET_TOKENS;
  const usageRatio = Math.min(1, todayTotal / dailyBudgetTokens);
  const remainingTodayTokens = Math.max(0, dailyBudgetTokens - todayTotal);
  const activeCooldown = Boolean(cooldownUntil && cooldownUntil > now);
  const recentQuotaErrors = quotaErrorTimestamps.filter((ts) => now - ts <= RECENT_QUOTA_WINDOW_MS).length;
  const lastQuotaRecent = Boolean(lastQuotaErrorAt && now - lastQuotaErrorAt <= HARD_QUOTA_BLOCK_MS);

  let status: "green" | "yellow" | "red" = "green";
  if (activeCooldown || lastQuotaRecent || usageRatio >= 0.95 || recentQuotaErrors >= 2) status = "red";
  else if (usageRatio >= 0.8 || recentQuotaErrors >= 1) status = "yellow";

  return {
    dailyBudgetTokens,
    remainingTodayTokens,
    usageRatio,
    lastQuotaErrorAt,
    cooldownUntil,
    recentQuotaErrors,
    status,
    canGenerateLikely: status !== "red",
  };
};

const ensureQuotaStateLoaded = (): void => {
  if (lastQuotaErrorAt !== null || cooldownUntil !== null || quotaErrorTimestamps.length > 0) return;
  const persisted = readQuotaState();
  lastQuotaErrorAt = persisted.lastQuotaErrorAt;
  cooldownUntil = persisted.cooldownUntil;
  quotaErrorTimestamps.splice(0, quotaErrorTimestamps.length, ...persisted.errors.slice(-30));
};

const emit = (): void => {
  ensureQuotaStateLoaded();
  const snapshot: TokenUsageSnapshot = {
    sessionTotal,
    todayTotal: getTodayTotal(),
    lastEvent,
    quota: getQuotaHealth(),
  };
  for (const listener of listeners) listener(snapshot);
};

const toSafeInt = (value: unknown): number => {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.round(num));
};

export const recordTokenUsage = (event: {
  model: string;
  feature: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimated?: boolean;
}): void => {
  const promptTokens = toSafeInt(event.promptTokens);
  const completionTokens = toSafeInt(event.completionTokens);
  const totalTokens = toSafeInt(event.totalTokens || promptTokens + completionTokens);
  if (totalTokens <= 0) return;

  sessionTotal += totalTokens;
  updateTodayTotal(totalTokens);
  lastEvent = {
    timestamp: Date.now(),
    model: event.model,
    feature: event.feature,
    promptTokens,
    completionTokens,
    totalTokens,
    estimated: Boolean(event.estimated),
  };
  emit();
};

export const recordQuotaError = (cooldownMs = 0): void => {
  const now = Date.now();
  lastQuotaErrorAt = now;
  cooldownUntil = cooldownMs > 0 ? now + cooldownMs : now + HARD_QUOTA_BLOCK_MS;
  quotaErrorTimestamps.push(now);
  while (quotaErrorTimestamps.length > 30) quotaErrorTimestamps.shift();
  writeQuotaState();
  emit();
};

export const extractUsageMeta = (response: unknown): UsageMeta | null => {
  if (!response || typeof response !== "object") return null;
  const maybe = response as { usageMetadata?: UsageMeta; usage_metadata?: UsageMeta };
  const usage = maybe.usageMetadata ?? maybe.usage_metadata;
  if (!usage || typeof usage !== "object") return null;
  return usage;
};

export const subscribeTokenUsage = (listener: (snapshot: TokenUsageSnapshot) => void): (() => void) => {
  ensureQuotaStateLoaded();
  listeners.add(listener);
  listener({
    sessionTotal,
    todayTotal: getTodayTotal(),
    lastEvent,
    quota: getQuotaHealth(),
  });
  return () => {
    listeners.delete(listener);
  };
};

export const getTokenUsageSnapshot = (): TokenUsageSnapshot => {
  ensureQuotaStateLoaded();
  return {
    sessionTotal,
    todayTotal: getTodayTotal(),
    lastEvent,
    quota: getQuotaHealth(),
  };
};
