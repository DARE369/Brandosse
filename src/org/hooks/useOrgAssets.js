import { useEffect, useState } from 'react';
import { fetchOrgAssetFolders, fetchOrgAssets } from '../services/assetLibraryService';
import { useOrgContext } from './useOrgContext';

export function useOrgAssets(options = {}) {
  const { organizationId, brandProjectId } = useOrgContext();
  const [assets, setAssets] = useState([]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      const [assetData, folderData] = await Promise.all([
        fetchOrgAssets({
          organizationId,
          brandProjectId,
          includeArchived: Boolean(options.includeArchived),
        }),
        fetchOrgAssetFolders({
          organizationId,
          brandProjectId,
        }),
      ]);

      if (cancelled) return;

      const visibleFolderIds = new Set(folderData.map((folder) => folder.id));
      setFolders(folderData);
      setAssets(assetData.filter((asset) => !asset.folder_id || visibleFolderIds.has(asset.folder_id)));
      setLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [brandProjectId, options.includeArchived, organizationId]);

  return {
    assets,
    folders,
    loading,
    refresh: async () => {
      const [assetData, folderData] = await Promise.all([
        fetchOrgAssets({
          organizationId,
          brandProjectId,
          includeArchived: Boolean(options.includeArchived),
        }),
        fetchOrgAssetFolders({
          organizationId,
          brandProjectId,
        }),
      ]);

      const visibleFolderIds = new Set(folderData.map((folder) => folder.id));
      setFolders(folderData);
      setAssets(assetData.filter((asset) => !asset.folder_id || visibleFolderIds.has(asset.folder_id)));
    },
  };
}

export default useOrgAssets;
