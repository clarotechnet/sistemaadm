import type { AuthChangeEvent } from "@supabase/supabase-js";

export type AuthSessionDecision = "ignore" | "sign-out" | "refresh-profile" | "replace-user";

export function decideAuthSessionEvent(
  event: AuthChangeEvent,
  sessionUserId: string | null,
  currentUserId: string | null,
  initialized: boolean,
): AuthSessionDecision {
  if (!initialized || event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return "ignore";
  if (event === "SIGNED_OUT" || !sessionUserId) return "sign-out";
  if (event === "SIGNED_IN" && sessionUserId === currentUserId) return "ignore";
  return sessionUserId === currentUserId ? "refresh-profile" : "replace-user";
}
