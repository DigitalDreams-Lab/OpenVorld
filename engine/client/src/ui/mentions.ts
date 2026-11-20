export type MentionMember = { id: string; name: string; job?: string };
export type ActiveMention = { start: number; end: number; query: string };

/** Only complete an @name at the caret, never an email address or a name inside code. */
export function activeMention(text: string, caret: number): ActiveMention | null {
  const before = text.slice(0, caret);
  if ((before.match(/```/g)?.length ?? 0) % 2 || (before.replace(/```[\s\S]*?```/g, '').match(/`/g)?.length ?? 0) % 2) return null;
  const match = /(?:^|[\s([{])@([\p{L}\p{N}_ .'-]{0,40})$/u.exec(before);
  if (!match) return null;
  const start = caret - match[1].length - 1;
  const tail = /^[\p{L}\p{N}_'-]*/u.exec(text.slice(caret))?.[0] ?? '';
  return { start, end: caret + tail.length, query: match[1].toLocaleLowerCase() };
}

export function mentionSuggestions(members: MentionMember[], query: string): MentionMember[] {
  return members.filter(m => m.name.toLocaleLowerCase().startsWith(query) || m.id.toLocaleLowerCase().startsWith(query)).slice(0, 8);
}

/** The pseudo-member that completes to `@all`: in a party room it asks every member (the engine decides, see parties.mjs). */
export const EVERYONE: MentionMember = { id: 'all', name: 'all', job: 'Everyone in this party' };
export const asksEveryone = (text: string) => /(?:^|[^\p{L}\p{N}_])@(all|everyone|everybody|team|crew)(?![\p{L}\p{N}_])/iu.test(text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' '));
