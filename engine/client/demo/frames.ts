// Frames of Sage's browser in the demo: a small made-up page (bee-facts.example), drawn on a canvas and sent as JPEG
// like the real crew browser's live frames, so the balloon over Sage shows a page loading and scrolling.
const W = 1024, H = 640;

export const BEE_FACTS_URL = 'https://bee-facts.example/fun';

function base(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#fffaf0'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#f4c542'; ctx.fillRect(0, 0, W, 86);
  ctx.fillStyle = '#2b2118'; ctx.font = '700 34px Lexend, sans-serif'; ctx.fillText('🐝 Bee Facts', 40, 56);
  ctx.font = '500 18px Lexend, sans-serif'; ctx.fillText('Facts  ·  Flowers  ·  Hives', 690, 52);
}
function card(ctx: CanvasRenderingContext2D, y: number, title: string, body: string, glow = false) {
  ctx.fillStyle = glow ? '#fff1b8' : '#ffffff'; ctx.strokeStyle = glow ? '#e0a400' : '#eadfc8'; ctx.lineWidth = glow ? 4 : 2;
  ctx.beginPath(); ctx.roundRect(40, y, W - 80, 128, 14); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#2b2118'; ctx.font = '700 26px Lexend, sans-serif'; ctx.fillText(title, 70, y + 48);
  ctx.fillStyle = '#5d5145'; ctx.font = '400 20px Lexend, sans-serif'; ctx.fillText(body, 70, y + 90);
}
const FACTS: [string, string][] = [
  ['🌼 Bees see colors we can’t', 'They see ultraviolet light, so many flowers have hidden patterns for them.'],
  ['💃 Bees dance to share news', 'A little “waggle dance” tells friends where the best flowers are.'],
  ['🍯 Honey never goes bad', 'Kept closed and dry, honey stays good for a very long time.'],
  ['🌻 Sunflowers are bee magnets', 'Big, open flowers make it easy for bees to land and eat.'],
];

/** One frame: 0 = page loading, 1 = loaded, 2 = scrolled to the dance fact (highlighted). */
export function frame(step: 0 | 1 | 2): string {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  base(ctx);
  if (step === 0) {
    ctx.fillStyle = '#eadfc8';
    for (const [y, w] of [[140, 520], [190, 760], [232, 690], [320, 880], [470, 880]]) { ctx.beginPath(); ctx.roundRect(40, y, w, y > 300 ? 120 : 22, 10); ctx.fill(); }
  } else {
    const shift = step === 2 ? 150 : 0;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 86, W, H - 86); ctx.clip();
    ctx.fillStyle = '#2b2118'; ctx.font = '700 40px Lexend, sans-serif'; ctx.fillText('Fun facts about bees', 40, 160 - shift);
    ctx.fillStyle = '#7a6a58'; ctx.font = '400 20px Lexend, sans-serif'; ctx.fillText('Small wings, big hearts. Four things that will make you smile.', 40, 200 - shift);
    FACTS.forEach(([t, b], i) => card(ctx, 236 + i * 148 - shift, t, b, step === 2 && i === 1));
    ctx.restore();
  }
  return c.toDataURL('image/jpeg', 0.82).split(',')[1];
}

export const PAGE_TEXT = `Fun facts about bees
- Bees see colors we can't (ultraviolet)
- Bees dance to share news: the "waggle dance" tells friends where the best flowers are
- Honey never goes bad when it is kept closed and dry
- Sunflowers are bee magnets`;
