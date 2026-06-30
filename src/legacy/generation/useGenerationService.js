/**
 * @deprecated LEGACY - do not add new callsites. Use src/services/generationPipeline.js.
 * Moved to src/legacy/generation during roadmap quarantine.
 */
import { useCallback, useState } from "react";
import { supabase } from "../../services/supabaseClient";

export default function useGenerationService() {
  const [generations, setGenerations] = useState([]);
  const [loading, setLoading] = useState(false);

  // --- FETCHING DATA ---
  const fetchGenerations = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from("generations")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (!error) setGenerations(data || []);
  }, []);

  // --- REALTIME SUBSCRIPTION ---
  const subscribeToGenerations = useCallback((onEvent) => {
    const channel = supabase
      .channel("public:generations")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "generations" },
        (payload) => {
          if (typeof onEvent === "function") onEvent(payload);
        }
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  // --- START GENERATION ---
  const startGeneration = useCallback(async (payload) => {
    // 1. Auth Check
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Please log in first.");

    // 2. Call Edge Function
    const { data, error } = await supabase.functions.invoke('start-generation', {
      body: payload
    });

    if (error) {
      // Parse detailed error from Edge Function if available
      let message = error.message;
      try {
        const body = JSON.parse(error.context?.body || "{}");
        if (body.error) message = body.error;
      } catch (e) {}
      throw new Error(message);
    }

    return { data };
  }, []);

  // --- ENHANCE PROMPT (Connected to Real API) ---
  const enhancePrompt = useCallback(async (currentPrompt) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Please log in.");

    const { data, error } = await supabase.functions.invoke('enhance-prompt', {
      body: { prompt: currentPrompt }
    });

    if (error) throw new Error(error.message);
    return data.enhancedPrompt; // Matches your Edge Function response
  }, []);

  // --- START MODIFICATION (Connected) ---
  const startModification = useCallback(async ({ parentGeneration, maskBlob, prompt, mode }) => {
    // 1. Upload the Mask Blob first
    const { data: { user } } = await supabase.auth.getUser();
    const fileName = `${user.id}/masks/${Date.now()}.png`;
    
    const { error: uploadError } = await supabase.storage
        .from('generated_assets') // Ensure this bucket exists in Supabase
        .upload(fileName, maskBlob);
        
    if (uploadError) throw new Error("Failed to upload mask: " + uploadError.message);

    // Get public URL of mask
    const { data: { publicUrl: maskUrl } } = supabase.storage
        .from('generated_assets')
        .getPublicUrl(fileName);

    // 2. Trigger Generation with new params
    return startGeneration({
        prompt: prompt,
        media_type: parentGeneration.media_type,
        metadata: {
            parent_id: parentGeneration.id,
            mask_url: maskUrl,
            mode: mode || 'inpainting'
        }
    });
  }, [startGeneration]);

  return {
    generations,
    loading,
    fetchGenerations,
    subscribeToGenerations,
    startGeneration,
    enhancePrompt,
    startModification
  };
}
