import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? "http://localhost:3000"),
  title: { default: "RH Controle", template: "%s | RH Controle" },
  description: "Sistema seguro para controle administrativo, folha de pagamento, benefícios e PDFs.",
  icons: { icon: "/favicon.png", shortcut: "/favicon.png" },
  openGraph: { title: "RH Controle", description: "Folha, benefícios e documentos em um só lugar.", images: [{ url: "/og.png", width: 1200, height: 630, alt: "RH Controle" }] },
  twitter: { card: "summary_large_image", title: "RH Controle", description: "Folha, benefícios e documentos em um só lugar.", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
