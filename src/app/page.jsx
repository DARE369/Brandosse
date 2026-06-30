export default function NextFoundationPage() {
  return (
    <main className="min-h-dvh bg-slate-950 px-6 py-10 text-white">
      <section className="mx-auto flex min-h-[70dvh] max-w-5xl flex-col justify-center gap-8">
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-violet-400/30 bg-violet-400/10 px-3 py-1 text-sm font-semibold text-violet-200">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          Next.js foundation active
        </div>

        <div className="max-w-3xl">
          <p className="mb-3 text-sm font-bold uppercase tracking-[0.18em] text-violet-300">
            Brandosse Command Center
          </p>
          <h1 className="text-4xl font-black leading-tight md:text-6xl">
            Full-stack migration path is now open.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-8 text-slate-300 md:text-lg">
            This route is served by Next.js while the current Vite app remains intact. We can now migrate API routes, auth, and UI screens in controlled slices.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {[
            ["API routes", "Next route handlers can power server-side credits, video jobs, and webhooks."],
            ["UI polish", "Tailwind, shadcn-style components, and dashboard tokens can be layered in cleanly."],
            ["Safe migration", "The working Vite app stays available while Next reaches route parity."],
          ].map(([title, body]) => (
            <article key={title} className="rounded-xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
              <h2 className="text-base font-bold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">{body}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
