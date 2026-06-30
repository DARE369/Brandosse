'use client';
/* =============================================================================
   GoldenReference — the canonical "world-class" page for the rebuild.
   Built ENTIRELY on ui-primitives + Midnight Aurora tokens. Zero raw hex,
   zero inline styles. This is the template every migrated page copies.
   Route: /app/design
   ============================================================================= */
import { useState } from 'react';
import {
  Sparkles, CalendarClock, Save, Check, Image as ImageIcon,
  Hash, FileText, ShieldCheck, TrendingUp,
} from 'lucide-react';
import {
  UiPageHeader, UiButton, UiCard, UiBadge, UiStatCard, UiInput, UiEmptyState,
} from '../../components/Shared/ui';
import './GoldenReference.css';

const READINESS = [
  { label: 'Caption written', done: true,  icon: FileText },
  { label: 'Media attached',  done: true,  icon: ImageIcon },
  { label: 'Hashtags added',  done: true,  icon: Hash },
  { label: 'Brand check passed', done: true, icon: ShieldCheck },
  { label: 'Best-time slot picked', done: false, icon: CalendarClock },
];

export default function GoldenReference() {
  const [caption, setCaption] = useState('Golden hour glow for the new drop ☀️ Clean, soft, and unmistakably us.');

  return (
    <div className="golden-page">
      <UiPageHeader
        eyebrow="AI Studio"
        title="Your post is ready"
        description="This screen is the reference standard for the rebuild — every page is migrated to match this quality bar."
        actions={(
          <>
            <UiButton variant="secondary"><Save size={16} aria-hidden="true" /> Save draft</UiButton>
            <UiButton variant="accent"><CalendarClock size={16} aria-hidden="true" /> Schedule post</UiButton>
          </>
        )}
      />

      <div className="golden-grid">
        {/* ── Generated post preview ── */}
        <UiCard padding="none" className="golden-post">
          <div className="golden-media">Your generated visual</div>
          <div className="golden-post-body">
            <div className="golden-post-row">
              <UiBadge variant="soft" tone="success"><Check size={12} aria-hidden="true" /> Ready</UiBadge>
              <UiBadge variant="soft" tone="brand"><Sparkles size={12} aria-hidden="true" /> Brand-aware</UiBadge>
            </div>
            <UiInput
              label="Caption"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              hint="Tuned to your brand voice. Edit freely — changes save to the draft."
            />
            <div className="golden-tags">#newdrop #skincare #goldenhour #cleanbeauty</div>
            <div className="golden-actions">
              <UiButton variant="accent"><CalendarClock size={16} aria-hidden="true" /> Schedule post</UiButton>
              <UiButton variant="secondary"><Save size={16} aria-hidden="true" /> Save draft</UiButton>
              <UiButton variant="ghost"><Sparkles size={16} aria-hidden="true" /> Regenerate</UiButton>
            </div>
          </div>
        </UiCard>

        {/* ── Side rail: readiness + stats ── */}
        <div className="golden-side">
          <UiCard padding="md">
            <p className="golden-section-title">Publish readiness</p>
            <ul className="golden-checklist">
              {READINESS.map(({ label, done }) => (
                <li key={label}>
                  <span className={done ? 'golden-check' : 'golden-check golden-check--todo'}>
                    <Check size={13} aria-hidden="true" />
                  </span>
                  {label}
                </li>
              ))}
            </ul>
          </UiCard>
          <div className="golden-stats">
            <UiStatCard label="Scheduled" value="12" tone="info" icon={<CalendarClock size={16} />} />
            <UiStatCard label="Published" value="48" tone="success" icon={<Check size={16} />} />
            <UiStatCard label="Drafts" value="3" tone="brand" icon={<FileText size={16} />} />
            <UiStatCard
              label="Reach (7d)" value="18.4k" tone="brand"
              icon={<TrendingUp size={16} />}
              trend={{ label: '+12%', tone: 'success' }}
            />
          </div>
        </div>
      </div>

      {/* ── Component vocabulary (living styleguide) ── */}
      <div className="golden-vocab">
        <div>
          <p className="golden-section-title">Buttons</p>
          <div className="golden-row">
            <UiButton variant="accent">Key CTA</UiButton>
            <UiButton variant="primary">Primary</UiButton>
            <UiButton variant="secondary">Secondary</UiButton>
            <UiButton variant="ghost">Ghost</UiButton>
            <UiButton variant="subtle">Subtle</UiButton>
            <UiButton variant="primary" loading>Loading</UiButton>
            <UiButton variant="secondary" disabled>Disabled</UiButton>
          </div>
        </div>

        <div>
          <p className="golden-section-title">Status badges — post lifecycle</p>
          <div className="golden-row">
            <UiBadge tone="neutral">Draft</UiBadge>
            <UiBadge tone="info">Scheduled</UiBadge>
            <UiBadge tone="warning">Publishing</UiBadge>
            <UiBadge tone="success">Published</UiBadge>
            <UiBadge tone="danger">Failed</UiBadge>
          </div>
        </div>

        <div>
          <p className="golden-section-title">Empty state</p>
          <UiCard padding="none">
            <UiEmptyState
              eyebrow="Library"
              icon={<ImageIcon size={28} aria-hidden="true" />}
              title="No posts yet"
              description="Generate your first on-brand post and it will show up here, ready to schedule."
              actions={<UiButton variant="accent"><Sparkles size={16} aria-hidden="true" /> Create your first post</UiButton>}
            />
          </UiCard>
        </div>
      </div>
    </div>
  );
}
