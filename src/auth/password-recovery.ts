export const RECOVERY_SESSION_KEY = "rh-control:password-recovery";
export const RECOVERY_LIFETIME_MS = 20 * 60 * 1000;
export const RECOVERY_LINK_ERROR = "Este link é inválido, expirou ou já foi utilizado. Solicite outro link e abra-o no mesmo navegador em que fez o pedido.";
export const RECOVERY_SENT_MESSAGE = "Se este e-mail tiver uma conta no RH Controle, você receberá um link para definir uma nova senha. Confira também a caixa de spam.";

export type RecoveryIdentity = { userId: string; expiresAt: number };

export function recoveryRedirectUrl(origin: string) {
  const url = new URL(origin);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("A recuperação exige uma conexão segura.");
  }
  return new URL("/redefinir-senha", url.origin).href;
}

export function validateRecoveryEmail(email: string) {
  const normalized = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return "Informe um e-mail válido.";
  }
  return "";
}

export function validateNewPassword(password: string, confirmation: string) {
  if (password.length < 8) return "Use uma senha com pelo menos 8 caracteres.";
  if (password !== confirmation) return "As senhas não conferem.";
  return "";
}

export function readRecoveryIdentity(value: string | null, now = Date.now()): RecoveryIdentity | null {
  try {
    const data = JSON.parse(value ?? "null");
    if (typeof data?.userId !== "string" || !data.userId || typeof data?.expiresAt !== "number") return null;
    if (data.expiresAt <= now || data.expiresAt > now + RECOVERY_LIFETIME_MS) return null;
    return { userId: data.userId, expiresAt: data.expiresAt };
  } catch {
    return null;
  }
}

export function passwordRecoveryError(error: unknown, updating = false) {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit") return "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.";
  if (code === "same_password") return "Escolha uma senha diferente da senha atual.";
  if (code === "weak_password") return "A senha não atende aos requisitos de segurança. Use uma senha mais forte.";
  if (["otp_expired", "session_not_found", "refresh_token_not_found", "bad_jwt"].includes(String(code))) return RECOVERY_LINK_ERROR;
  if (updating) return "Não foi possível alterar a senha. Tente novamente ou solicite um novo link.";
  return "Não foi possível enviar o link agora. Tente novamente em alguns minutos. Se persistir, avise o administrador.";
}
