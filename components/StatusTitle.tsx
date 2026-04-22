export 
function StatusTile({
  label,
  value,
}: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-2 py-1 flex items-baseline gap-2">
      <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[hsl(var(--theme-muted))]">{label}</p>
      <p className="mt-0.5 truncate text-[10px] capitalize" title={value}>{value}</p>
    </div>
  );
}