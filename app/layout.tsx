import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Pioneer DJ Pro MAX - Ultimate DJ Console",
  description: "Professional DJ console with dual decks, mixer, effects, and YouTube integration",
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
