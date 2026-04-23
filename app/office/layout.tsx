import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TITAN OFFICE — Back-office",
  description: "Admin console: users, subscriptions, licenses, deals",
  robots: { index: false, follow: false },
};

export default function OfficeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
