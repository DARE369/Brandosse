import { supabase } from '../../services/supabaseClient';

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function isMissingRelationError(error) {
  if (!error) return false;
  const message = `${error.code || ''} ${error.message || ''}`.toLowerCase();
  return (
    message.includes('does not exist')
    || message.includes('relation')
    || message.includes('column')
    || message.includes('pgrst')
  );
}

function normalizeEdgeFunctionError(error, functionName) {
  const message = String(error?.message || '').toLowerCase();
  const status = error?.context?.status || error?.response?.status || null;

  if (error?.name === 'FunctionsFetchError' || message.includes('failed to send a request')) {
    return new Error(
      `Could not reach the \`${functionName}\` Edge Function. This usually means it is not deployed to the current Supabase project, crashed before responding to OPTIONS, or this app is pointed at the wrong Supabase environment.`,
    );
  }

  if (status === 404) {
    return new Error(`The \`${functionName}\` Edge Function is not deployed to this Supabase project.`);
  }

  if (status === 401 || status === 403) {
    return new Error(`You do not have permission to use the \`${functionName}\` Edge Function.`);
  }

  if (error?.name === 'FunctionsHttpError') {
    return new Error(`The \`${functionName}\` Edge Function returned an unexpected HTTP error.`);
  }

  return error;
}

export async function fetchOrgBrandKit({ organizationId, brandProjectId }) {
  if (!organizationId || !brandProjectId) return { brandKit: null, editors: [] };

  const { data: brandKit, error } = await supabase
    .from('org_brand_kits')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('brand_project_id', brandProjectId)
    .maybeSingle();

  if (error) {
    if (!isMissingRelationError(error)) {
      throw error;
    }
    return { brandKit: null, editors: [] };
  }

  if (!brandKit?.id) {
    return { brandKit: null, editors: [] };
  }

  const { data: editors, error: editorError } = await supabase
    .from('org_brand_kit_editors')
    .select('id, brand_kit_id, user_id, granted_by, granted_at')
    .eq('brand_kit_id', brandKit.id)
    .order('granted_at', { ascending: true });

  if (editorError) {
    if (!isMissingRelationError(editorError)) {
      throw editorError;
    }
    return { brandKit, editors: [] };
  }

  return {
    brandKit,
    editors: safeArray(editors),
  };
}

export async function upsertOrgBrandKit({
  organizationId,
  brandProjectId,
  fields,
}) {
  const { data, error } = await supabase.functions.invoke('org-brand-kit-upsert', {
    body: {
      organization_id: organizationId,
      brand_project_id: brandProjectId,
      fields,
    },
  });

  if (error) throw normalizeEdgeFunctionError(error, 'org-brand-kit-upsert');
  if (data?.error) {
    throw new Error(data.error);
  }

  return data?.brand_kit || null;
}

export async function syncOrgBrandKitEditors({
  brandKitId,
  editorUserIds = [],
  grantedBy,
}) {
  if (!brandKitId) {
    throw new Error('A brand kit is required before editor access can be updated.');
  }

  const normalizedUserIds = [...new Set(safeArray(editorUserIds).filter(Boolean))];

  const { data: existingRows, error: existingError } = await supabase
    .from('org_brand_kit_editors')
    .select('id, user_id')
    .eq('brand_kit_id', brandKitId);

  if (existingError) throw existingError;

  const existing = safeArray(existingRows);
  const existingUserIds = new Set(existing.map((row) => row.user_id));
  const nextUserIds = new Set(normalizedUserIds);

  const rowsToDelete = existing
    .filter((row) => !nextUserIds.has(row.user_id))
    .map((row) => row.id);

  if (rowsToDelete.length > 0) {
    const { error: deleteError } = await supabase
      .from('org_brand_kit_editors')
      .delete()
      .in('id', rowsToDelete);

    if (deleteError) throw deleteError;
  }

  const rowsToInsert = normalizedUserIds
    .filter((userId) => !existingUserIds.has(userId))
    .map((userId) => ({
      brand_kit_id: brandKitId,
      user_id: userId,
      granted_by: grantedBy,
    }));

  if (rowsToInsert.length > 0) {
    const { error: insertError } = await supabase
      .from('org_brand_kit_editors')
      .insert(rowsToInsert);

    if (insertError) throw insertError;
  }

  return true;
}
