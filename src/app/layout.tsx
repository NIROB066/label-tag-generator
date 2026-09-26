import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Label Tag Studio",
  description: "Create and inspect production-ready food labels.",
  manifest: "/manifest.json",
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#17211f",
  colorScheme: "light dark",
};

// Applies the persisted theme choice (if any) before first paint so the app
// never flashes the wrong theme. Without a stored choice the CSS follows the
// system preference (prefers-color-scheme) on its own.
const themeInitScript = `(function(){try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t;}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {children}
      </body>
    </html>
  );
}
