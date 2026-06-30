import React from 'react';
import {
  Calendar,
  Check,
  FileText,
  Loader2,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import PlatformIcon from '../../Shared/PlatformIcon';
import DiscoveryScoreCard from './DiscoveryScoreCard';
import PlatformPreview from './PlatformPreview';
import { getAssetMetadata, getMediaUrl, normalizePlatform } from '../shared/helpers';

/* ─────────────────────────────────────────────────────────────────────────────
   PostProductionSheet — right-side "Prepare to publish" drawer.
   Includes dim backdrop, asset header, content editor, discovery score,
   publish targets, platform preview, and action footer.
   ───────────────────────────────────────────────────────────────────────────── */
export default function PostProductionSheet({
  postDrawerOpen,
  onClose,
  selectedGeneration,
  postProduction,
  seoLocked,
  updatePostProduction,
  tagValue,
  setTagValue,
  addHashtag,
  removeHashtag,
  addHashtagSuggestion,
  optimizeSeo,
  accounts,
  accountsLoading,
  toggleAccount,
  selectedAccounts,
  previewAccount,
  setPreviewAccountId,
  publishing,
  onSaveDraft,
  onPublish,
}) {
  return (
    <>
      {postDrawerOpen && (
        <div
          className="studio-post-dim"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <div
        className={`studio-post-drawer ${postDrawerOpen ? 'is-open' : ''}`}
        aria-hidden={!postDrawerOpen}
        role="dialog"
        aria-modal="true"
        aria-label="Prepare to publish"
      >
        {/* Header */}
        <div className="studio-post-drawer__header">
          <span className="studio-post-drawer__title">Prepare to publish</span>
          <button type="button" className="studio-post-drawer__close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="studio-post-drawer__body">

          {/* Selected asset */}
          {selectedGeneration && (
            <div className="studio-post-asset">
              <div className="studio-post-asset__thumb">
                {selectedGeneration.media_type === 'video'
                  ? <video src={getMediaUrl(selectedGeneration)} muted />
                  : <img src={getMediaUrl(selectedGeneration)} alt="Selected" />}
              </div>
              <div className="studio-post-asset__info">
                <span className="studio-post-asset__model">{getAssetMetadata(selectedGeneration).providerModel}</span>
                <button type="button" className="studio-post-asset__change" onClick={onClose}>
                  Change asset
                </button>
              </div>
            </div>
          )}

          {/* Content section */}
          <div className="studio-drawer-section">
            <span className="studio-drawer-section__label">Content</span>

            <div className={`studio-field ${seoLocked ? 'is-loading' : ''}`}>
              <label className="studio-field__label" htmlFor="pd-title">Title</label>
              <input
                id="pd-title"
                className="studio-field__input"
                value={postProduction.title}
                onChange={(e) => updatePostProduction({ title: e.target.value })}
                disabled={seoLocked}
                placeholder="Post title"
              />
            </div>

            <div className={`studio-field ${seoLocked ? 'is-loading' : ''}`}>
              <label className="studio-field__label" htmlFor="pd-caption">Caption</label>
              <textarea
                id="pd-caption"
                className="studio-field__textarea"
                value={postProduction.caption}
                onChange={(e) => updatePostProduction({ caption: e.target.value })}
                disabled={seoLocked}
                placeholder="Your post caption…"
              />
            </div>

            <div className={`studio-field ${seoLocked ? 'is-loading' : ''}`}>
              <div className="studio-field__head">
                <label className="studio-field__label">Hashtags</label>
                <span className="studio-field__count">{postProduction.hashtags.length}</span>
              </div>
              <div className="studio-tag-list">
                {postProduction.hashtags.map((tag, i) => (
                  <span key={`${tag}-${i}`} className="studio-tag">
                    {tag}
                    <button type="button" onClick={() => removeHashtag(i)} disabled={seoLocked} aria-label={`Remove ${tag}`}>
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
              <div className="studio-tag-input-row">
                <input
                  className="studio-field__input"
                  value={tagValue}
                  onChange={(e) => setTagValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addHashtag(); } }}
                  disabled={seoLocked}
                  placeholder="#discoverable"
                />
                <button type="button" className="studio-tag-add" onClick={addHashtag} disabled={seoLocked || !tagValue.trim()}>
                  Add
                </button>
              </div>
              {postProduction.seoHashtagSuggestions?.length > 0 && (
                <div className="studio-hashtag-suggestions">
                  {postProduction.seoHashtagSuggestions.map((item) => (
                    <button
                      key={item.tag}
                      type="button"
                      className="studio-hashtag-suggestion"
                      onClick={() => addHashtagSuggestion(item.tag)}
                      disabled={seoLocked}
                    >
                      {item.tag}
                      <span>{item.relevance}%</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Discovery Score section */}
          <div className="studio-drawer-section">
            <div className="studio-drawer-section__head">
              <span className="studio-drawer-section__label">Discovery Score</span>
              <button
                type="button"
                className="studio-score-improve"
                onClick={optimizeSeo}
                disabled={seoLocked || !postProduction.caption.trim()}
              >
                {postProduction.seoStatus === 'optimizing' || postProduction.seoStatus === 'scoring'
                  ? <Loader2 size={12} className="studio-spin" />
                  : <Sparkles size={12} />}
                Improve score
              </button>
            </div>
            <DiscoveryScoreCard
              score={postProduction.seoScore || 0}
              breakdown={postProduction.seoBreakdown}
              suggestions={postProduction.seoSuggestions}
              loading={seoLocked}
            />
          </div>

          {/* Publish to section */}
          <div className="studio-drawer-section">
            <span className="studio-drawer-section__label">Publish to</span>
            <div className="studio-platform-pills">
              {accounts.map((account) => {
                const sel = postProduction.selectedPlatforms.includes(account.id);
                return (
                  <button
                    key={account.id}
                    type="button"
                    className={`studio-platform-pill ${sel ? 'is-selected' : ''}`}
                    onClick={() => toggleAccount(account.id)}
                    disabled={seoLocked}
                  >
                    <PlatformIcon platform={account.platform} size="sm" />
                    <span>{account.account_name || account.display_name || account.username || account.platform}</span>
                    {sel && <Check size={11} />}
                  </button>
                );
              })}
              {!accountsLoading && accounts.length === 0 && (
                <span className="studio-no-accounts">No connected accounts yet.</span>
              )}
            </div>
          </div>

          {/* Platform preview section */}
          {selectedAccounts.length > 0 && (
            <div className="studio-drawer-section">
              <span className="studio-drawer-section__label">Preview</span>
              <div className="studio-preview-tabs">
                {selectedAccounts.map((account) => (
                  <button
                    key={account.id}
                    type="button"
                    className={`studio-preview-tab ${previewAccount?.id === account.id ? 'is-active' : ''}`}
                    onClick={() => setPreviewAccountId(account.id)}
                  >
                    <PlatformIcon platform={account.platform} size="xs" />
                    {normalizePlatform(account.platform)}
                  </button>
                ))}
              </div>
              <PlatformPreview
                account={previewAccount}
                mediaUrl={getMediaUrl(selectedGeneration)}
                mediaType={selectedGeneration?.media_type}
                title={postProduction.title}
                caption={postProduction.caption}
                hashtags={postProduction.hashtags}
              />
            </div>
          )}
        </div>

        {/* Sticky footer */}
        <div className="studio-post-drawer__footer">
          <button
            type="button"
            className="studio-btn studio-btn--secondary"
            onClick={onSaveDraft}
            disabled={publishing || seoLocked || !selectedGeneration}
          >
            <FileText size={14} />
            Save draft
          </button>
          <button
            type="button"
            className="studio-btn studio-btn--primary"
            onClick={onPublish}
            disabled={publishing || seoLocked || !selectedGeneration || postProduction.selectedPlatforms.length === 0}
          >
            {publishing
              ? <Loader2 size={14} className="studio-spin" />
              : postProduction.scheduleDate ? <Calendar size={14} /> : <Send size={14} />}
            {publishing ? 'Publishing…' : postProduction.scheduleDate ? 'Schedule' : 'Publish'}
          </button>
        </div>
      </div>
    </>
  );
}
