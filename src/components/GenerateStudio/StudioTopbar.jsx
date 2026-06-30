import React from 'react';
import { BadgeCheck, Sparkles } from 'lucide-react';
import ProjectSessionBreadcrumb from './ProjectSessionBreadcrumb';

export default function StudioTopbar({ brandKit, availableCredits }) {
  return (
    <header className="studio-topbar">
      <div className="studio-topbar__left">
        <ProjectSessionBreadcrumb />
      </div>

      <div className="studio-topbar__right">
        {(brandKit?.raw?.brand_name || brandKit?.summary) && (
          <div className="studio-brand-pill">
            <Sparkles size={12} />
            {brandKit?.raw?.brand_name || 'Brand Kit active'}
          </div>
        )}
        <div className="studio-credit-pill">
          <BadgeCheck size={13} />
          {availableCredits.toLocaleString()} cr
        </div>
      </div>
    </header>
  );
}
