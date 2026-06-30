// import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
// import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// const corsHeaders = {
//   'Access-Control-Allow-Origin': '*',
//   'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
// }

// serve(async (req: Request) => {
//   if (req.method === 'OPTIONS') {
//     return new Response('ok', { headers: corsHeaders })
//   }

//   try {
//     const supabase = createClient(
//       Deno.env.get('SUPABASE_URL') ?? '',
//       Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
//     )

//     const { prompt, user_id, media_type, style_preset } = await req.json()

//     if (!prompt) throw new Error('No prompt provided')

//     const geminiKey = Deno.env.get('GEMINI_API_KEY')
//     if (!geminiKey) throw new Error('GEMINI_API_KEY is missing in Supabase Secrets')

//     // FIX: Using specific version 'gemini-1.5-flash-001' to avoid "not found" errors
//     const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-001:generateContent?key=${geminiKey}`
    
//     const systemInstruction = `You are a creative social media assistant. 
//     Style: ${style_preset || 'Default'}. 
//     Platform Focus: Instagram, TikTok, LinkedIn.
//     Task: Create a catchy caption and 5-10 relevant hashtags.`

//     const response = await fetch(url, {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({
//         contents: [{
//           parts: [{ text: `${systemInstruction}\n\nUser Request: ${prompt}` }]
//         }]
//       })
//     })

//     if (!response.ok) {
//       const errData = await response.json()
//       throw new Error(`Gemini API Error: ${errData.error?.message || response.statusText}`)
//     }

//     const geminiData = await response.json()
//     const resultText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "No content generated"

//     const { data, error } = await supabase
//       .from('generations')
//       .insert([
//         {
//           user_id: user_id,
//           prompt: prompt,
//           storage_path: null, 
//           media_type: media_type || 'text',
//           status: 'completed',
//           metadata: { 
//             result: resultText, 
//             style: style_preset,
//             ai_provider: 'gemini-1.5-flash-001'
//           }
//         }
//       ])
//       .select()
//       .single()

//     if (error) throw error

//     return new Response(JSON.stringify(data), {
//       headers: { ...corsHeaders, 'Content-Type': 'application/json' },
//       status: 200,
//     })

//   } catch (error: any) {
//     console.error("Edge Function Error:", error)
//     return new Response(JSON.stringify({ error: error.message || "Unknown error" }), {
//       headers: { ...corsHeaders, 'Content-Type': 'application/json' },
//       status: 400,
//     })
//   }
// })









import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  // 1. Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 2. Initialize Supabase Client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { prompt, user_id, media_type, style_preset } = await req.json()

    if (!prompt) throw new Error('No prompt provided')

    // ---------------------------------------------------------
    // MOCK LOGIC START (Replacing the Real API Call)
    // ---------------------------------------------------------
    
    console.log(`Simulating AI generation for: ${prompt} (${media_type})`)

    // Simulate 1.5 seconds of "thinking" time
    await new Promise((resolve) => setTimeout(resolve, 1500));

    let resultText = "";
    let storagePath = null;

    if (media_type === 'image') {
      // Return a random professional image from Unsplash
      storagePath = `https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1000&auto=format&fit=crop`;
      resultText = "Image generated successfully based on prompt: " + prompt;
    } else if (media_type === 'video') {
      // Return a sample video (Big Buck Bunny or similar short clip)
      storagePath = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4";
      resultText = "Video generated successfully based on prompt: " + prompt;
    } else {
      // Default to Text
      resultText = `✨ Here is a simulated caption for: "${prompt}"\n\n🚀 Embrace the journey, not just the destination! #Growth #${style_preset || 'Motivation'}`;
    }

    // ---------------------------------------------------------
    // MOCK LOGIC END
    // ---------------------------------------------------------

    // 3. Save to Database (Crucial for UI Update)
    const { data, error } = await supabase
      .from('generations')
      .insert([
        {
          user_id: user_id,
          prompt: prompt,
          storage_path: storagePath, // Now populate this for images/video
          media_type: media_type || 'text',
          status: 'completed',
          metadata: { 
            result: resultText, 
            style: style_preset,
            ai_provider: 'mock-mode'
          }
        }
      ])
      .select()
      .single()

    if (error) throw error

    // 4. Return Success
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error: any) {
    console.error("Edge Function Error:", error)
    return new Response(JSON.stringify({ error: error.message || "Unknown error" }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})