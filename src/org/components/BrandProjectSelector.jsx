import React, { useEffect, useRef, useState } from 'react';

export default function BrandProjectSelector({
  projects = [],
  activeProject = null,
  onSelect = () => {},
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    function handleClick(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  if (!projects.length) return null;

  return (
    <div className="org-brand-selector" ref={rootRef}>
      <button
        type="button"
        className="org-brand-selector-trigger"
        onClick={() => setOpen((value) => !value)}
      >
        <span>{activeProject?.name || 'Brand Project'}</span>
      </button>

      {open ? (
        <div className="org-brand-selector-menu">
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              className={`org-brand-selector-option ${project.id === activeProject?.id ? 'active' : ''}`}
              onClick={() => {
                onSelect(project.id);
                setOpen(false);
              }}
            >
              {project.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
