// Panel avatars come from the portrait sheet; without one, the head and shoulders of the idle frame.
import { useEffect, useRef, useState } from 'react';
import { generatedCharacter, onAtlas } from '../game/pixels';

export function Portrait({ role, size = 64, mood, kind }: { world?: any; role: string; size?: number; mood?: string; look?: any; kind?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [rev, setRev] = useState(0);
  const density = typeof window === 'undefined' ? 1 : Math.max(1, window.devicePixelRatio || 1);
  const backing = Math.ceil(size * density);
  useEffect(() => onAtlas(() => setRev((n) => n + 1)), []);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(backing / size, 0, 0, backing / size, 0, 0);
    const gen = generatedCharacter(role);
    if (!gen) return;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    if (gen.portrait) { ctx.drawImage(gen.portrait, 0, 0, size, size); return; }
    const frame = gen.frames.down[2];
    const h = Math.max(1, Math.round(gen.h * 0.62)), w = gen.w;          // head and shoulders
    const scale = Math.max(1, Math.floor(size / Math.max(w, h)));
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(frame, 0, 0, w, h, Math.floor((size - w * scale) / 2), Math.floor((size - h * scale) / 2), w * scale, h * scale);
  }, [role, size, backing, rev, kind]);
  return <canvas ref={ref} width={backing} height={backing} style={{width:size,height:size}} className={`portrait mood-${mood ?? 'neutral'}`} />;
}

/** A portrait in the same frame as the dialogue panels (ink edge, gold ring, ink ring): the big avatar of a scene. */
export function FramedPortrait({ role, size = 112, mood, kind }: { role: string; size?: number; mood?: string; kind?: string }) {
  return (
    <div className="framed-portrait">
      <Portrait role={role} size={size} mood={mood} kind={kind} />
    </div>
  );
}
