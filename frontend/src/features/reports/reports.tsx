"use client";

import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Download, FileBarChart } from "lucide-react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SelectInput, TextInput } from "@/components/ui/field";
import { type DistanceUnit, formatDistance } from "@/lib/distance";
import { useUrlFilters } from "@/lib/use-url-filters";

import { exportReport, fetchCatalogue, fetchReport, type ReportColumn, REPORTS_KEY } from "./api";

type Filters = { report: string; start: string; end: string };

function readFilters(params: URLSearchParams): Filters {
  return {
    report: params.get("report") ?? "utilisation",
    start: params.get("start") ?? "",
    end: params.get("end") ?? "",
  };
}

const DECIMALS = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const MONEY = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A blank means not known, or not measurable. It's never shown as zero. */
export function formatCell(value: string | number | null | undefined, column: ReportColumn, unit: DistanceUnit) {
  if (value === null || value === undefined || value === "") return "–";
  switch (column.kind) {
    case "number":
      return DECIMALS.format(Number(value));
    case "money":
      return MONEY.format(Number(value));
    case "percent":
      return `${DECIMALS.format(Number(value))}%`;
    case "distance":
      return formatDistance(Number(value), unit);
    case "date":
      return format(parseISO(String(value)), "d MMM yyyy");
    case "datetime":
      return format(new Date(String(value)), "d MMM yyyy, HH:mm");
    default:
      return String(value);
  }
}

export function Reports({ unit }: { unit: DistanceUnit }) {
  const [filters, commitFilters] = useUrlFilters(readFilters);
  const catalogue = useQuery({ queryKey: [...REPORTS_KEY, "catalogue"], queryFn: fetchCatalogue });
  const report = useQuery({
    queryKey: [...REPORTS_KEY, filters.report, filters.start, filters.end],
    queryFn: () => fetchReport(filters.report, filters.start, filters.end),
    placeholderData: keepPreviousData,
  });
  const download = useMutation({
    mutationFn: (kind: "csv" | "pdf") => exportReport(filters.report, kind, filters.start, filters.end),
    onError: (error) => toast.error(error.message),
  });

  function setFilters(changes: Partial<Filters>) {
    const next = { ...filters, ...changes };
    const params = new URLSearchParams();
    if (next.report !== "utilisation") params.set("report", next.report);
    if (next.start) params.set("start", next.start);
    if (next.end) params.set("end", next.end);
    commitFilters(next, params.toString());
  }

  const data = report.data;
  const description = catalogue.data?.find((item) => item.key === filters.report)?.description;
  const reversed = Boolean(filters.start && filters.end && filters.start > filters.end);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm">
          Report
          <SelectInput value={filters.report} onChange={(event) => setFilters({ report: event.target.value })}>
            {catalogue.data?.map((item) => (
              <option key={item.key} value={item.key}>
                {item.title}
              </option>
            ))}
            {!catalogue.data && <option value={filters.report}>Loading…</option>}
          </SelectInput>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          From
          <TextInput type="date" value={filters.start} onChange={(event) => setFilters({ start: event.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          To
          <TextInput type="date" value={filters.end} onChange={(event) => setFilters({ end: event.target.value })} />
        </label>
        <Button variant="outline" disabled={!data || download.isPending || reversed} onClick={() => download.mutate("csv")}>
          <Download aria-hidden className="size-4" />
          CSV
        </Button>
        <Button variant="outline" disabled={!data || download.isPending || reversed} onClick={() => download.mutate("pdf")}>
          <Download aria-hidden className="size-4" />
          PDF
        </Button>
      </div>
      {description && <p className="text-sm opacity-75">{description}</p>}
      {reversed && <Alert variant="error">Choose a start date before the end date.</Alert>}
      {report.isPending && <p role="status" className="text-sm opacity-75">Loading report…</p>}
      {report.isError && !reversed && (
        <div className="flex flex-col items-start gap-3">
          <Alert variant="error">{report.error.message}</Alert>
          <Button variant="outline" onClick={() => void report.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {data && !reversed && (
        <>
          <p className="text-xs opacity-75">
            {format(parseISO(data.start), "d MMM yyyy")} to {format(parseISO(data.end), "d MMM yyyy")}
          </p>
          {data.tiles.length > 0 && (
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {data.tiles.map((tile) => (
                <Card key={tile.label}>
                  <dt className="text-sm opacity-75">{tile.label}</dt>
                  <dd className="mt-1 text-xl font-bold tabular-nums">{tile.value}</dd>
                </Card>
              ))}
            </dl>
          )}
          {data.rows.length === 0 ? (
            <EmptyState icon={FileBarChart} title="Nothing to report in this period">
              Try a wider date range. Figures appear here once there are records behind them.
            </EmptyState>
          ) : (
            <Card className="p-0">
              {/* Focusable, so people using a keyboard can scroll a wide table. */}
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`${data.title} table`}>
                <table className="table table-sm">
                  <thead>
                    <tr>
                      {data.columns.map((column) => (
                        <th key={column.key} scope="col" className="whitespace-nowrap text-base-content">
                          {column.label}
                          {column.kind === "distance" ? ` (${unit})` : ""}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row, index) => (
                      <tr key={index}>
                        {data.columns.map((column) => (
                          <td
                            key={column.key}
                            className={column.kind === "text" ? undefined : "whitespace-nowrap tabular-nums"}
                          >
                            {formatCell(row[column.key], column, unit)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          {data.truncated && (
            <Alert variant="info">Only the first {data.rows.length} rows are shown. Narrow the dates to see the rest.</Alert>
          )}
          {data.notes.length > 0 && (
            <ul aria-label="About these figures" className="flex list-disc flex-col gap-1 pl-5 text-xs opacity-85">
              {data.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
