// No brain: a fixed line from the theme (strings.scripted), so a world works before any agent is set up.
export async function run({ ctx, role, onEvent }) {
  const s = ctx.theme.strings?.scripted ?? {};
  const m = ctx.member(role);
  const text = String((m?.role === 'companion' ? s.companion : s.agent) ?? '...').replace(/\{name\}/g, m?.name ?? role);
  for (const part of text.match(/.{1,12}/gs) ?? []) { onEvent({ type: 'delta', text: part }); await new Promise((r) => setTimeout(r, 15)); }
  const lang = ctx.interactions.envelope?.block_lang ?? 'ov';
  const options = m?.role === 'companion' ? s.options ?? [] : [];
  return { sessionId: null, text: text + (options.length ? `\n\n\`\`\`${lang}\n${JSON.stringify({ options, mood: 'happy' })}\n\`\`\`` : '') };
}
