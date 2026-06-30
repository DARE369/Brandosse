import "../src/styles/app-entry.css";

export const metadata = {
  title: "Brandosse Command Center",
  description: "Social media command center and content generation platform.",
};

// Without this, mobile browsers render at ~980px and every responsive
// breakpoint is ignored (desktop sidebar shows on phones). viewport-fit=cover
// enables the env(safe-area-inset-*) used by the mobile bottom nav.
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Brandosse blend: Inter (body) + Space Grotesk (display·dark) + Playfair Display (display·light) + JetBrains Mono (data) */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&family=Playfair+Display:ital,wght@0,600;0,700;1,600&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
