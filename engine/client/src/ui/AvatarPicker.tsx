// Choosing an agent's face from the available portrait avatars.
import { Portrait } from './Portrait';

export const AGENT_AVATARS = [
  'agent_1', 'agent_2', 'agent_3', 'agent_4', 'agent_5', 'agent_6', 'agent_7',
  'agent_8', 'agent_9', 'agent_10', 'agent_11', 'agent_12', 'agent_13', 'agent_14',
];

export function AvatarPicker({
  value,
  onChange,
  avatars = AGENT_AVATARS,
  columns,
  size = 36,
}: {
  value: string;
  onChange: (avatar: string) => void;
  avatars?: string[];
  columns?: number;
  size?: number;
}) {
  const norm = (v: string) => String(v ?? '').replace(/^portrait_/, '');
  const cur = norm(value);
  return (
    <div
      className="avatar-picker-grid"
      role="radiogroup"
      aria-label="Choose face"
      style={columns ? { gridTemplateColumns: `repeat(${columns}, auto)` } : undefined}
    >
      {avatars.map((av) => {
        const id = norm(av);
        const on = cur === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            className={`avatar-opt ${on ? 'on' : ''}`}
            title={`Face ${id.replace(/^agent_/, '')}`}
            onClick={() => onChange(id)}
          >
            <Portrait avatar={id} size={size} />
          </button>
        );
      })}
    </div>
  );
}
