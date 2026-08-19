// Generates a creative session title from a user prompt via the /api/session-title route.
// The route calls the configured LLM providers server-side; no browser token needed.
// To migrate providers: update /api/session-title/route.js only; this file stays the same.
//
// Returns { title, source }. The title is NEVER derived from the prompt text —
// a first-N-words-of-prompt session name is a deliberate non-goal. When every
// provider fails the title stays the generic placeholder and `source` is
// 'pending', which marks the session as "named by nothing yet" so it can be
// found and properly renamed later, rather than being indistinguishable from a
// session that is legitimately untitled.

const SESSION_TITLE_ENDPOINT = '/api/session-title';
const FALLBACK_TITLE = 'Untitled Session';

// Sources that mean a model actually produced the title. Anything else the
// route reports ('unconfigured', 'all-providers-failed', ...) is a failure that
// happens to carry the placeholder title.
const PROVIDER_SOURCES = new Set(['groq', 'anthropic']);

export async function generateSessionTitle(prompt) {
  const trimmedPrompt = String(prompt || '').trim();
  if (!trimmedPrompt) return { title: FALLBACK_TITLE, source: 'empty-prompt' };

  try {
    const response = await fetch(SESSION_TITLE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: trimmedPrompt }),
    });

    if (!response.ok) return { title: FALLBACK_TITLE, source: 'pending' };

    const data = await response.json();
    const title = String(data?.title || '').trim();
    const source = String(data?.source || '').trim();

    if (!title || !PROVIDER_SOURCES.has(source)) {
      return { title: FALLBACK_TITLE, source: 'pending' };
    }

    return { title, source };
  } catch {
    return { title: FALLBACK_TITLE, source: 'pending' };
  }
}
