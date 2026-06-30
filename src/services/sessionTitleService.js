// Generates a creative session title from a user prompt via the /api/session-title route.
// The route calls the configured LLM provider server-side; no browser token needed.
// To migrate providers: update /api/session-title/route.js only; this file stays the same.

const SESSION_TITLE_ENDPOINT = '/api/session-title';

export async function generateSessionTitle(prompt) {
  const trimmedPrompt = String(prompt || '').trim();
  if (!trimmedPrompt) return 'Untitled Session';

  try {
    const response = await fetch(SESSION_TITLE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: trimmedPrompt }),
    });

    if (!response.ok) return 'Untitled Session';

    const data = await response.json();
    const title = String(data?.title || '').trim();
    return title || 'Untitled Session';
  } catch {
    return 'Untitled Session';
  }
}
