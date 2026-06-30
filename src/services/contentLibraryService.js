import { supabase } from './supabaseClient';

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeLibraryPostPayload(rows = []) {
  const seenPostIds = new Set();

  return safeArray(rows)
    .map((row) => ({
      user_id: row?.user_id || null,
      post_id: row?.id || row?.post_id || null,
      item_type: 'post',
    }))
    .filter((row) => row.user_id && row.post_id)
    .filter((row) => {
      if (seenPostIds.has(row.post_id)) return false;
      seenPostIds.add(row.post_id);
      return true;
    });
}

export async function ensureLibraryRowsForPosts(rows = []) {
  const payload = normalizeLibraryPostPayload(rows);
  if (payload.length === 0) return;

  const postIds = payload.map((row) => row.post_id);

  const { data: existingRows, error: existingError } = await supabase
    .from('content_library_items')
    .select('post_id')
    .in('post_id', postIds);

  if (existingError) {
    if (existingError.code === '42P01') return;
    throw existingError;
  }

  const existingPostIds = new Set(
    safeArray(existingRows)
      .map((row) => row?.post_id)
      .filter(Boolean),
  );

  const rowsToInsert = payload.filter((row) => !existingPostIds.has(row.post_id));
  if (rowsToInsert.length === 0) return;

  const { error: insertError } = await supabase
    .from('content_library_items')
    .insert(rowsToInsert);

  if (insertError && insertError.code !== '42P01' && insertError.code !== '23505') {
    throw insertError;
  }
}
