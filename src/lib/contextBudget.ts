// Context budget estimation for the persistent-memory trigger.
//
// The numerator is real (usage.prompt_tokens reported by the provider). The
// denominator is not: ModelEntry.contextWindow comes from inferLimits(), a
// model-id regex table that misses most self-hosted / proxied / aggregator
// model ids — and NyaaChat users bring their own endpoints, so a miss is the
// common case, not the exception. Everything here exists to keep a wrong
// denominator from causing either silent non-triggering or repeated paid
// extraction prompts.

import type { AppState, Message, ModelEntry } from "../types";

/** Used when the model's context window is unknown. Deliberately low: a
 *  too-small denominator triggers extraction early (mildly wasteful but safe),
 *  while a too-large one lets the conversation walk into an upstream 400. */
export const FALLBACK_CONTEXT_WINDOW = 32_000;

/** Default trigger threshold, as a percentage of the context window. */
export const DEFAULT_THRESHOLD_PCT = 70;
/** Accepted range for the user-facing threshold setting. */
export const MIN_THRESHOLD_PCT = 40;
export const MAX_THRESHOLD_PCT = 90;

export type ContextWindowSource = "override" | "probed" | "fallback";

export interface ContextBudget {
  /** Latest known prompt_tokens for this conversation, or null if never reported. */
  usedTokens: number | null;
  /** Denominator actually used. */
  contextWindow: number;
  /** Where the denominator came from — drives UI wording. */
  source: ContextWindowSource;
  /** usedTokens / contextWindow, or null when usedTokens is null. */
  ratio: number | null;
  /** True when ratio >= threshold. False whenever ratio is null. */
  overThreshold: boolean;
  thresholdPct: number;
}

/**
 * Resolve the context window for a model id.
 *
 * Precedence is deliberate: a value the user typed always wins over a probed
 * one, because the probe is a regex guess and the user can read their
 * provider's docs. `probed` is ModelEntry.contextWindow as filled by
 * inferLimits() during a health check.
 */
export function resolveContextWindow(
  modelId: string,
  entry: ModelEntry | undefined,
  overrides: Record<string, number> | undefined,
): { value: number; source: ContextWindowSource } {
  const override = overrides?.[modelId];
  if (Number.isFinite(override) && (override as number) > 0) {
    return { value: Math.floor(override as number), source: "override" };
  }
  if (Number.isFinite(entry?.contextWindow) && (entry!.contextWindow as number) > 0) {
    return { value: Math.floor(entry!.contextWindow as number), source: "probed" };
  }
  return { value: FALLBACK_CONTEXT_WINDOW, source: "fallback" };
}

/**
 * Most recent prompt_tokens in this conversation.
 *
 * Scans backwards for the newest user message carrying a tokenCount, because
 * ChatInterface writes prompt_tokens onto the user message and
 * completion_tokens onto the assistant one (ChatInterface.tsx:717/722) —
 * taking the last tokenCount of any role would read the completion count.
 *
 * Returns null when no turn has reported usage yet (non-streaming providers
 * that omit usage, or a freshly imported conversation).
 */
export function latestPromptTokens(messages: Message[]): number | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && Number.isFinite(m.tokenCount) && (m.tokenCount as number) > 0) {
      return m.tokenCount as number;
    }
  }
  return null;
}

export function computeContextBudget(args: {
  messages: Message[];
  modelId: string;
  entry: ModelEntry | undefined;
  settings: AppState;
}): ContextBudget {
  const { messages, modelId, entry, settings } = args;
  const { value: contextWindow, source } = resolveContextWindow(
    modelId, entry, settings.modelContextOverrides,
  );
  const rawPct = Number(settings.memoryThresholdPct);
  const thresholdPct = Number.isFinite(rawPct)
    ? Math.min(MAX_THRESHOLD_PCT, Math.max(MIN_THRESHOLD_PCT, Math.floor(rawPct)))
    : DEFAULT_THRESHOLD_PCT;

  const usedTokens = latestPromptTokens(messages);
  const ratio = usedTokens == null ? null : usedTokens / contextWindow;
  return {
    usedTokens,
    contextWindow,
    source,
    ratio,
    // No usage data → never trigger. Guessing from character count would make
    // the paid extraction fire on a number we invented.
    overThreshold: ratio != null && ratio >= thresholdPct / 100,
    thresholdPct,
  };
}
