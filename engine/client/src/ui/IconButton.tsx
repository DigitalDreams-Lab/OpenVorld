// (the cog is the Feather 'settings' icon, MIT)
// Small square icon buttons for panel headers: crisp SVG glyphs instead of text characters, so they look the same everywhere.
import type { ReactNode } from 'react';

const PATHS: Record<string, ReactNode> = {
  close: <path d="M6 6l12 12M18 6L6 18" />,
  call: <><circle cx="8" cy="8" r="3.2" /><path d="M2.5 20c0-3.6 2.5-6 5.5-6s5.5 2.4 5.5 6" /><path d="M22 11.5h-6.5M18.5 8.5l-3 3 3 3" /></>,   // someone coming over to you
  following: <><circle cx="8" cy="8" r="3.2" /><path d="M2.5 20c0-3.6 2.5-6 5.5-6s5.5 2.4 5.5 6" /><path d="M16.5 8.5l5 5M21.5 8.5l-5 5" /></>,   // a follower you can send home
  expand: <><path d="M14 4h6v6M10 20H4v-6" /><path d="M20 4l-7 7M4 20l7-7" /></>,   // make the panel wider
  shrink: <><path d="M20 10h-6V4M4 14h6v6" /><path d="M14 10l7-7M3 21l7-7" /></>,   // back to the normal width
  edit: <><path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" /></>,
};

export function IconButton({ icon, title, onClick, active }: { icon: keyof typeof PATHS; title: string; onClick: () => void; active?: boolean }) {
  return (
    <button type="button" className={active ? 'icon-btn on' : 'icon-btn'} title={title} aria-label={title} onClick={onClick}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{PATHS[icon]}</svg>
    </button>
  );
}
