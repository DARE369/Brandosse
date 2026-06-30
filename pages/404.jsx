export default function LegacyPagesRouterNotFound() {
  return (
    <main style={{
      minHeight: "100vh",
      display: "grid",
      placeItems: "center",
      background: "#060817",
      color: "#f8fafc",
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
      padding: "24px",
      textAlign: "center",
    }}>
      <div>
        <p style={{ color: "#a78bfa", fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          Brandosse
        </p>
        <h1 style={{ margin: "12px 0", fontSize: "clamp(32px, 6vw, 56px)" }}>Page not found</h1>
        <p style={{ color: "#94a3b8" }}>This fallback exists so Next ignores the legacy Vite src/pages folder during migration.</p>
      </div>
    </main>
  );
}
