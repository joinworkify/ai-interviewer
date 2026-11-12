export function MicLevel({ level }: { level: number }) {
  const pct = Math.round(level * 100);
  return (
    <div
      role="meter"
      aria-label="Microphone level"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
    >
      <div className="h-full bg-green-600 transition-[width] duration-75" style={{ width: `${pct}%` }} />
    </div>
  );
}
