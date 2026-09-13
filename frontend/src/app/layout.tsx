import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "THABBET | Document Compliance Platform",
  description: "Document Compliance Made Simple - Automated document OCR, verification, and template compliance checks.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}