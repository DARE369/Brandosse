const processEnv = typeof process !== "undefined" ? process.env ?? {} : {};

function readPublicEnv(value) {
  return typeof process !== "undefined" ? value : undefined;
}

// Next only exposes client env values reliably when they are referenced
// explicitly. Keep this map in sync with browser-safe public config only.
const clientEnv = {
  NEXT_PUBLIC_SUPABASE_URL: readPublicEnv(process.env.NEXT_PUBLIC_SUPABASE_URL),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: readPublicEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  NEXT_PUBLIC_APP_URL: readPublicEnv(process.env.NEXT_PUBLIC_APP_URL),
  NEXT_PUBLIC_ENABLE_PROMPT_SUGGESTIONS_EDGE_IN_DEV:
    readPublicEnv(process.env.NEXT_PUBLIC_ENABLE_PROMPT_SUGGESTIONS_EDGE_IN_DEV),
};

const publicEnvNames = new Set(Object.keys(clientEnv));

function getNextPublicName(name) {
  return name.startsWith("NEXT_PUBLIC_") ? name : `NEXT_PUBLIC_${name}`;
}

export function getRuntimeEnvValue(name, fallback = "") {
  const nextPublicName = getNextPublicName(name);
  const directPublicValue = publicEnvNames.has(name) ? clientEnv[name] : undefined;
  const aliasPublicValue = publicEnvNames.has(nextPublicName) ? clientEnv[nextPublicName] : undefined;

  return directPublicValue ?? aliasPublicValue ?? fallback;
}

export function isRuntimeDev() {
  return processEnv.NODE_ENV !== "production";
}
