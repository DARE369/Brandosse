// Throwaway QA script — direct DB read via service role key, bypasses RLS.
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnv(file) {
  const text = fs.readFileSync(file, 'utf8');
  const out = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    out[m[1]] = val;
  }
  return out;
}

const env = loadEnv(path.join(__dirname, '..', '.env.local'));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const ids = [
  '53be1c41-4ecf-46ed-904e-a783cdcaf2f8', // published fixture
  'bf4f6965-6048-4247-bb07-d590545bbb76', // failed fixture
  '7d6e24fb-2e89-4108-a6ce-05c132ad9e66', // draft fixture
];

(async () => {
  // also grab the d2f4ebb0 / 9fd1d18d prefix rows
  const { data: prefixRows, error: prefixErr } = await supabase
    .from('posts')
    .select('id,status,scheduled_at,platform,caption,archived_at')
    .order('scheduled_at', { ascending: true });

  const { data, error } = await supabase
    .from('posts')
    .select('id,status,scheduled_at,platform,caption,archived_at,updated_at')
    .in('id', ids);

  if (error) console.error('ERROR (fixtures):', error);
  if (prefixErr) console.error('ERROR (prefix rows):', prefixErr);

  console.log('--- FIXTURE ROWS ---');
  console.log(JSON.stringify(data, null, 2));
  console.log('--- ALL POSTS ROWS (sorted by scheduled_at) ---');
  console.log(JSON.stringify((prefixRows || []).filter(r => r.id.startsWith('d2f4ebb0') || r.id.startsWith('9fd1d18d')), null, 2));
})();
