"use client";
/* eslint-disable @next/next/no-html-link-for-pages, @next/next/no-img-element -- Also served by the static SPA without a Next router or image optimizer. */

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, CheckCircle2, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { RECOVERY_LINK_ERROR, RECOVERY_SENT_MESSAGE, passwordRecoveryError, validateNewPassword, validateRecoveryEmail, type RecoveryIdentity } from "../../src/auth/password-recovery";
import { finishPasswordRecovery, requestPasswordRecovery, verifyPasswordRecovery } from "../../src/services/password-recovery";

export function PasswordRecoveryScreen({ mode }: { mode: "request" | "reset" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [identity, setIdentity] = useState<RecoveryIdentity | null>(null);
  const [checking, setChecking] = useState(mode === "reset");
  const [invalid, setInvalid] = useState(false);
  const [done, setDone] = useState(false);
  const [signedOut, setSignedOut] = useState(true);
  const submitting = useRef(false);

  useEffect(() => {
    if (mode !== "reset") return;
    let active = true;
    let revision = 0;
    const check = () => {
      const request = ++revision;
      const url = new URL(window.location.href);
      setChecking(true);
      setInvalid(false);
      setIdentity(null);
      void verifyPasswordRecovery(url).then(verified => {
        if (active && request === revision) setIdentity(verified);
      }).catch(() => {
        if (active && request === revision) setInvalid(true);
      }).finally(() => {
        if (active && request === revision) {
          // Remove one-time codes and provider errors from the visible address.
          window.history.replaceState(window.history.state, "", "/redefinir-senha");
          setChecking(false);
        }
      });
    };
    check();
    window.addEventListener("hashchange", check);
    return () => { active = false; window.removeEventListener("hashchange", check); };
  }, [mode]);

  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || (mode === "request" && cooldown > 0)) return;
    const validation = mode === "request" ? validateRecoveryEmail(email) : validateNewPassword(password, confirmation);
    if (validation) { setError(validation); return; }
    if (mode === "reset" && !identity) { setInvalid(true); return; }
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      if (mode === "request") {
        await requestPasswordRecovery(email, window.location.origin);
        setSent(true);
        setCooldown(60);
      } else if (identity) {
        const result = await finishPasswordRecovery(identity, password);
        setPassword("");
        setConfirmation("");
        setIdentity(null);
        setSignedOut(result.signedOut);
        setDone(true);
      }
    } catch (caught) {
      if (caught instanceof Error && caught.message === RECOVERY_LINK_ERROR) setInvalid(true);
      else setError(passwordRecoveryError(caught, mode === "reset"));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return <main className="registration-page password-recovery-page">
    <meta name="referrer" content="no-referrer" />
    <meta name="robots" content="noindex, nofollow" />
    <a href="/" className="back-link"><ArrowLeft /> Voltar ao login</a>
    <section className="registration-card password-recovery-card" aria-labelledby="recovery-title">
      <div className="recovery-brand"><img src="/logo-empresa-ui.png" alt="Logo da empresa" /><strong>RH Controle</strong></div>
      <span className="auth-form-icon">{mode === "request" ? <Mail /> : <LockKeyhole />}</span>
      <h1 id="recovery-title">{mode === "request" ? "Recuperar senha" : "Definir nova senha"}</h1>
      {checking ? <p role="status">Validando seu link de recuperação...</p> : done ? <div className="recovery-feedback" role="status">
        <CheckCircle2 /><h2>Senha alterada com sucesso</h2>
        <p>{signedOut ? "Entre novamente com sua nova senha." : "A senha foi alterada, mas não foi possível encerrar a sessão. Ao continuar, saia da conta se estiver em um computador compartilhado."}</p>
        <a className="button primary full" href="/">{signedOut ? "Voltar ao login" : "Continuar"}</a>
      </div> : invalid ? <div className="recovery-feedback">
        <p className="inline-error" role="alert">{RECOVERY_LINK_ERROR}</p>
        <a className="button primary full" href="/recuperar-senha">Solicitar novo link</a>
      </div> : <>
        <p>{mode === "request" ? "Informe o e-mail usado neste sistema para receber um link de recuperação." : "Escolha uma senha exclusiva para o RH Controle e confirme abaixo."}</p>
        {sent && <div className="recovery-notice" role="status"><CheckCircle2 /><p>{RECOVERY_SENT_MESSAGE}</p></div>}
        <form onSubmit={event => void submit(event)}>
          {mode === "request" ? <label className="field"><span>E-mail da conta</span><input type="email" name="email" autoComplete="email" value={email} onChange={event => { setEmail(event.target.value); setSent(false); }} placeholder="nome@empresa.com.br" required disabled={busy} /></label> : <>
            <label className="field"><span>Nova senha</span><div className="password-input"><input type={show ? "text" : "password"} name="new-password" autoComplete="new-password" minLength={8} value={password} onChange={event => setPassword(event.target.value)} required disabled={busy} aria-describedby="password-requirements" /><button type="button" onClick={() => setShow(value => !value)} aria-label={show ? "Ocultar nova senha" : "Mostrar nova senha"}>{show ? <EyeOff /> : <Eye />}</button></div></label>
            <p id="password-requirements" className="recovery-help">Use pelo menos 8 caracteres. Evite repetir a senha de outros sistemas.</p>
            <label className="field"><span>Confirmar nova senha</span><input type={show ? "text" : "password"} name="confirm-password" autoComplete="new-password" minLength={8} value={confirmation} onChange={event => setConfirmation(event.target.value)} required disabled={busy} /></label>
          </>}
          {error && <p className="inline-error" role="alert">{error}</p>}
          <button className="button primary full" type="submit" disabled={busy || checking || (mode === "request" && cooldown > 0) || (mode === "reset" && !identity)}>{busy ? (mode === "request" ? "Enviando..." : "Salvando...") : cooldown > 0 && mode === "request" ? `Reenviar em ${cooldown}s` : mode === "request" ? (sent ? "Reenviar link" : "Enviar link de recuperação") : "Salvar nova senha"}</button>
        </form>
        {mode === "request" && <p className="recovery-help">Abra o link no mesmo navegador e dispositivo em que solicitou a recuperação. Pedir o link não altera sua senha atual.</p>}
      </>}
      <div className="auth-note"><ShieldCheck /><span>A recuperação altera somente sua senha. Permissões, folhas e documentos permanecem preservados.</span></div>
    </section>
  </main>;
}
