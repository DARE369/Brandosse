// src/services/copyReviewPersistence.js
//
// Saving a copy review taken OUTSIDE the composer, bound to the app's supabase
// client. The logic — shared-column merge, updated_at concurrency check, and
// the refusals — lives in src/calendar/copyReviewPersistenceCore.js, where it is
// tested against an in-memory table. Read that file's header for the why.
import { supabase } from './supabaseClient';
import {
  saveAssetCopyReview as saveAssetCore,
  savePostCopyReview as savePostCore,
} from '../calendar/copyReviewPersistenceCore';

export {
  assetCopyInputs,
  postCopyInputs,
  readAssetCopyReview,
} from '../calendar/copyReviewPersistenceCore';

export const saveAssetCopyReview = (assetId, platform, scored, scoredInputs) => (
  saveAssetCore(supabase, assetId, platform, scored, scoredInputs)
);

export const savePostCopyReview = (postId, scored, scoredInputs) => (
  savePostCore(supabase, postId, scored, scoredInputs)
);
