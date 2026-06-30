import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // 1. Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 2. Setup Clients
    // Client A: Auth Context (Used ONLY to verify WHO the user is)
    const authHeader = req.headers.get('Authorization')!
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    // Client B: Admin Context (Used to read/write DB ignoring RLS)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 3. Verify User
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser()
    if (authError || !user) throw new Error('Unauthorized')

    // 4. Parse Body
    const { prompt, media_type, batch_size = 1, metadata } = await req.json()

    // 5. Check & Deduct Credits (Using ADMIN client)
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('credits')
      .eq('id', user.id)
      .single()

    if (!profile || (profile.credits || 0) < batch_size) {
       throw new Error('402: Insufficient credits')
    }

    // Deduct credits
    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({ credits: (profile.credits || 0) - batch_size })
      .eq('id', user.id)

    if (updateError) throw new Error(`Failed to deduct credits: ${updateError.message}`)

    // --- LOGIC SPLIT ---

    if (media_type === 'image') {
      // === SYNC PATH (Pollinations - Free) ===
      const generations = []
      
      for (let i = 0; i < batch_size; i++) {
        const seed = Math.floor(Math.random() * 100000);
        const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?seed=${seed}&width=1024&height=1024&nologo=true`;

        // Fetch image
        const imageRes = await fetch(imageUrl);
        if (!imageRes.ok) throw new Error('Failed to fetch image from provider');
        const imageBlob = await imageRes.blob();

        // Upload (Using ADMIN to ensure write access)
        const fileName = `${user.id}/${Date.now()}_${i}.jpg`;
        const { error: uploadError } = await supabaseAdmin
          .storage
          .from('generated_assets')
          .upload(fileName, imageBlob, { contentType: 'image/jpeg', upsert: true });

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabaseAdmin
          .storage
          .from('generated_assets')
          .getPublicUrl(fileName);

        // Insert Record (Using ADMIN)
        const { data: record, error: dbError } = await supabaseAdmin
          .from('generations')
          .insert({
            user_id: user.id,
            prompt: prompt,
            media_type: 'image',
            status: 'completed',
            storage_path: publicUrl,
            metadata: { ...metadata, provider: 'pollinations', seed }
          })
          .select()
          .single();
          
        if (dbError) throw dbError;
        generations.push(record);
      }

      return new Response(JSON.stringify(generations), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })

    } else if (media_type === 'video') {
      // === ASYNC PATH (Replicate) ===
      const REPLICATE_TOKEN = Deno.env.get('REPLICATE_API_TOKEN');
      if (!REPLICATE_TOKEN) throw new Error('Missing REPLICATE_API_TOKEN');

      // Call Replicate
      const response = await fetch("https://api.replicate.com/v1/predictions", {
        method: "POST",
        headers: {
          Authorization: `Token ${REPLICATE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          version: "3f0457e4619daac51203dedb472816f3afc54003e34626d327882a904f24253d", 
          input: {
            cond_aug: 0.02,
            decoding_t: 7,
            input_image: "https://replicate.delivery/pbxt/J1c.../rocket.png", // Example init
            video_length: "25_frames_with_svd_xt",
            sizing_strategy: "maintain_aspect_ratio",
            motion_bucket_id: 127,
            frames_per_second: 6
          },
          // Important: Ensure this matches your deployed function URL
          webhook: `${Deno.env.get('SUPABASE_URL')}/functions/v1/webhook-handler`,
          webhook_events_filter: ["completed"]
        }),
      });

      if (response.status !== 201) {
        const errText = await response.text();
        throw new Error(`Replicate Error: ${errText}`);
      }
      
      const prediction = await response.json();

      // Insert Record (Using ADMIN)
      const { data: record, error: dbError } = await supabaseAdmin
          .from('generations')
          .insert({
            user_id: user.id,
            prompt: prompt,
            media_type: 'video',
            status: 'processing',
            metadata: { ...metadata, provider: 'replicate', replicate_id: prediction.id }
          })
          .select()
          .single();

       if (dbError) throw dbError;

       return new Response(JSON.stringify(record), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

  } catch (error) {
    console.error("Function Error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: error.message.includes('402') ? 402 : 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})