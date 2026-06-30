// supabase/functions/webhook-handler/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

serve(async (req) => {
  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '' // Must use Service Role to update without user session
  )

  const body = await req.json();
  const { id, status, output } = body;

  console.log(`Webhook received for ${id}: ${status}`);

  if (status === 'succeeded') {
    // Output is usually an array of URLs (e.g. ["https://replicate.com/out.png"])
    const assetUrl = Array.isArray(output) ? output[0] : output;

    // Optional: You could download 'assetUrl' here and upload to your own Supabase Storage
    // so you don't rely on Replicate's temporary links.
    // For MVP, we will save the Replicate URL directly.

    // Update the generation record
    // We find the record by the replicate_id we saved in metadata
    // But Replicate doesn't send back our DB ID. We must query by metadata.

    // 1. Find the generation with this replicate_id
    // This requires your 'generations' table to have a way to search metadata or store replicate_id in a column.
    // simpler: store replicate_id in a dedicated column or cast metadata.
    
    // Better approach: In start-generation, store replicate_id in metadata.
    // Querying JSONB in Supabase:
    const { data: records } = await supabaseClient
        .from('generations')
        .select('id')
        .contains('metadata', { replicate_id: id });

    if (records && records.length > 0) {
        const generationId = records[0].id;
        
        await supabaseClient
            .from('generations')
            .update({
                status: 'completed',
                storage_path: assetUrl
            })
            .eq('id', generationId);
            
        console.log(`Updated generation ${generationId}`);
    }
  } else if (status === 'failed') {
      // Handle failure
      // ... query logic same as above ...
      // update status: 'failed'
  }

  return new Response('ok');
})