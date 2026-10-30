import type { Metadata } from "next";
import { PasswordRecoveryScreen } from "../ui/PasswordRecoveryScreen";

export const metadata: Metadata = { title: "Nova senha | RH Controle", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function ResetPassword() {
  return <PasswordRecoveryScreen mode="reset" />;
}
