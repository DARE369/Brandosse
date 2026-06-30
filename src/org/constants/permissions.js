export const ORG_PERMISSION_GROUPS = [
  {
    key: 'publishing',
    title: 'Publishing & Scheduling',
    description: 'Control who can publish content and move approved work onto the calendar.',
    fields: [
      {
        key: 'can_publish',
        label: 'Can publish content',
        description: 'Allows the member to publish or schedule approved content.',
        type: 'boolean',
      },
      {
        key: 'publish_requires_final_approval',
        label: 'Require final approval before publishing',
        description: 'Keeps publishing gated behind a final approval check.',
        type: 'boolean',
        dependsOn: 'can_publish',
      },
      {
        key: 'can_schedule',
        label: 'Can schedule content',
        description: 'Allows the member to place approved content onto the shared calendar.',
        type: 'boolean',
      },
    ],
  },
  {
    key: 'library',
    title: 'Library Management',
    description: 'Manage the shared asset library and approvals.',
    fields: [
      {
        key: 'can_manage_library',
        label: 'Can manage library',
        description: 'Allows uploads, edits, tagging, and organization of shared assets.',
        type: 'boolean',
      },
      {
        key: 'can_approve_library_uploads',
        label: 'Can approve library uploads',
        description: 'Allows approval of pending shared library uploads.',
        type: 'boolean',
      },
    ],
  },
  {
    key: 'tasks',
    title: 'Task Management',
    description: 'Create, assign, and move work across the org task board.',
    fields: [
      {
        key: 'can_manage_tasks',
        label: 'Can manage tasks',
        description: 'Allows the member to create tasks, edit task details, and update task statuses.',
        type: 'boolean',
      },
    ],
  },
  {
    key: 'collaboration',
    title: 'Collaboration & Channels',
    description: 'Manage team collaboration surfaces inside the org workspace.',
    fields: [
      {
        key: 'can_create_channels',
        label: 'Can create channels',
        description: 'Allows creation of shared communication channels in the common room.',
        type: 'boolean',
      },
    ],
  },
  {
    key: 'organization',
    title: 'Organization Admin',
    description: 'Invite members and manage workspace access.',
    fields: [
      {
        key: 'can_invite_members',
        label: 'Can invite members',
        description: 'Allows the member to invite new collaborators into the organization.',
        type: 'boolean',
      },
    ],
  },
  {
    key: 'credits',
    title: 'Credits',
    description: 'Control monthly credit allocation for AI usage.',
    fields: [
      {
        key: 'monthly_credit_limit',
        label: 'Monthly credit limit',
        description: 'Leave empty for no personal cap. Set 0 to block AI usage entirely.',
        type: 'number',
      },
    ],
  },
];

export const ORG_ROLE_LABELS = {
  org_owner: 'Org Owner',
  org_admin: 'Org Admin',
  editor: 'Editor',
  contributor: 'Contributor',
  reviewer: 'Reviewer',
  member: 'Member',
};

export const SYSTEM_ROLE_ORDER = ['org_owner', 'org_admin', 'editor', 'contributor', 'reviewer'];

export function getPermissionField(fieldKey) {
  for (const group of ORG_PERMISSION_GROUPS) {
    const match = group.fields.find((field) => field.key === fieldKey);
    if (match) return match;
  }

  return null;
}

export function countEnabledPermissions(permissions = {}) {
  return ORG_PERMISSION_GROUPS.reduce((count, group) => (
    count + group.fields.reduce((groupCount, field) => {
      if (field.type !== 'boolean') return groupCount;
      return permissions?.[field.key] ? groupCount + 1 : groupCount;
    }, 0)
  ), 0);
}

export function summarizePermissions(permissions = {}) {
  return ORG_PERMISSION_GROUPS.flatMap((group) => (
    group.fields
      .filter((field) => field.type === 'boolean' && permissions?.[field.key])
      .map((field) => field.label)
  ));
}
