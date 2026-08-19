// app/api/session-title/route.js
// Generates a short creative session title from a user prompt.
//
// Provider order is Groq first, Anthropic second. Titles are the "cheap model"
// tier in the cost plan (3-5 words, no judgment compounding), so the premium
// provider is only ever the failover — not the default.
//
// A provider with no configured key is skipped rather than attempted, so a
// half-configured environment still names sessions via whichever key exists.

import { NextResponse } from 'next/server';

const FALLBACK_TITLE = 'Untitled Session';
const MAX_TOKENS = 32;
const TEMPERATURE = 0.5;

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

async function callGroq(key, prompt) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      temperature: TEMPERATURE,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Prompt: "${prompt}"` },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`GROQ request failed (${response.status}): ${await response.text()}`);
  }

  const payload = await response.json();
  return String(payload?.choices?.[0]?.message?.content || '');
}

async function callAnthropic(key, prompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      // Pinned to Haiku deliberately: this is cost-controlled work, never
      // worth Sonnet/Opus. Same reasoning as callPromptEngine in _shared/llm.ts.
      model: process.env.ANTHROPIC_TITLE_MODEL || 'claude-haiku-4-5-20251001',
      system: SYSTEM_PROMPT,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      messages: [{ role: 'user', content: `Prompt: "${prompt}"` }],
    }),
  });

  if (!response.ok) {
    throw new Error(`ANTHROPIC request failed (${response.status}): ${await response.text()}`);
  }

  const payload = await response.json();
  return Array.isArray(payload?.content)
    ? payload.content.map((entry) => entry?.text || '').join('\n')
    : '';
}

export async function POST(request) {
  let prompt = '';
  try {
    const body = await request.json();
    prompt = String(body?.prompt || '').trim();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!prompt) {
    return NextResponse.json({ title: FALLBACK_TITLE, source: 'empty-prompt' });
  }

  const providers = [
    { name: 'groq', key: process.env.GROQ_API_KEY, call: callGroq },
    { name: 'anthropic', key: process.env.ANTHROPIC_API_KEY, call: callAnthropic },
  ].filter((provider) => Boolean(provider.key));

  if (providers.length === 0) {
    console.error('[session-title] no LLM provider key configured (GROQ_API_KEY / ANTHROPIC_API_KEY)');
    return NextResponse.json({ title: FALLBACK_TITLE, source: 'unconfigured' });
  }

  for (const provider of providers) {
    try {
      const title = normalizeTitle(await provider.call(provider.key, prompt));
      if (title) {
        return NextResponse.json({ title, source: provider.name });
      }
      console.warn(`[session-title] ${provider.name} returned an empty title; trying next provider`);
    } catch (error) {
      // Falls through to the next provider. Logged rather than swallowed so a
      // silently-dead key shows up in the server logs instead of only as a
      // wall of generic session names.
      console.warn(`[session-title] ${provider.name} failed; trying next provider.`, error);
    }
  }

  return NextResponse.json({ title: FALLBACK_TITLE, source: 'all-providers-failed' });
}
