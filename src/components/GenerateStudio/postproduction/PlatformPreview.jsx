import React from 'react';
import { Image as ImageIcon } from 'lucide-react';
import PlatformIcon from '../../Shared/PlatformIcon';
import { PLATFORM_CAPTION_HINTS } from '../shared/constants';
import { normalizePlatform } from '../shared/helpers';

/* ─────────────────────────────────────────────────────────────────────────────
   PlatformPreview — social post mockup
   ───────────────────────────────────────────────────────────────────────────── */
export default function PlatformPreview({ account, mediaUrl, mediaType, title, caption, hashtags }) {
  const platform    = normalizePlatform(account?.platform);
  const accountName = account?.display_name || account?.account_name || account?.username || 'Your account';
  const hint        = PLATFORM_CAPTION_HINTS[platform] || PLATFORM_CAPTION_HINTS.instagram;
  const tagLine     = hashtags?.join(' ') || '';

  return (
    <article className="studio-platform-preview">
      <div className="studio-platform-preview__header">
        <div className="studio-platform-preview__avatar">
          <PlatformIcon platform={platform} size="sm" />
        </div>
        <div>
          <div className="studio-platform-preview__name">{accountName}</div>
          <div className="studio-platform-preview__hint">{hint}</div>
        </div>
      </div>

      <div className="studio-platform-preview__media">
        {mediaUrl
          ? mediaType === 'video'
            ? <video src={mediaUrl} muted />
            : <img src={mediaUrl} alt={`${platform} preview`} />
          : <div className="studio-platform-preview__media-empty"><ImageIcon size={24} /></div>}
      </div>

      <div className="studio-platform-preview__body">
        {platform === 'youtube' && title
          ? <p className="studio-platform-preview__caption" style={{ fontWeight: 700 }}>{title}</p>
          : null}
        <p className="studio-platform-preview__caption">
          {caption || 'Caption will appear here once the post is ready.'}
        </p>
        {tagLine && <p className="studio-platform-preview__tags">{tagLine}</p>}
      </div>
    </article>
  );
}
