import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AChat",
  description: "A local workspace for AI contact collaboration.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
