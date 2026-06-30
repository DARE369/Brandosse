import React from 'react';
import PlatformIcon from '../Shared/PlatformIcon';

function fallbackMedia(platform) {
  if (platform === 'tiktok') return 'TikTok preview';
  return 'Media preview unavailable';
}

function renderMedia(attempt) {
  if (!attempt?.mediaUrl) {
    return <div className="mock-publish-media-fallback">{fallbackMedia(attempt?.platform)}</div>;
  }

  if (String(attempt.mediaType || '').toLowerCase() === 'video') {
    return <video src={attempt.mediaUrl} muted controls={false} playsInline />;
  }

  return <img src={attempt.mediaUrl} alt="Published content preview" />;
}

export default function PostPreviewCard({ attempt }) {
  const platform = String(attempt?.platform || '').trim().toLowerCase() || 'instagram';
  const displayName = attempt?.accountDisplayName || attempt?.accountUsername || 'SocialAI';
  const username = attempt?.accountUsername ? `@${String(attempt.accountUsername).replace(/^@+/, '')}` : '@socialai';
  const caption = String(attempt?.caption || '').trim() || 'No caption provided.';

  return (
    <article className={`mock-publish-preview-card preview-${platform}`.trim()}>
      <header className="mock-publish-preview-header">
        <div className="mock-publish-preview-identity">
          <span className="mock-publish-preview-avatar">
            {attempt?.profilePictureUrl ? (
              <img src={attempt.profilePictureUrl} alt={displayName} />
            ) : (
              <PlatformIcon platform={platform} size="sm" />
            )}
          </span>
          <div>
            <strong>{displayName}</strong>
            <span>{username}</span>
          </div>
        </div>
        <PlatformIcon platform={platform} size="sm" showLabel />
      </header>

      <div className={`mock-publish-preview-media media-${String(attempt?.mediaType || 'image').toLowerCase()}`.trim()}>
        {renderMedia(attempt)}
      </div>

      <div className="mock-publish-preview-body">
        <p>{caption}</p>
      </div>
    </article>
  );
}
