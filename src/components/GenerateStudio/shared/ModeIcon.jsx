import React from 'react';
import {
  Clapperboard,
  Film,
  Image as ImageIcon,
  LayoutGrid,
  Pencil,
} from 'lucide-react';

/* ─────────────────────────────────────────────────────────────────────────────
   ModeIcon — icon representing each generation mode
   ───────────────────────────────────────────────────────────────────────────── */
export default function ModeIcon({ mode, size = 13 }) {
  const icons = {
    image:          <ImageIcon size={size} />,
    carousel:       <LayoutGrid size={size} />,
    video:          <Film size={size} />,
    edit:           <Pencil size={size} />,
    'image-to-video': <Clapperboard size={size} />,
  };
  return icons[mode] || <ImageIcon size={size} />;
}
