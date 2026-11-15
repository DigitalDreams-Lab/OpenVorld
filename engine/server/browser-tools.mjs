// The browser tools every crew member can use. One list, shared by the engine (API brains) and by the MCP bridge
// (Claude Code and Codex), so every brain sees the same tools. No dependencies: the bridge loads this file too.
export const BROWSER_SERVER = 'ov_browser';

const WATCH = 'Your own private browser; the founder can watch it in the game.';

export const BROWSER_TOOLS = [
  { name: 'browser_open', description: `Open a web page. ${WATCH} Each site needs a writ: if you do not have one, the founder is asked. You never sign in or type passwords; if a page needs a login, tell the founder. Returns the page text and the numbered links, buttons and fields.`,
    properties: { url: { type: 'string', description: 'Address, e.g. https://example.com/pricing' } }, required: ['url'] },
  { name: 'browser_read', description: 'Read the current page again (text plus numbered links, buttons and fields), optionally scrolling first.',
    properties: { scroll: { type: 'string', enum: ['down', 'up', 'top'], description: 'Scroll before reading' } }, required: [] },
  { name: 'browser_click', description: 'Click a numbered link or button from the last page reading. Returns the page afterwards.',
    properties: { id: { type: 'integer', description: 'The number in square brackets' } }, required: ['id'] },
  { name: 'browser_type', description: 'Type text into a numbered field from the last page reading, optionally pressing Enter. Never for passwords or payment details.',
    properties: { id: { type: 'integer' }, text: { type: 'string' }, submit: { type: 'boolean', description: 'Press Enter afterwards' } }, required: ['id', 'text'] },
  { name: 'browser_back', description: 'Go back one page.', properties: {}, required: [] },
];

export const isBrowserTool = (name) => BROWSER_TOOLS.some((t) => t.name === name);
