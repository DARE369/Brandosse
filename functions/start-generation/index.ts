// functions/start-generation/index.ts
// Deno (Supabase Edge Function) - typescript
import { serve } from "std/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.");
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
    }

    const body = await req.json();
    const {
      user_id,
      media_type,
      prompt,
      parent_generation_id = null,
      metadata = {},
      mask_storage_path = null
    } = body;

    if (!user_id || !media_type || !prompt) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 });
    }

    // If parent supplied, fetch root_generation_id and check iteration count
    let rootId = null;
    if (parent_generation_id) {
      const parentRes = await supabaseAdmin
        .from("generations")
        .select("root_generation_id, id")
        .eq("id", parent_generation_id)
        .maybeSingle();

      if (parentRes.error) {
        console.error("Parent fetch error:", parentRes.error);
        return new Response(JSON.stringify({ error: "Parent generation not found" }), { status: 400 });
      }

      rootId = parentRes.data?.root_generation_id ?? parent_generation_id;

      const { countRes, error: countErr } = await (async () => {
        const q = await supabaseAdmin
          .from("generations")
          .select("id", { count: "exact", head: true })
          .eq("root_generation_id", rootId);
        return { countRes: q.count, error: q.error };
      })();

      if (countErr) {
        console.error("Count err:", countErr);
        return new Response(JSON.stringify({ error: "Unable to verify iteration count" }), { status: 500 });
      }

      if ((countRes ?? 0) >= 4) {
        return new Response(JSON.stringify({ error: "Iteration limit reached" }), { status: 403 });
      }
    }

    // Insert new generation record with status=processing
    const insertPayload: any = {
      user_id,
      media_type,
      prompt,
      metadata,
      parent_generation_id,
      root_generation_id: rootId, // if null, we will update to id after insert
      iteration_index: parent_generation_id ? (await computeIterationIndex(supabaseAdmin, parent_generation_id)) + 1 : 0,
      status: "processing",
      created_at: new Date().toISOString(),
    };

    const insertRes = await supabaseAdmin
      .from("generations")
      .insert([insertPayload])
      .select()
      .single();

    if (insertRes.error) {
      console.error("Insert error:", insertRes.error);
      return new Response(JSON.stringify({ error: "DB insert failed", details: insertRes.error }), { status: 500 });
    }

    const generation = insertRes.data;

    // If root_generation_id was null (this is a root generation), set root_generation_id = id
    if (!rootId) {
      const updateRes = await supabaseAdmin
        .from("generations")
        .update({ root_generation_id: generation.id })
        .eq("id", generation.id);
      if (updateRes.error) {
        console.warn("Failed to set root_generation_id:", updateRes.error);
      }
      generation.root_generation_id = generation.id;
    }

    // ------- STUB: Kick off AI provider job (replace with real provider call) -------
    // For now, return accepted and the new generation id. Later: call provider with webhook that hits /functions/handle-completion
    const job_id = `stub-job-${generation.id}`;

    // Return created generation id and job id to client so UI can subscribe to realtime updates
    return new Response(
      JSON.stringify({
        ok: true,
        job_id,
        generation_id: generation.id,
      }),
      { status: 201, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unhandled error in start-generation function:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 });
  }
});

// helper to compute iteration index from parent
async function computeIterationIndex(supabaseAdmin: any, parentId: string) {
  const parentRes = await supabaseAdmin.from("generations").select("iteration_index, root_generation_id").eq("id", parentId).single();
  if (parentRes.error) return 0;
  const parent = parentRes.data;
  const nextIndex = (parent?.iteration_index ?? 0) + 1;
  return nextIndex;
}
