import React from "react";
import type { AppState } from "../types";

/**
 * Read/write access to the app-level settings for components that sit deep in
 * the tree and are mounted from many different parents.
 *
 * NyaaChat deliberately threads `settings` through props everywhere else, and
 * that stays the rule — this context exists for exactly one shape of problem:
 * a leaf modal (UserAccountModal) rendered from nine unrelated call sites,
 * five of which hold no settings at all. Prop-drilling it would mean adding
 * `settings` + `onSettingsChange` to four component APIs that have no other
 * use for them, plus their parents.
 *
 * Do NOT reach for this from components that already receive `settings` as a
 * prop — two sources of truth for the same value is exactly the bug this file
 * is shaped to avoid.
 */
export interface SettingsContextValue {
  settings: AppState;
  onSettingsChange: (next: AppState) => void;
}

const SettingsContext = React.createContext<SettingsContextValue | null>(null);

export const SettingsProvider = SettingsContext.Provider;

/** Null when rendered outside the provider — callers must handle that. */
export function useAppSettings(): SettingsContextValue | null {
  return React.useContext(SettingsContext);
}
