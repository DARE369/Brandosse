"use client";

// src/pages/Settings/ContentDefaultsTab.jsx
// Real, persisted starting defaults for new Studio generations — backed by
// user_settings.generation_defaults (see userSettingsService.js). Aspect
// ratio + video quality + "match brand kit" are read by StudioPage.jsx on
// mount (see the defaultsSeededRef effect there) and genuinely change
// generation behavior (matchBrandKit gates the brand-kit load in
// generationPipeline.js). Default platforms are saved but not yet consumed
// anywhere downstream — labeled honestly below rather than implying more.
import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { ASPECT_RATIOS, VIDEO_QUALITY_TIERS } from "../../config/mediaGenerationOptions";
import { getAllPlatforms } from "../../services/platforms/platformRegistry";
import { fetchUserSettings, saveUserSettings } from "../../services/userSettingsService";
import { Card, Button } from "../../ui-v2";
import styles from "./ContentDefaultsTab.module.css";

// Mirrors LogoPosition in supabase/functions/_shared/composite.ts — the
// compositor accepts exactly these six.
const LOGO_POSITION_OPTIONS = [
  { value: "bottom-right", label: "Bottom right" },
  { value: "bottom-center", label: "Bottom centre" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "top-right", label: "Top right" },
  { value: "top-center", label: "Top centre" },
  { value: "top-left", label: "Top left" },
];

// Fraction of image width. The compositor clamps to 0.04-0.5.
const LOGO_SCALE_OPTIONS = [
  { value: 0.1, label: "Small" },
  { value: 0.16, label: "Medium" },
  { value: 0.24, label: "Large" },
];

export default function ContentDefaultsTab({ userId, onToast }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [platforms, setPlatforms] = useState([]);
  const [form, setForm] = useState({
    aspect_ratio: "1:1",
    video_quality: "standard",
    match_brand_kit: true,
    apply_logo: false,
    logo_position: 'bottom-right',
    logo_scale: 0.16,
    default_platforms: [],
  });

  useEffect(() => {
    let mounted = true;
    if (!userId) { setLoading(false); return undefined; }
    Promise.all([fetchUserSettings(userId), getAllPlatforms()])
      .then(([settings, allPlatforms]) => {
        if (!mounted) return;
        setForm({ ...settings.generationDefaults });
        setPlatforms(allPlatforms || []);
      })
      .catch((err) => onToast?.(err?.message || "Could not load content defaults.", "error"))
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [userId, onToast]);

  const togglePlatform = (key) => {
    setForm((current) => {
      const has = current.default_platforms.includes(key);
      return {
        ...current,
        default_platforms: has
          ? current.default_platforms.filter((p) => p !== key)
          : [...current.default_platforms, key],
      };
    });
  };

  const handleSave = async () => {
    if (!userId) return;
    setSaving(true);
    try {
      await saveUserSettings(userId, { generationDefaults: form });
      onToast?.("Content defaults saved.", "success");
    } catch (err) {
      onToast?.(err?.message || "Could not save content defaults.", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <div className={styles.loading}><Loader2 size={16} className={styles.spin} /> Loading content defaults…</div>
      </Card>
    );
  }

  return (
    <div className={styles.wrap}>
      <Card>
        <div className={styles.sectionTitle}>Default aspect ratio</div>
        <div className={styles.sectionSub}>Applied the next time you start a new Studio session.</div>
        <div className={styles.chipRow}>
          {ASPECT_RATIOS.map((ar) => (
            <button
              key={ar.id}
              type="button"
              className={[styles.chip, form.aspect_ratio === ar.id ? styles.chipActive : ""].join(" ")}
              onClick={() => setForm((c) => ({ ...c, aspect_ratio: ar.id }))}
            >
              {ar.label}
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <div className={styles.sectionTitle}>Default video quality</div>
        <div className={styles.sectionSub}>Used when a new video generation starts, until you change it in Studio.</div>
        <div className={styles.chipRow}>
          {VIDEO_QUALITY_TIERS.map((tier) => (
            <button
              key={tier.id}
              type="button"
              className={[styles.chip, form.video_quality === tier.id ? styles.chipActive : ""].join(" ")}
              onClick={() => setForm((c) => ({ ...c, video_quality: tier.id }))}
              title={tier.hint}
            >
              {tier.label}
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <div className={styles.toggleRow}>
          <div>
            <div className={styles.sectionTitle}>Match brand kit</div>
            <div className={styles.sectionSub}>New generations load your Brand Kit for tone and style by default. Turn this off to start from a blank slate instead.</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={form.match_brand_kit}
            className={styles.switch}
            style={{ background: form.match_brand_kit ? "var(--uiv2-accent-solid)" : "var(--uiv2-border-strong, var(--uiv2-border))" }}
            onClick={() => setForm((c) => ({ ...c, match_brand_kit: !c.match_brand_kit }))}
          >
            <span className={styles.switchKnob} style={{ left: form.match_brand_kit ? "18px" : "2px" }} />
          </button>
        </div>
      </Card>

      <Card>
        <div className={styles.toggleRow}>
          <div>
            <div className={styles.sectionTitle}>Stamp my logo on images</div>
            <div className={styles.sectionSub}>Overlays your Brand Kit logo onto every generated image. Needs a logo uploaded to your ACTIVE Brand Kit — AI cannot draw your real logo, so this composites the actual file.</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={form.apply_logo}
            className={styles.switch}
            style={{ background: form.apply_logo ? "var(--uiv2-accent-solid)" : "var(--uiv2-border-strong, var(--uiv2-border))" }}
            onClick={() => setForm((c) => ({ ...c, apply_logo: !c.apply_logo }))}
          >
            <span className={styles.switchKnob} style={{ left: form.apply_logo ? "18px" : "2px" }} />
          </button>
        </div>

        {form.apply_logo && (
          <>
            <div className={styles.sectionSub} style={{ marginTop: 16 }}>Position</div>
            <div className={styles.chipRow}>
              {LOGO_POSITION_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={`${styles.chip} ${form.logo_position === o.value ? styles.chipActive : ""}`}
                  aria-pressed={form.logo_position === o.value}
                  onClick={() => setForm((c) => ({ ...c, logo_position: o.value }))}
                >
                  {o.label}
                </button>
              ))}
            </div>

            <div className={styles.sectionSub} style={{ marginTop: 16 }}>Size</div>
            <div className={styles.chipRow}>
              {LOGO_SCALE_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={`${styles.chip} ${form.logo_scale === o.value ? styles.chipActive : ""}`}
                  aria-pressed={form.logo_scale === o.value}
                  onClick={() => setForm((c) => ({ ...c, logo_scale: o.value }))}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </>
        )}
      </Card>

      <Card>
        <div className={styles.sectionTitle}>Default platforms</div>
        <div className={styles.sectionSub}>Saved to your account as your usual publishing targets — a quick reference for you, not yet auto-applied when starting a session.</div>
        <div className={styles.chipRow}>
          {platforms.map((p) => (
            <button
              key={p.platform_key}
              type="button"
              className={[styles.chip, form.default_platforms.includes(p.platform_key) ? styles.chipActive : ""].join(" ")}
              onClick={() => togglePlatform(p.platform_key)}
            >
              {p.display_name || p.platform_key}
            </button>
          ))}
        </div>
      </Card>

      <div className={styles.actions}>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 size={14} className={styles.spin} /> : <Save size={14} />}
          {saving ? "Saving…" : "Save content defaults"}
        </Button>
      </div>
    </div>
  );
}
