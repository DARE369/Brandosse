import React, { useMemo, useRef, useState } from 'react';
import {
  ChevronDown, FileText, PenLine, RefreshCw, Check, Plus, Image as ImageIcon,
} from 'lucide-react';
import toast from 'react-hot-toast';
import useBrandKitStore from '../../stores/BrandKitStore';
import { supabase } from '../../services/supabaseClient';
import { getHealthScore, getMissingTier1Fields } from '../../utils/brandKitValidation';
import { Button, IconButton, Card, Dropdown } from '../../ui-v2';
import styles from './BrandKit.module.css';

const ACCEPTED_DOC_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const HEALTH_FIELDS = [
  'brand_name', 'industry', 'tagline', 'target_audience', 'brand_voice', 'tone_descriptors',
  'writing_style_notes', 'forbidden_phrases', 'content_restrictions', 'visual_style_keywords',
  'color_palette', 'photo_style_notes', 'legal_disclaimers', 'competitor_names',
];

function healthClass(score) {
  if (score < 50) return styles.healthDanger;
  if (score < 90) return styles.healthWarning;
  return styles.healthGood;
}

/**
 * Near-rewrite (per AS_IS_AUDIT.md §5.8), not a light restyle — the mockup's
 * dashboard needs a kit switcher, separate per-section cards, font-pair
 * display, and "Re-import from site" / "New brand kit" actions the old
 * single-summary-card build never had.
 */
export default function BrandKitDashboard({
  brandKit,
  assetsCount = 0,
  onEditSection,
  onOpenManualEdit,
  onUploadUpdatedDocument,
  onNewKit,
}) {
  const { kits, currentKitId, activeKit, assets, selectKit, setActiveKit } = useBrandKitStore();
  const openDiffModal = useBrandKitStore((s) => s.openDiffModal);

  const [updateMenuOpen, setUpdateMenuOpen] = useState(false);
  const [kitMenuOpen, setKitMenuOpen] = useState(false);
  const [reimporting, setReimporting] = useState(false);
  const updateInputRef = useRef(null);

  const healthScore = useMemo(() => getHealthScore(brandKit || {}, HEALTH_FIELDS), [brandKit]);
  const missingTier1 = useMemo(() => getMissingTier1Fields(brandKit || {}), [brandKit]);

  const handleUpdateFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    setUpdateMenuOpen(false);
    if (!file) return;

    if (!ACCEPTED_DOC_MIME.includes(file.type)) {
      toast.error('Please upload a PDF or Word document (.pdf, .doc, .docx).');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error('File must be under 20MB.');
      return;
    }
    onUploadUpdatedDocument?.(file);
  };

  const handleReimportFromSite = async () => {
    setUpdateMenuOpen(false);
    const suggested = brandKit?.website_url || '';
    // eslint-disable-next-line no-alert
    const url = window.prompt('Re-import from which website?', suggested);
    if (!url || !url.trim()) return;

    setReimporting(true);
    try {
      const { data, error } = await supabase.functions.invoke('extractBrandKit', {
        body: { websiteUrl: url.trim() },
      });
      if (error) throw error;
      openDiffModal(brandKit || {}, data?.brandKit || {}, data?.confidenceMap || {});
    } catch (err) {
      toast.error(err?.message || 'Could not re-import from that site.');
    } finally {
      setReimporting(false);
    }
  };

  const safePalette = Array.isArray(brandKit?.color_palette) ? brandKit.color_palette : [];
  const kitIndex = kits.findIndex((k) => k.id === currentKitId);
  const kitPosition = kitIndex >= 0 ? kitIndex + 1 : 1;
  const isViewingActive = activeKit && brandKit && activeKit.id === brandKit.id;

  return (
    <div>
      <div className={styles.dashHeader}>
        <div className={styles.dashHeaderLeft}>
          <h1 className={styles.dashTitle}>{brandKit?.brand_name || 'Unnamed brand'}</h1>

          <Dropdown
            open={kitMenuOpen}
            onClose={() => setKitMenuOpen(false)}
            trigger={
              <button type="button" className={styles.kitSwitcherTrigger} onClick={() => setKitMenuOpen((o) => !o)}>
                {brandKit?.kit_name || 'Untitled kit'}
                {isViewingActive && <span className={styles.kitSwitcherActiveBadge}>● active</span>}
                <ChevronDown size={14} />
                <span className={styles.kitCountLabel}>· {kitPosition} of {kits.length} kit{kits.length === 1 ? '' : 's'} · {assetsCount} asset{assetsCount === 1 ? '' : 's'}</span>
              </button>
            }
          >
            <div className={styles.kitSwitcherPanel}>
              {kits.map((kit) => (
                <button
                  key={kit.id}
                  type="button"
                  className={[styles.kitSwitcherItem, kit.id === currentKitId ? styles.kitSwitcherItemActive : ''].filter(Boolean).join(' ')}
                  onClick={() => { selectKit(kit.id); setKitMenuOpen(false); }}
                >
                  <span className={styles.kitSwitcherItemName}>{kit.kit_name || kit.brand_name || 'Untitled kit'}</span>
                  {kit.is_active ? (
                    <span className={styles.kitSwitcherActiveBadge}><Check size={11} /> active</span>
                  ) : (
                    <span
                      className={styles.kitSwitcherMakeActive}
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveKit(kit.user_id, kit.id).then(() => toast.success(`"${kit.kit_name || kit.brand_name || 'This kit'}" is now Studio's active kit`));
                      }}
                    >
                      Make active
                    </span>
                  )}
                </button>
              ))}
              <div className={styles.kitSwitcherFooter}>
                <button type="button" className={styles.kitSwitcherItem} onClick={() => { setKitMenuOpen(false); onNewKit?.(); }}>
                  <span className={styles.kitSwitcherItemName}><Plus size={13} style={{ marginRight: 6, verticalAlign: -2 }} />New brand kit</span>
                </button>
              </div>
            </div>
          </Dropdown>

          <div className={styles.healthWrap} style={{ maxWidth: 280 }}>
            <div className={styles.healthHeader}>
              <span className={styles.healthLabel}>Kit health</span>
              <span className={styles.healthPct}>{healthScore}%</span>
            </div>
            <div className={styles.healthTrack}>
              <div className={[styles.healthFill, healthClass(healthScore)].join(' ')} style={{ width: `${healthScore}%` }} />
            </div>
            {missingTier1.length > 0 && (
              <p className={styles.healthNote}>{missingTier1.length} critical field{missingTier1.length > 1 ? 's' : ''} need attention.</p>
            )}
          </div>
        </div>

        <div className={styles.dashActions}>
          <Dropdown
            open={updateMenuOpen}
            onClose={() => setUpdateMenuOpen(false)}
            trigger={
              <Button variant="subtle" onClick={() => setUpdateMenuOpen((o) => !o)}>
                <RefreshCw size={14} />
                {reimporting ? 'Re-importing…' : 'Update Kit'}
                <ChevronDown size={14} />
              </Button>
            }
          >
            <div className={styles.kitSwitcherPanel}>
              <button className={styles.kitSwitcherItem} type="button" onClick={() => updateInputRef.current?.click()}>
                <span className={styles.kitSwitcherItemName}><FileText size={13} style={{ marginRight: 6, verticalAlign: -2 }} />Upload updated document</span>
              </button>
              <button className={styles.kitSwitcherItem} type="button" onClick={handleReimportFromSite}>
                <span className={styles.kitSwitcherItemName}><RefreshCw size={13} style={{ marginRight: 6, verticalAlign: -2 }} />Re-import from site</span>
              </button>
              <button className={styles.kitSwitcherItem} type="button" onClick={() => { setUpdateMenuOpen(false); onOpenManualEdit?.(); }}>
                <span className={styles.kitSwitcherItemName}><PenLine size={13} style={{ marginRight: 6, verticalAlign: -2 }} />Edit manually</span>
              </button>
            </div>
          </Dropdown>
        </div>
      </div>

      <input
        ref={updateInputRef}
        type="file"
        accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className={styles.visuallyHidden}
        onChange={handleUpdateFile}
      />

      <div className={styles.cardsGrid}>
        <Card className={styles.sectionCard}>
          <div className={styles.sectionCardHeader}>
            <span className={styles.sectionCardTitle}>Basics</span>
            <IconButton title="Edit Basics" onClick={() => onEditSection?.('Basics')}><PenLine size={13} /></IconButton>
          </div>
          <div className={styles.metaRow}>
            <p className={styles.metaItem}><strong>Industry:</strong> {brandKit?.industry || <span className={styles.metaEmpty}>Not set</span>}</p>
            <p className={styles.metaItem}><strong>Tagline:</strong> {brandKit?.tagline || <span className={styles.metaEmpty}>Not set</span>}</p>
            <p className={styles.metaItem}><strong>Audience:</strong> {brandKit?.target_audience || <span className={styles.metaEmpty}>Not set</span>}</p>
          </div>
        </Card>

        <Card className={styles.sectionCard}>
          <div className={styles.sectionCardHeader}>
            <span className={styles.sectionCardTitle}>Voice</span>
            <IconButton title="Edit Voice" onClick={() => onEditSection?.('Voice')}><PenLine size={13} /></IconButton>
          </div>
          <div className={styles.metaRow}>
            <p className={styles.metaItem}><strong>Voice:</strong> {brandKit?.brand_voice || <span className={styles.metaEmpty}>Not set</span>}</p>
            <p className={styles.metaItem}><strong>Emoji use:</strong> {brandKit?.emoji_usage || <span className={styles.metaEmpty}>Not set</span>}</p>
            {Array.isArray(brandKit?.tone_descriptors) && brandKit.tone_descriptors.length > 0 && (
              <div className={styles.tagRow}>
                {brandKit.tone_descriptors.slice(0, 6).map((t) => <span key={t} className={styles.tagPill}>{t}</span>)}
              </div>
            )}
          </div>
        </Card>

        <Card className={styles.sectionCard}>
          <div className={styles.sectionCardHeader}>
            <span className={styles.sectionCardTitle}>Guardrails</span>
            <IconButton title="Edit Guardrails" onClick={() => onEditSection?.('Guardrails')}><PenLine size={13} /></IconButton>
          </div>
          <div className={styles.metaRow}>
            {Array.isArray(brandKit?.content_restrictions) && brandKit.content_restrictions.length > 0 ? (
              <div className={styles.tagRow}>
                {brandKit.content_restrictions.slice(0, 8).map((t) => <span key={t} className={[styles.tagPill, styles.tagPillDanger].join(' ')}>{t}</span>)}
              </div>
            ) : (
              <p className={styles.metaEmpty}>No content restrictions set</p>
            )}
            <p className={styles.metaItem}><strong>Caption length:</strong> {brandKit?.min_caption_words ?? 0}–{brandKit?.max_caption_words ?? 0} words</p>
          </div>
        </Card>

        <Card className={styles.sectionCard}>
          <div className={styles.sectionCardHeader}>
            <span className={styles.sectionCardTitle}>Visual Style</span>
            <IconButton title="Edit Visual Style" onClick={() => onEditSection?.('Visual Style')}><PenLine size={13} /></IconButton>
          </div>
          <div className={styles.metaRow}>
            <div className={styles.swatchRow}>
              {safePalette.slice(0, 8).map((color, index) => (
                <span key={`${color?.hex || ''}-${index}`} className={styles.swatch} style={{ background: color?.hex || '#111420' }} title={color?.name || color?.hex || 'Color'} />
              ))}
              {safePalette.length === 0 && <span className={styles.metaEmpty}>No colors configured yet</span>}
            </div>
            {(brandKit?.font_display?.family || brandKit?.font_body?.family) && (
              <div className={styles.fontPairPreviewRow}>
                {brandKit?.font_display?.family && (
                  <p className={styles.fontPairPreviewItem}><strong>Display:</strong> {brandKit.font_display.family} {brandKit.font_display.style ? `(${brandKit.font_display.style})` : ''}</p>
                )}
                {brandKit?.font_body?.family && (
                  <p className={styles.fontPairPreviewItem}><strong>Body:</strong> {brandKit.font_body.family} {brandKit.font_body.style ? `(${brandKit.font_body.style})` : ''}</p>
                )}
              </div>
            )}
            {Array.isArray(brandKit?.avoid_visual_elements) && brandKit.avoid_visual_elements.length > 0 && (
              <div>
                <p className={styles.metaItem} style={{ marginBottom: 4 }}><strong>Avoid:</strong></p>
                <div className={styles.tagRow}>
                  {brandKit.avoid_visual_elements.slice(0, 8).map((t) => <span key={t} className={styles.tagPill}>{t}</span>)}
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card className={[styles.sectionCard, styles.cardsGridFull].join(' ')}>
          <div className={styles.sectionCardHeader}>
            <span className={styles.sectionCardTitle}>Assets</span>
            <IconButton title="Manage assets" onClick={() => onEditSection?.('Assets')}><PenLine size={13} /></IconButton>
          </div>
          <p className={styles.assetCountLabel}>{assets.length} file{assets.length === 1 ? '' : 's'}</p>
          {assets.length > 0 ? (
            <div className={styles.assetGrid}>
              {assets.slice(0, 12).map((asset) => (
                <div key={asset.id} className={styles.assetThumb} title={asset.name}>
                  {asset.public_url && asset.asset_type !== 'document' && asset.asset_type !== 'font' ? (
                    <img src={asset.public_url} alt={asset.alt_text || asset.name} />
                  ) : (
                    <ImageIcon size={16} />
                  )}
                </div>
              ))}
              <button type="button" className={styles.assetThumb} onClick={() => onEditSection?.('Assets')} title="Add asset" style={{ cursor: 'pointer' }}>
                <Plus size={16} />
              </button>
            </div>
          ) : (
            <button type="button" className={styles.assetThumb} onClick={() => onEditSection?.('Assets')} style={{ width: 64, cursor: 'pointer' }}>
              <Plus size={16} />
            </button>
          )}
        </Card>
      </div>
    </div>
  );
}
