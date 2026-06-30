import { getSupabaseFunctionUrl } from './supabaseConfig';

export const generateContent = async (prompt, user_id) => {
  const response = await fetch(
    getSupabaseFunctionUrl('generateContent'),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, user_id }),
    }
  );

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Generation failed");
  return data.result;
};
