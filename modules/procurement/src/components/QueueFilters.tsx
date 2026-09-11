import { Badge, Icon, type IconName, type Tone } from '@intra/ui';

export function QueueFilters<Key extends string>({ items, value, onChange }: {
  items: ReadonlyArray<{ key: Key; label: string; value: number; icon: IconName; tone: Tone; hint: string }>;
  value: Key;
  onChange: (key: Key) => void;
}) {
  return (
    <div className="grid min-w-0 grid-cols-2 gap-2 border-y border-line py-3 lg:grid-cols-4">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          aria-label={`${item.label}: ${item.value}. View details`}
          aria-pressed={value === item.key}
          title={item.hint}
          onClick={() => onChange(item.key)}
          className={`flex min-h-11 min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 ${value === item.key ? 'border-brand-500 bg-brand-500/10 text-ink' : 'border-transparent text-muted hover:bg-inset'}`}
        >
          <Icon name={item.icon} className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 font-semibold [overflow-wrap:anywhere]">{item.label}</span>
          <Badge tone={item.tone}>{item.value}</Badge>
        </button>
      ))}
    </div>
  );
}
