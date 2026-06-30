// src/lib/video-engine/auth-helpers.ts
// Authentication utilities for API route handlers.
// Call getAuthenticatedUser(request) as the first operation in protected routes.

import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

type AuthResult = {
  user: User | null;
  supabase: SupabaseClient;
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const UNAUTHORIZED_RESPONSE = NextResponse.json(
  { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
  { status: 401 },
);

function createAuthClient(): SupabaseClient {
  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  }

  if (!anonKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is not set');
  }

  return createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function decodeMaybeBase64Cookie(value: string): string {
  const decoded = decodeURIComponent(value);
  if (!decoded.startsWith('base64-')) return decoded;

  try {
    return atob(decoded.slice('base64-'.length));
  } catch {
    return decoded;
  }
}

function getTokenFromCookieValue(value: string): string | null {
  try {
    const parsed = JSON.parse(decodeMaybeBase64Cookie(value));

    if (Array.isArray(parsed) && typeof parsed[0] === 'string') {
      return parsed[0];
    }

    if (typeof parsed?.access_token === 'string') {
      return parsed.access_token;
    }

    if (typeof parsed?.currentSession?.access_token === 'string') {
      return parsed.currentSession.access_token;
    }
  } catch {
    return null;
  }

  return null;
}

function getAccessToken(request?: NextRequest): string | null {
  const authHeader = request?.headers.get('authorization');
  if (authHeader?.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice('bearer '.length).trim();
  }

  const directCookie = request?.cookies.get('sb-access-token')?.value;
  if (directCookie) return directCookie;

  for (const cookie of request?.cookies.getAll() ?? []) {
    if (cookie.name.startsWith('sb-') && cookie.name.includes('auth-token')) {
      const token = getTokenFromCookieValue(cookie.value);
      if (token) return token;
    }
  }

  return null;
}

export async function getAuthenticatedUser(request?: NextRequest): Promise<AuthResult> {
  const supabase = createAuthClient();
  const accessToken = getAccessToken(request);

  if (!accessToken) {
    return { user: null, supabase };
  }

  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(accessToken);

    if (error || !user) {
      return { user: null, supabase };
    }

    return { user, supabase };
  } catch {
    return { user: null, supabase };
  }
}

export function errorResponse(
  message: string,
  code: string,
  status: number,
): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}

export function successResponse(
  data: Record<string, unknown>,
  status = 200,
): NextResponse {
  return NextResponse.json({ success: true, ...data }, { status });
}
