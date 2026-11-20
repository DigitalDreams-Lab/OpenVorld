import { useStore } from '../store';
import { Icon } from './Icon';

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>      {/* prefixed: a bare "deed" or "error" class picks up other screens' styles */}
          {t.kind === 'deed' && <Icon name={t.icon ?? 'trophy'} size={32} />}
          <div>
            {t.kind === 'deed' && <div className="toast-kicker">Deed unlocked{t.xp ? ` · +${t.xp} XP` : ''}</div>}
            <div className="toast-title" dir="auto">{t.title}</div>
            {t.body && <div className="toast-body" dir="auto">{t.body}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
