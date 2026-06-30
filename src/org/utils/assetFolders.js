export const DEFAULT_FOLDER_PATH = '/';

export const FOLDER_COLOR_SWATCHES = [
  '#6366F1',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#3B82F6',
  '#8B5CF6',
  '#EC4899',
  '#6B7280',
];

export function normalizeFolderPath(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return DEFAULT_FOLDER_PATH;

  const withRoot = normalized.startsWith('/') ? normalized : `/${normalized}`;
  const compact = withRoot.replace(/\/{2,}/g, '/');
  if (compact.length > 1 && compact.endsWith('/')) {
    return compact.slice(0, -1);
  }
  return compact || DEFAULT_FOLDER_PATH;
}

export function normalizeFolderName(value) {
  return String(value || '')
    .replace(/\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildFolderLookup(folders = []) {
  return new Map((Array.isArray(folders) ? folders : []).map((folder) => [folder.id, folder]));
}

function compareFolders(left, right) {
  if (Boolean(left?.is_system) !== Boolean(right?.is_system)) {
    return left?.is_system ? -1 : 1;
  }

  const leftName = String(left?.name || left?.folder_path || '').toLowerCase();
  const rightName = String(right?.name || right?.folder_path || '').toLowerCase();
  return leftName.localeCompare(rightName);
}

export function buildFolderTree(folders = []) {
  const source = Array.isArray(folders) ? folders : [];
  const byId = new Map(source.map((folder) => [folder.id, { ...folder, children: [] }]));
  const roots = [];

  byId.forEach((folder) => {
    if (folder.parent_folder_id && byId.has(folder.parent_folder_id)) {
      byId.get(folder.parent_folder_id).children.push(folder);
      return;
    }
    roots.push(folder);
  });

  const sortTree = (nodes) => {
    nodes.sort(compareFolders);
    nodes.forEach((node) => sortTree(node.children));
    return nodes;
  };

  return sortTree(roots);
}

export function getFolderDepth(folderPath) {
  const normalized = normalizeFolderPath(folderPath);
  if (normalized === DEFAULT_FOLDER_PATH) return 0;
  return normalized.split('/').filter(Boolean).length - 1;
}

export function getFolderBreadcrumbs(folder, folderLookup) {
  if (!folder) return [];

  const breadcrumbs = [];
  const seen = new Set();
  let current = folder;

  while (current?.id && !seen.has(current.id)) {
    breadcrumbs.unshift(current);
    seen.add(current.id);
    current = current.parent_folder_id ? folderLookup.get(current.parent_folder_id) || null : null;
  }

  return breadcrumbs;
}

export function formatFolderBreadcrumb(folderPath) {
  const normalized = normalizeFolderPath(folderPath);
  if (normalized === DEFAULT_FOLDER_PATH) return 'Root';
  return normalized.split('/').filter(Boolean).join(' / ');
}

export function getAssetFolderPath(asset, folderLookup) {
  if (asset?.folder_id && folderLookup?.has(asset.folder_id)) {
    return normalizeFolderPath(folderLookup.get(asset.folder_id)?.folder_path);
  }
  return normalizeFolderPath(asset?.folder_path);
}
