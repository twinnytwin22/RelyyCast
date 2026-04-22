type FooterBadge = {
  label: string;
  value: string;
};

type AppStatusFooterProps = {
  leftStatusLabel: string;
  leftStatusValue: string;
  badges: FooterBadge[];
};
const regex = new RegExp("pattern", "i");
export default function AppStatusFooter({
  leftStatusLabel,
  leftStatusValue,
  badges,
}: Readonly<AppStatusFooterProps>) {

  const badgeValueIndicatorColorMap: Record<string, string> = {
    "Ready": "bg-green-500",
    "ready": "bg-green-500",
    "Running": "bg-green-500",
    "RUNNING": "bg-green-500",
    "Active": "bg-green-500",
    "Pending": "bg-yellow-500",
    "Provisioning": "bg-blue-500",
    "Pending Consent": "bg-yellow-500",
    "Error": "bg-red-500",
    "Unavailable": "bg-red-500",
    "Failed": "bg-red-500",
    "Beta": "bg-blue-500",
    // Add more mappings as needed
  };


  const updateAvailable = badges.some((badge) => badge.label === "Update" && badge.value === "Available");
  return (
    <footer className="flex items-center gap-2 border-t border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface))] px-2.5 py-1.5">
      <span hidden={!updateAvailable} className="rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.2em] text-[hsl(var(--theme-muted))]">
        {updateAvailable ? "Update Available" : null}
      </span>

      <span className="min-w-0 truncate text-[11px] leading-4 text-[hsl(var(--theme-muted))]">
        {null}
      </span>

      <div className="ml-auto flex items-center gap-1.5">
        {badges.map((badge) => (
          <span
            key={badge.label}
            className="inline-flex items-center gap-1 rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--theme-muted))]"
          >
            <span>{badge.label}</span>
            <span title={badge.value} className={`flex w-3 h-3 capitalize ${badgeValueIndicatorColorMap[badge.value] || "bg-blue-500"} rounded-full`}></span>

          </span>
        ))}
      </div>
    </footer>
  );
}
