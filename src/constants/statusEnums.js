// src/constants/statusEnums.js

import { GENERATION_STATUS, POST_STATUS } from './statuses';

export { GENERATION_STATUS, POST_STATUS };

/** Canonical status for `brand_kit` */
export const BRAND_KIT_STATUS = {
  CONFIGURED: 'configured',
  PARTIAL:    'partial',
  MISSING:    'missing',
};

/** Canonical status for `brand_assets` */
export const ASSET_STATUS = {
  UPLOADING:  'uploading',
  PROCESSING: 'processing',
  READY:      'ready',
  FAILED:     'failed',
};
