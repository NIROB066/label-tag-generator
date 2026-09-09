import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Label Tag Studio",
  description: "Create and inspect production-ready food labels.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
