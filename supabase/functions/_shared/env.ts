type ProcessEnv = {
  process?: {
    env?: Record<string, string | undefined>;
  };
};

export function readEnv(name: string, required = true): string {
  const processEnv = (globalThis as ProcessEnv).process?.env?.[name];
  const denoEnv = typeof Deno !== "undefined" ? Deno.env.get(name) : undefined;
  const value = processEnv ?? denoEnv ?? "";

  if (required && !value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

export function readOptionalEnv(name: string): string | null {
  const value = readEnv(name, false);
  return value || null;
}
