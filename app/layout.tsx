import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "DJ TITAN — Professional DJ Studio",
  description: "Professional DJ studio with 4 TITAN-3K decks, TITAN CORE mixer, TITAN VINYL turntables, TITAN LAB production, effects, AI mixing and offline support",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
