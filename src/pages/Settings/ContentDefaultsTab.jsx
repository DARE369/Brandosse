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

export default function ContentDefaultsTab({ userId, onToast }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [platforms, setPlatforms] = useState([]);
  const [form, setForm] = useState({
    aspect_ratio: "1:1",
    video_quality: "standard",
    match_brand_kit: true,
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
