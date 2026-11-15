// Pixel icon cut from the vorld's UI sprite sheet (the vorld's own style), by icon name.
import { useEffect, useMemo, useState } from 'react';
import { iconUrl, onAtlas } from '../game/pixels';

export function Icon({ name, size = 16, title }: { name: string; size?: number; pal?: Record<string, string>; title?: string }) {
  const [rev, setRev] = useState(0);
  useEffect(() => onAtlas(() => setRev((n) => n + 1)), []);
  const url = useMemo(() => iconUrl(name), [name, rev]);
  if (!url) return <span className="pix-ico" style={{ width: size, height: size }} />;
  return <img className="pix-ico" src={url} width={size} height={size} alt="" title={title} draggable={false} />;
}
