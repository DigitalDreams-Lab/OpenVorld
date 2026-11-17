import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import icon from '../../../../desktop/assets/icon.svg';
import changelog from '../../../../CHANGELOG.md?raw';
import { IconButton } from './IconButton';

export const APP_VERSION = __OPENVORLD_VERSION__;
export const REPOSITORY = 'https://github.com/DigitalDreams-Lab/OpenVorld';
const releases = changelog.split(/^## /m).slice(1).map(section => {
  const [heading, ...body] = section.split('\n');
  const [version, date] = heading.split(' - ');
  return { version: version.trim(), date: date?.trim(), notes: body.join('\n').trim() };
});
export const openAbout = () => window.dispatchEvent(new CustomEvent('openvorld:about'));

/** All About entry points share one dialog, including the native desktop menu. */
export function AboutLauncher() {
  const [view, setView] = useState<{ changelog: boolean } | null>(null);
  useEffect(() => {
    const open = (event: Event) => setView({ changelog: (event as CustomEvent).detail?.changelog === true });
    window.addEventListener('openvorld:about', open);
    return () => window.removeEventListener('openvorld:about', open);
  }, []);
  return view ? <About key={String(view.changelog)} initialChangelog={view.changelog} onClose={() => setView(null)} /> : null;
}

export function BrandIcon({ size = 56 }: { size?: number }) {
  return <img className="brand-icon" src={icon} alt="OpenVorld icon" width={size} height={size} draggable={false} />;
}

export function About({ onClose, initialChangelog = false }: { onClose: () => void; initialChangelog?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);
  const [showChanges, setShowChanges] = useState(initialChangelog);
  const outside = (dialog: HTMLDialogElement, x: number, y: number) => {
    const bounds = dialog.getBoundingClientRect();
    return x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom;
  };
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); onClose(); }
    };
    window.addEventListener('keydown', escape, true);
    return () => { window.removeEventListener('keydown', escape, true); dialog.close(); };
  }, [onClose]);
  return <dialog ref={ref} className="about-dialog panel" aria-labelledby="about-title"
    onPointerDown={event => { event.stopPropagation(); pressedBackdrop.current = event.target === event.currentTarget && outside(event.currentTarget, event.clientX, event.clientY); }}
    onPointerCancel={() => { pressedBackdrop.current = false; }}
    onClick={event => {
      event.stopPropagation();
      const backdrop = pressedBackdrop.current; pressedBackdrop.current = false;
      // Native dialogs retarget backdrop clicks AND clicks on inner padding to the dialog itself.
      if (backdrop && event.target === event.currentTarget && outside(event.currentTarget, event.clientX, event.clientY)) onClose();
    }}>
    <header className="row between"><span className="eyebrow">A home for your AI crew</span><IconButton icon="close" title="Close about" onClick={onClose} /></header>
    <BrandIcon size={96} />
    <h2 id="about-title">OpenVorld</h2>
    <p className="about-version">Version {APP_VERSION}</p>
    <div className="about-tabs" aria-label="About sections"><button className={`chip ${!showChanges ? 'on' : ''}`} aria-pressed={!showChanges} onClick={() => setShowChanges(false)}>About</button><button className={`chip ${showChanges ? 'on' : ''}`} aria-pressed={showChanges} onClick={() => setShowChanges(true)}>Changelog</button></div>
    {showChanges ? <section className="about-changelog" aria-label="Changelog" tabIndex={0}>
      {releases.map((release, i) => <details key={release.version} open={i === 0}>
        <summary><strong>v{release.version}</strong>{release.date && <time dateTime={release.date}>{release.date}</time>}</summary>
        <ReactMarkdown skipHtml components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a> }}>{release.notes}</ReactMarkdown>
      </details>)}
    </section> : <>
      <p className="about-tagline">Every project is a vorld.</p>
      <p>Bring your project, assemble a crew, and turn the work into a shared adventure. Your agents have roles, workbenches, and a place in the world.</p>
      <div className="about-facts"><span>Local first</span><span>Open source</span><span>MIT licensed</span></div>
    </>}
    <a className="btn primary" href={REPOSITORY} target="_blank" rel="noreferrer">Explore on GitHub <span aria-hidden="true">↗</span></a>
    <p className="about-credit">Made by DigitalDreams Lab and contributors.</p>
  </dialog>;
}
