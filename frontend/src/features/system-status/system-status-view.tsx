import type { SystemStatusResult } from "./get-system-status";

const SUMMARY = {
  ready: { label: "All systems available", badge: "badge-success" },
  not_ready: { label: "Some services are unavailable", badge: "badge-warning" },
  unreachable: { label: "API unreachable", badge: "badge-error" },
} as const;

export function SystemStatusView({ status }: { status: SystemStatusResult }) {
  const summary = SUMMARY[status.state];
  return (
    <section aria-label="System status" className="flex flex-col gap-3">
      <span className={`badge ${summary.badge}`}>{summary.label}</span>
      {status.state !== "unreachable" && (
        <ul className="text-sm">
          {Object.entries(status.checks).map(([name, result]) => (
            <li key={name}>
              <span className="capitalize">{name}</span>: {result}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
