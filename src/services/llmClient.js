import { supabase } from './supabaseClient';

async function invoke(functionName, body) {
  const { data, error } = await supabase.functions.invoke(functionName, { body });
  if (error) throw error;
  return data;
}

export async function chat(messages, options = {}) {
  return invoke('ai-org-chat', {
    messages,
    ...options,
  });
}

export async function generateBrief(payload) {
  return invoke('ai-generate-brief', payload);
}

export async function checkBrandConsistency(payload) {
  return invoke('ai-brand-consistency-check', payload);
}

const llmClient = {
  chat,
  generateBrief,
  checkBrandConsistency,
};

export default llmClient;
