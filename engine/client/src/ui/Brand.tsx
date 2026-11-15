import { useEffect, useRef } from 'react';
import icon from '../../../../desktop/assets/icon.svg';
import { IconButton } from './IconButton';

export const APP_VERSION = __OPENVORLD_VERSION__;
export const REPOSITORY = 'https://github.com/DigitalDreams-Lab/OpenVorld';

export function BrandIcon({ size = 56 }: { size?: number }) {
  return <img className="brand-icon" src={icon} alt="OpenVorld icon" width={size} height={size} draggable={false} />;
}

export function About({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); onClose(); }
    };
    window.addEventListener('keydown', escape, true);
    return () => { window.removeEventListener('keydown', escape, true); dialog.close(); };
  }, [onClose]);
  return <dialog ref={ref} className="about-dialog panel" aria-labelledby="about-title" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }}>
    <header className="row between"><span className="eyebrow">A home for your AI crew</span><IconButton icon="close" title="Close about" onClick={onClose} /></header>
    <BrandIcon size={96} />
    <h2 id="about-title">OpenVorld</h2>
    <p className="about-version">Version {APP_VERSION}</p>
    <p className="about-tagline">Every project is a vorld.</p>
    <p>Bring your project, assemble a crew, and turn the work into a shared adventure. Your agents have roles, workbenches, and a place in the world.</p>
    <div className="about-facts"><span>Local first</span><span>Open source</span><span>MIT licensed</span></div>
    <a className="btn primary" href={REPOSITORY} target="_blank" rel="noreferrer">Explore on GitHub <span aria-hidden="true">↗</span></a>
    <p className="about-credit">Made by DigitalDreams Lab and contributors.</p>
  </dialog>;
}
