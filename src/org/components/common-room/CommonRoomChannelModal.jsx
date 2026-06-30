import React, { useEffect, useState } from 'react';
import { Hash, Lock, Sparkles, Users, X } from 'lucide-react';

export default function CommonRoomChannelModal({
  open = false,
  onClose,
  onSubmit,
  submitting = false,
  brandDisabled = false,
  activeBrandName = '',
  members = [],
  currentUserId = null,
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState('org');
  const [channelType, setChannelType] = useState('group');
  const [memberIds, setMemberIds] = useState([]);
  const [isAiEnabled, setIsAiEnabled] = useState(true);
  const [maxMembers, setMaxMembers] = useState('');

  useEffect(() => {
    if (!open) return;
    setName('');
    setDescription('');
    setScope('org');
    setChannelType('group');
    setMemberIds(currentUserId ? [currentUserId] : []);
    setIsAiEnabled(true);
    setMaxMembers('');
  }, [currentUserId, open]);

  if (!open) return null;

  const selectedMemberIds = [...new Set([...(currentUserId ? [currentUserId] : []), ...memberIds])];
  const hasExceededMemberLimit = Boolean(
    channelType === 'private_group'
    && maxMembers
    && selectedMemberIds.length > Number(maxMembers),
  );
  const canSubmit = Boolean(name.trim())
    && (channelType !== 'private_group' || selectedMemberIds.length > 0)
    && !hasExceededMemberLimit;

  const toggleMember = (memberId) => {
    if (!memberId || memberId === currentUserId) return;

    setMemberIds((current) => (
      current.includes(memberId)
        ? current.filter((entry) => entry !== memberId)
        : [...current, memberId]
    ));
  };

  return (
    <div className="common-room-modal" role="dialog" aria-modal="true" aria-label="Create channel">
      <button
        type="button"
        className="common-room-modal-backdrop"
        aria-label="Close channel modal"
        onClick={() => {
          if (!submitting) {
            onClose?.();
          }
        }}
      />

      <section className="common-room-modal-panel">
        <header className="common-room-modal-header">
          <div>
            <span className="common-room-eyebrow">Channel Setup</span>
            <h3>Create a new channel</h3>
          </div>
          <button
            type="button"
            className="common-room-icon-button subtle"
            onClick={() => {
              if (!submitting) {
                onClose?.();
              }
            }}
            aria-label="Close channel modal"
          >
            <X size={15} />
          </button>
        </header>

        <form
          className="common-room-channel-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            onSubmit?.({
              name: name.trim(),
              description: description.trim(),
              scope,
              channelType,
              memberIds: selectedMemberIds,
              groupAdminUserId: currentUserId || null,
              isAiEnabled,
              maxMembers: maxMembers ? Number(maxMembers) : null,
            });
          }}
        >
          <label className="common-room-field">
            <span>Channel name</span>
            <div className="common-room-prefixed-input">
              <Hash size={14} />
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="campaign-reviews"
                autoFocus
              />
            </div>
          </label>

          <label className="common-room-field">
            <span>Description</span>
            <textarea
              rows={4}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What is this channel for?"
            />
          </label>

          <div className="common-room-field">
            <span>Channel type</span>
            <div className="common-room-scope-toggle common-room-channel-type-toggle">
              <button
                type="button"
                className={`common-room-scope-option ${channelType === 'group' ? 'active' : ''}`}
                onClick={() => setChannelType('group')}
              >
                <Users size={14} />
                Standard Channel
              </button>
              <button
                type="button"
                className={`common-room-scope-option ${channelType === 'private_group' ? 'active' : ''}`}
                onClick={() => setChannelType('private_group')}
              >
                <Lock size={14} />
                Private Group
              </button>
            </div>
          </div>

          <div className="common-room-field">
            <span>Scope</span>
            <div className="common-room-scope-toggle">
              <button
                type="button"
                className={`common-room-scope-option ${scope === 'org' ? 'active' : ''}`}
                onClick={() => setScope('org')}
              >
                Org-wide
              </button>
              <button
                type="button"
                className={`common-room-scope-option ${scope === 'brand' ? 'active' : ''}`}
                onClick={() => {
                  if (!brandDisabled) {
                    setScope('brand');
                  }
                }}
                disabled={brandDisabled}
              >
                {brandDisabled ? 'Brand-scoped unavailable' : `Brand-scoped${activeBrandName ? ` / ${activeBrandName}` : ''}`}
              </button>
            </div>
          </div>

          {channelType === 'private_group' ? (
            <>
              <div className="common-room-field">
                <span>Members</span>
                <div className="common-room-member-checklist">
                  {members.map((member) => {
                    const memberId = member.userId;
                    const label = member?.profile?.full_name || member?.profile?.email || memberId;
                    const isCurrentUser = memberId === currentUserId;
                    const checked = selectedMemberIds.includes(memberId);

                    return (
                      <label key={memberId} className={`common-room-member-choice ${checked ? 'active' : ''}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={isCurrentUser}
                          onChange={() => toggleMember(memberId)}
                        />
                        <div>
                          <strong>{label}</strong>
                          <span>{isCurrentUser ? 'Group admin / always included' : (member.role || 'member')}</span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="common-room-field">
                <span>Member limit</span>
                <input
                  type="number"
                  min="2"
                  value={maxMembers}
                  onChange={(event) => setMaxMembers(event.target.value)}
                  placeholder="Optional maximum"
                />
              </div>

              {hasExceededMemberLimit ? (
                <div className="common-room-section-empty compact">
                  Member limit cannot be lower than the selected group size.
                </div>
              ) : null}
            </>
          ) : null}

          <label className="common-room-toggle-row">
            <input
              type="checkbox"
              checked={isAiEnabled}
              onChange={(event) => setIsAiEnabled(event.target.checked)}
            />
            <span>
              <Sparkles size={14} />
              Enable AI replies in this channel
            </span>
          </label>

          <div className="common-room-modal-actions">
            <button type="button" className="common-room-button ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="common-room-button primary" disabled={submitting || !canSubmit}>
              {submitting ? 'Creating...' : 'Create Channel'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
