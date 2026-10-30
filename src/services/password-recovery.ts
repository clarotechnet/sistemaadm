import { createSupabasePasswordRecoveryClient } from "../lib/supabase/client";
import { RECOVERY_LIFETIME_MS, RECOVERY_LINK_ERROR, RECOVERY_SESSION_KEY, readRecoveryIdentity, recoveryRedirectUrl, type RecoveryIdentity } from "../auth/password-recovery";

let client: ReturnType<typeof createSupabasePasswordRecoveryClient> | undefined;
const recoveryClient = () => client ??= createSupabasePasswordRecoveryClient();
let exchange: { code: string; promise: Promise<RecoveryIdentity> } | undefined;

function remember(identity: RecoveryIdentity) {
  // Only a short-lived UI marker, never a password or token. getUser verifies it.
  try { window.sessionStorage.setItem(RECOVERY_SESSION_KEY, JSON.stringify(identity)); } catch { /* The current view still works when browser storage is disabled. */ }
}

function forget() {
  try { window.sessionStorage.removeItem(RECOVERY_SESSION_KEY); } catch { /* No stored marker to remove. */ }
  exchange = undefined;
}

export async function requestPasswordRecovery(email: string, origin: string) {
  const { error } = await recoveryClient().auth.resetPasswordForEmail(email.trim(), { redirectTo: recoveryRedirectUrl(origin) });
  // Do not expose whether an account exists, including providers returning 404.
  if (error && !["user_not_found", "invalid_credentials"].includes(error.code ?? "")) throw error;
}

export async function verifyPasswordRecovery(url: URL): Promise<RecoveryIdentity> {
  const hash = new URLSearchParams(url.hash.slice(1));
  if (url.searchParams.has("error") || url.searchParams.has("error_code") || hash.has("error") || hash.has("error_code")) {
    forget();
    throw new Error(RECOVERY_LINK_ERROR);
  }
  const code = url.searchParams.get("code");
  if (code) {
    if (exchange?.code === code) return exchange.promise;
    forget();
    const promise = (async () => {
      const auth = recoveryClient().auth;
      let recoveryUserId: string | undefined;
      const { data: listener } = auth.onAuthStateChange((event, session) => {
        if (event === "PASSWORD_RECOVERY") recoveryUserId = session?.user.id;
      });
      let result;
      try { result = await auth.exchangeCodeForSession(code); }
      finally { listener.subscription.unsubscribe(); }
      const { data, error } = result;
      if (error || !data.user || recoveryUserId !== data.user.id) throw new Error(RECOVERY_LINK_ERROR);
      const { data: verified, error: verificationError } = await auth.getUser();
      if (verificationError || verified.user?.id !== data.user.id) throw new Error(RECOVERY_LINK_ERROR);
      if (exchange?.code !== code) throw new Error(RECOVERY_LINK_ERROR);
      const identity = { userId: verified.user.id, expiresAt: Date.now() + RECOVERY_LIFETIME_MS };
      remember(identity);
      return identity;
    })();
    // React StrictMode must not exchange a one-use code twice.
    exchange = { code, promise };
    return promise;
  }
  let identity: RecoveryIdentity | null = null;
  try { identity = readRecoveryIdentity(window.sessionStorage.getItem(RECOVERY_SESSION_KEY)); } catch { /* No resumable recovery in this tab. */ }
  if (!identity) throw new Error(RECOVERY_LINK_ERROR);
  const { data, error } = await recoveryClient().auth.getUser();
  if (error || data.user?.id !== identity.userId) {
    forget();
    throw new Error(RECOVERY_LINK_ERROR);
  }
  return identity;
}

export async function finishPasswordRecovery(identity: RecoveryIdentity, password: string) {
  if (!readRecoveryIdentity(JSON.stringify(identity))) throw new Error(RECOVERY_LINK_ERROR);
  const auth = recoveryClient().auth;
  const { data, error: verificationError } = await auth.getUser();
  // A session changed in another tab must not update a different person's password.
  if (verificationError || data.user?.id !== identity.userId) {
    forget();
    throw new Error(RECOVERY_LINK_ERROR);
  }
  const { error } = await auth.updateUser({ password });
  if (error) throw error;
  forget();
  try {
    const { error: signOutError } = await auth.signOut({ scope: "local" });
    return { signedOut: !signOutError };
  } catch {
    // The password is already changed, even if ending the local session fails.
    return { signedOut: false };
  }
}
