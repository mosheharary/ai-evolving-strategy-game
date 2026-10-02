import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Echoes of the Frontier",
  description: "An evolving 3D grand-strategy game where the world remembers what you did.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0e1216" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
