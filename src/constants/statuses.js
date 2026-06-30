// src/constants/statuses.js

// Canonical status values for generations across store, UI, and DB writes.
export const GENERATION_STATUS = {
  QUEUED: 'queued',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

// Canonical status values used by the posts publishing flow.
export const POST_STATUS = {
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  PUBLISHED: 'published',
  FAILED: 'failed',
  PUBLISHING: 'publishing',
  ARCHIVED: 'archived',
};

export const PIPELINE_STATUS = {
  PENDING: 'pending',
  IN_REVIEW: 'in_review',
  REVISION_REQUESTED: 'revision_requested',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  WITHDRAWN: 'withdrawn',
  SCHEDULED: 'scheduled',
  PUBLISHED: 'published',
};

export const PIPELINE_STATUS_LABELS = {
  [PIPELINE_STATUS.PENDING]: 'Pending',
  [PIPELINE_STATUS.IN_REVIEW]: 'In Review',
  [PIPELINE_STATUS.REVISION_REQUESTED]: 'Revision Requested',
  [PIPELINE_STATUS.APPROVED]: 'Approved',
  [PIPELINE_STATUS.REJECTED]: 'Rejected',
  [PIPELINE_STATUS.WITHDRAWN]: 'Withdrawn',
  [PIPELINE_STATUS.SCHEDULED]: 'Scheduled',
  [PIPELINE_STATUS.PUBLISHED]: 'Published',
};

export const ORG_MEMBER_ROLE = {
  ORG_OWNER: 'org_owner',
  ORG_ADMIN: 'org_admin',
  EDITOR: 'editor',
  CONTRIBUTOR: 'contributor',
  REVIEWER: 'reviewer',
};

export const CREDIT_REQUEST_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  DENIED: 'denied',
  PARTIAL: 'partial',
};

// Shared labels for generation lifecycle UI.
export const GENERATION_STATUS_LABELS = {
  [GENERATION_STATUS.QUEUED]: 'Queued',
  [GENERATION_STATUS.PROCESSING]: 'Processing',
  [GENERATION_STATUS.COMPLETED]: 'Completed',
  [GENERATION_STATUS.FAILED]: 'Failed',
};

// Shared labels for post lifecycle UI.
export const POST_STATUS_LABELS = {
  [POST_STATUS.DRAFT]: 'Draft',
  [POST_STATUS.SCHEDULED]: 'Scheduled',
  [POST_STATUS.PUBLISHING]: 'Publishing',
  [POST_STATUS.PUBLISHED]: 'Published',
  [POST_STATUS.FAILED]: 'Failed',
  [POST_STATUS.ARCHIVED]: 'Archived',
};

// Shared notification copy for generation lifecycle updates.
export const GENERATION_NOTIFICATION_HEADLINES = {
  [GENERATION_STATUS.COMPLETED]: 'Generation completed',
  [GENERATION_STATUS.QUEUED]: 'Generation queued',
  [GENERATION_STATUS.PROCESSING]: 'Generation started',
  [GENERATION_STATUS.FAILED]: 'Generation failed',
};

// Shared notification copy for post lifecycle updates.
export const POST_NOTIFICATION_HEADLINES = {
  [POST_STATUS.PUBLISHED]: 'Post published',
  [POST_STATUS.SCHEDULED]: 'Post scheduled',
  [POST_STATUS.FAILED]: 'Post publishing failed',
};

// Complaint statuses
export const COMPLAINT_STATUS = {
  SUBMITTED: 'submitted',
  UNDER_REVIEW: 'under_review',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
};

// User-facing complaint status labels
export const COMPLAINT_STATUS_LABEL = {
  [COMPLAINT_STATUS.SUBMITTED]: 'Submitted',
  [COMPLAINT_STATUS.UNDER_REVIEW]: 'Under Review',
  [COMPLAINT_STATUS.RESOLVED]: 'Resolved',
  [COMPLAINT_STATUS.CLOSED]: 'Closed',
};

// User-facing complaint status descriptions
export const COMPLAINT_STATUS_DESCRIPTION = {
  [COMPLAINT_STATUS.SUBMITTED]: "We've received your report and it's in the queue.",
  [COMPLAINT_STATUS.UNDER_REVIEW]: 'Our team is actively looking into this.',
  [COMPLAINT_STATUS.RESOLVED]: 'This issue has been fixed or addressed.',
  [COMPLAINT_STATUS.CLOSED]: 'This ticket has been closed.',
};

// Risk levels
export const RISK_LEVEL = {
  NONE: 'none',
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  VERY_HIGH: 'very_high',
};

export const RISK_LEVEL_LABEL = {
  [RISK_LEVEL.NONE]: 'None',
  [RISK_LEVEL.LOW]: 'Low',
  [RISK_LEVEL.MEDIUM]: 'Medium',
  [RISK_LEVEL.HIGH]: 'High',
  [RISK_LEVEL.VERY_HIGH]: 'Very High',
  critical: 'Critical',
};

// Admin notification types
export const ADMIN_NOTIFICATION_TYPE = {
  RISK_ALERT: 'risk_alert',
  COMPLAINT_SUBMITTED: 'complaint_submitted',
  COMPLAINT_STALE: 'complaint_stale',
  MODERATION_BACKLOG: 'moderation_backlog',
  USER_SIGNUP_SPIKE: 'user_signup_spike',
  DELETION_REQUESTED: 'deletion_requested',
  ADMIN_ACTION_FAILED: 'admin_action_failed',
  PUBLISHING_WORKER_STALLED: 'publishing_worker_stalled',
  SCOPE_DRIFT_DETECTED: 'scope_drift_detected',
  CONTENT_AUTO_FLAGGED: 'content_auto_flagged',
  ORG_CREATED: 'org_created',
  SYSTEM: 'system',
};

// User notification types
export const USER_NOTIFICATION_TYPE = {
  ADMIN_MESSAGE: 'admin_message',
  COMPLAINT_RESOLVED: 'complaint_resolved',
  SYSTEM: 'system',
};

// Complaint categories
export const COMPLAINT_CATEGORY = {
  GENERATION: 'generation',
  PUBLISHING: 'publishing',
  SCHEDULING: 'scheduling',
  ACCOUNT: 'account',
  BILLING: 'billing',
  PLATFORM_CONNECTION: 'platform_connection',
  OTHER: 'other',
};

export const COMPLAINT_CATEGORY_LABEL = {
  [COMPLAINT_CATEGORY.GENERATION]: 'Content Generation',
  [COMPLAINT_CATEGORY.PUBLISHING]: 'Publishing',
  [COMPLAINT_CATEGORY.SCHEDULING]: 'Scheduling & Calendar',
  [COMPLAINT_CATEGORY.ACCOUNT]: 'Account & Settings',
  [COMPLAINT_CATEGORY.BILLING]: 'Credits & Billing',
  [COMPLAINT_CATEGORY.PLATFORM_CONNECTION]: 'Platform Connections',
  [COMPLAINT_CATEGORY.OTHER]: 'Other',
};
