import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { play } from '../audio/sfx';
import { str, toast, useStore } from '../store';
import { useConfirm } from './ConfirmDialog';

type Chat = { id: string; kind: string; title: string | null; state: string };

export function useChatThreads(wid: string, listPath: string, createPath: string, body: object) {
  const version = useStore((s) => s.threadsVersion);
  const [threads, setThreads] = useState<Chat[] | null>(null);
  const [selected, select] = useState<string | null>(null);
  const [revision, reload] = useState(0);
  const active = threads?.find((t) => t.id === selected) ?? threads?.find((t) => t.kind === 'chat') ?? threads?.[0];

  useEffect(() => {
    let live = true;
    api(listPath).then((list: Chat[]) => {
      if (!live) return;
      setThreads(list);
      select((id) => list.some((t) => t.id === id) ? id : list.find((t) => t.kind === 'chat')?.id ?? list[0]?.id ?? null);
    }).catch((e) => { if (live) toast({ kind: 'error', title: e.message }); });
    return () => { live = false; };
  }, [listPath, version, revision]);

  const newChat = async () => {
    play('ui.open');
    try {
      const chat: Chat = await api(createPath, { body });
      setThreads((list) => [chat, ...(list ?? []).filter((t) => t.id !== chat.id)]);
      select(chat.id);
      reload((n) => n + 1);
    } catch (e: any) { toast({ kind: 'error', title: e.message }); }
  };
  const deleteChat = async (id: string) => {
    await api(`/vorlds/${wid}/threads/${id}`, { method: 'DELETE' });
    setThreads((list) => list?.filter((t) => t.id !== id) ?? null);
    reload((n) => n + 1);
  };
  return { threads, active, select, newChat, deleteChat };
}

export function ThreadTabs({ threads, active, select, newChat, deleteChat }: ReturnType<typeof useChatThreads>) {
  const list = useRef<HTMLDivElement>(null);
  const add = useRef<HTMLButtonElement>(null);
  const [confirm, dialog] = useConfirm();
  const [deleting, setDeleting] = useState(false);
  const working = useStore((s) => !!(active && s.live[active.id]?.working));
  const label = str('ui.new_chat', {}, 'New chat');

  useEffect(() => {
    list.current?.querySelector('.thread-tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active?.id]);

  const remove = async (id: string, button: HTMLButtonElement) => {
    setDeleting(true);
    try {
      const confirmed = await confirm({
        title: 'Delete this chat?',
        body: 'This permanently deletes the conversation and its uploaded files.',
        ok: 'Delete chat',
        danger: true,
      });
      if (confirmed) await deleteChat(id);
    } catch (e: any) {
      toast({ kind: 'error', title: e.message });
    } finally {
      setDeleting(false);
      requestAnimationFrame(() => {
        const next = button.isConnected ? button : list.current?.querySelector<HTMLButtonElement>('.thread-tab.on button') ?? add.current;
        next?.focus();
      });
    }
  };

  return (
    <div className="thread-tabs" role="group" aria-label="Chats">
      <div className="thread-list" ref={list}>
        {(threads ?? []).map((chat) => {
          const selected = chat.id === active?.id;
          const canDelete = selected && (chat.kind === 'chat' || chat.kind === 'party');
          return <div key={chat.id} className={`thread-tab ${selected ? 'on' : ''} st-${chat.state}`}>
            <button type="button" className="thread-select" title={chat.title || label} aria-pressed={selected} onClick={() => { play('ui.click'); select(chat.id); }}>
              <span className="st-dot" aria-hidden="true" /><span className="thread-title" dir="auto">{chat.title || label}</span>
            </button>
            {canDelete && <button type="button" className="thread-delete" aria-label="Delete chat" title={working ? 'Stop this chat before deleting it' : 'Delete chat'} disabled={working || deleting} onClick={(e) => void remove(chat.id, e.currentTarget)}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 6h18M9 6V3h6v3m4 0-1 15H6L5 6m5 4v7m4-7v7" />
              </svg>
            </button>}
          </div>;
        })}
      </div>
      <button type="button" ref={add} className="btn small primary thread-add" title={label} aria-label={label} onClick={newChat}>+</button>
      {dialog && createPortal(dialog, document.body)}
    </div>
  );
}
