import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
serve(async (req) => {
  const url = new URL(req.url);
  const target = url.searchParams.get("url") || "";
  const key = Deno.env.get("FAL_API_KEY") || "";
  const method = url.searchParams.get("method") || "GET";
  const res = await fetch(target, { method, headers: { Authorization: `Key ${key}` }, redirect: "manual" });
  const headers: Record<string,string> = {};
  res.headers.forEach((v,k) => headers[k]=v);
  let body = "";
  try { body = await res.text(); } catch (_e) { /* ignore */ }
  return new Response(JSON.stringify({ status: res.status, type: res.type, headers, body: body.slice(0,500) }, null, 2), { headers: { "Content-Type": "application/json" } });
});
