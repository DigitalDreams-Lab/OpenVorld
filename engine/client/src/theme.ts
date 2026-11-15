// The interface wears the world's palette (theme.yaml > palette). Before a world is open the CSS defaults apply.
const KEYS = ['ink', 'parchment', 'gold', 'lapis', 'turquoise', 'clay', 'danger'];
export const BODY_FONT = 'Lexend';

export function applyUiTheme(palette?: Record<string, string> | null) {
  const root = document.documentElement.style;
  for (const k of KEYS) { if (palette?.[k]) root.setProperty(`--${k}`, palette[k]); else root.removeProperty(`--${k}`); }
}
export const resetUiTheme = () => applyUiTheme(null);
