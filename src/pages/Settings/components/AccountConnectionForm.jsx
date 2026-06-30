import React from 'react';

const CATEGORY_OPTIONS = [
  'Brand',
  'Entertainment',
  'Sports',
  'Fashion',
  'Food & Beverage',
  'Education',
  'Technology',
  'Lifestyle',
  'Travel',
  'Health & Fitness',
  'Arts',
  'Other',
];

function sanitizeHandle(value) {
  return String(value || '').replace(/^@+/, '').replace(/\s+/g, '_');
}

export default function AccountConnectionForm({
  platform,
  value,
  onChange,
  onSubmit,
  onBack,
  submitting = false,
  submitLabel = 'Connect Account',
}) {
  const profileTypes = Array.isArray(platform?.supported_profile_types) && platform.supported_profile_types.length > 0
    ? platform.supported_profile_types
    : ['Business', 'Creator', 'Personal'];

  const showCategory = ['instagram', 'facebook', 'linkedin'].includes(String(platform?.platform_key || '').toLowerCase());
  const previewUrl = String(value.profilePictureUrl || '').trim();

  return (
    <form className="connected-account-form" onSubmit={onSubmit}>
      <div className="connected-account-form-copy">
        <h4>{submitLabel === 'Save Changes' ? 'Update account details' : 'Tell us about your account'}</h4>
        <p>This mock setup is used to simulate a real connected social account inside SocialAI.</p>
      </div>

      <label className="connected-account-field">
        <span>Account Name</span>
        <input
          type="text"
          value={value.displayName}
          onChange={(event) => onChange('displayName', event.target.value)}
          placeholder="e.g. Nike Official"
          required
        />
        <small>Your public account or brand name.</small>
      </label>

      <label className="connected-account-field">
        <span>Username</span>
        <div className="connected-account-handle-input">
          <span>@</span>
          <input
            type="text"
            value={value.username}
            onChange={(event) => onChange('username', sanitizeHandle(event.target.value))}
            placeholder="yourusername"
            required
          />
        </div>
        <small>No spaces or @ symbol. Lowercase is recommended.</small>
      </label>

      <label className="connected-account-field">
        <span>Account Type</span>
        <div className="connected-account-profile-types">
          {profileTypes.map((item) => (
            <button
              key={item}
              type="button"
              className={value.profileType === item ? 'active' : ''}
              onClick={() => onChange('profileType', item)}
            >
              {item}
            </button>
          ))}
        </div>
      </label>

      {showCategory ? (
        <label className="connected-account-field">
          <span>Category</span>
          <select
            value={value.accountCategory}
            onChange={(event) => onChange('accountCategory', event.target.value)}
          >
            <option value="">Select a category</option>
            {CATEGORY_OPTIONS.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="connected-account-field">
        <span>Profile Picture URL</span>
        <div className="connected-account-avatar-input">
          <input
            type="url"
            value={value.profilePictureUrl}
            onChange={(event) => onChange('profilePictureUrl', event.target.value)}
            placeholder="https://..."
          />
          <span className="connected-account-avatar-preview">
            {previewUrl ? <img src={previewUrl} alt="Profile preview" /> : <span>{value.displayName?.[0] || value.username?.[0] || '?'}</span>}
          </span>
        </div>
      </label>

      <label className="connected-account-field">
        <span>Approximate Followers</span>
        <input
          type="number"
          min="0"
          value={value.followerCount}
          onChange={(event) => onChange('followerCount', event.target.value)}
          placeholder="10000"
        />
      </label>

      <div className="connected-account-form-actions">
        {onBack ? (
          <button type="button" className="connected-account-secondary" onClick={onBack}>
            Go back
          </button>
        ) : null}
        <button type="submit" className="connected-account-primary" disabled={submitting}>
          {submitting ? 'Saving...' : submitLabel}
        </button>
      </div>
    </form>
  );
}
