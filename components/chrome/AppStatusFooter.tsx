type FooterBadge = {
  label: string;
  value: string;
};

type AppStatusFooterProps = {
  leftStatusLabel: string;
  leftStatusValue: string;
  badges: FooterBadge[];
};

export default function AppStatusFooter({
  leftStatusLabel,
  leftStatusValue,
  badges,
}: Readonly<AppStatusFooterProps>) {
  return (
    <footer className="flex items-center gap-2 border-t border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface))] px-2.5 py-1.5">
      <span className="rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.2em] text-[hsl(var(--theme-muted))]">
        {leftStatusLabel}
      </span>

      <span className="min-w-0 truncate text-[11px] leading-4 text-[hsl(var(--theme-muted))]">
        {leftStatusValue}
      </span>

      <div className="ml-auto flex items-center gap-1.5">
        {badges.map((badge) => (
          <span
            key={badge.label}
            className="inline-flex items-center gap-1 rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--theme-muted))]"
          >
            <span>{badge.label}</span>
            <span className="text-[hsl(var(--theme-text))]">{badge.value}</span>
          </span>
        ))}
      </div>
    </footer>
  );
}
