export const metadata = {
  title: "Brandosse Command Center",
  description: "Social media command center and content generation platform.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
