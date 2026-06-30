// app/api/session-title/route.js
// Generates a short creative session title from a user prompt using Groq.

import { NextResponse } from 'next/server';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

const SYSTEM_PROMPT =
  'You are a session title generator for a social media content platform. ' +
  'Given a user prompt, return a concise 3–5 word creative title that captures ' +
  'the campaign or content theme. Do NOT copy words verbatim from the prompt. ' +
  'Return ONLY the title — no quotes, no punctuation at the end, no explanation.';

function normalizeTitle(raw = '') {
  return String(raw)
    .replace(/^[\s"'`]+|[\s"'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function POST(request) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GROQ_API_KEY not configured' }, { status: 503 });
  }

  let prompt = '';
  try {
    const body = await request.json();
    prompt = String(body?.prompt || '').trim();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!prompt) {
    return NextResponse.json({ title: 'Untitled Session' });
  }

  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.5,
        max_tokens: 20,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Prompt: "${prompt}"` },
        ],
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ title: 'Untitled Session' }, { status: 200 });
    }

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content ?? '';
    const title = normalizeTitle(raw) || 'Untitled Session';
    return NextResponse.json({ title });
  } catch {
    return NextResponse.json({ title: 'Untitled Session' });
  }
}
