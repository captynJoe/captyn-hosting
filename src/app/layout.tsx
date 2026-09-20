import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CAPTYN Hosting",
  description: "Managed hosting operations for CAPTYN-built sites.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
