import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AnExcel",
  description:
    "Turn a stack of scanned answer sheets into a ready-to-submit mark list.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
