import { useStore } from '../store';
import { Icon } from './Icon';

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === 'deed' && <Icon name={t.icon ?? 'trophy'} size={32} />}
          <div>
            {t.kind === 'deed' && <div className="toast-kicker">Deed unlocked{t.xp ? ` · +${t.xp} XP` : ''}</div>}
            <div className="toast-title">{t.title}</div>
            {t.body && <div className="toast-body">{t.body}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
