"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SelectInput } from "@/components/ui/field";
import { type DistanceUnit, formatDistance, fromKm } from "@/lib/distance";
import { formatMoney } from "@/lib/money";

import { COSTS_KEY, fetchVehicleCosts, UNIT_LABELS } from "./api";

const PERIODS = [
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
  { days: 365, label: "Last 12 months" },
];
const KM_PER_MILE = 1.609344;
const MS_PER_DAY = 86_400_000;

function startFor(days: number) {
  return new Date(Date.now() - days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Costs for one vehicle. Rates only appear when two odometer readings make them measurable. */
export function VehicleCostsCard({
  vehicleId,
  unit,
  canSubmit,
}: {
  vehicleId: string;
  unit: DistanceUnit;
  canSubmit: boolean;
}) {
  const [days, setDays] = useState(30);
  const costs = useQuery({
    queryKey: [...COSTS_KEY, "vehicle", vehicleId, days],
    queryFn: () => fetchVehicleCosts(vehicleId, startFor(days), ""),
  });
  const perUnit = (value: string) => Number(value) * (unit === "mi" ? KM_PER_MILE : 1);
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Costs</h2>
        <label className="flex items-center gap-2 text-sm">
          Period
          <SelectInput
            className="w-auto"
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
          >
            {PERIODS.map((period) => (
              <option key={period.days} value={period.days}>
                {period.label}
              </option>
            ))}
          </SelectInput>
        </label>
      </div>
      {costs.isPending && <p className="mt-2 text-sm opacity-75">Loading costs…</p>}
      {costs.isError && <p className="mt-2 text-sm">Costs couldn&apos;t be loaded.</p>}
      {costs.data && (
        <div className="mt-3 flex flex-col gap-2 text-sm">
          {costs.data.costs.length === 0 && <p className="opacity-75">No costs recorded in this period.</p>}
          {costs.data.costs.map((line) => (
            <p key={line.currency}>
              <span className="font-semibold tabular-nums">{formatMoney(line.total, line.currency)}</span>
              {line.cost_per_km !== null &&
                ` · ${formatMoney(perUnit(line.cost_per_km), line.currency)} per ${unit}`}
            </p>
          ))}
          {costs.data.distance_km !== null ? (
            <p className="text-xs opacity-75">
              Over {formatDistance(Number(costs.data.distance_km), unit)}, measured from{" "}
              {costs.data.readings} odometer readings.
            </p>
          ) : (
            costs.data.costs.length > 0 && (
              <p className="text-xs opacity-75">
                Cost per {unit} needs at least two different odometer readings in this period.
              </p>
            )
          )}
          {costs.data.consumption.map((row) => (
            <p key={row.unit}>
              {unit === "mi"
                ? `${Number(row.per_100_km) * KM_PER_MILE} ${UNIT_LABELS[row.unit]} per 100 mi`
                : `${Number(row.per_100_km)} ${UNIT_LABELS[row.unit]} per 100 km`}
              <span className="text-xs opacity-75">
                {" "}
                between full fills, over {fromKm(Number(row.distance_km), unit)} {unit}
              </span>
            </p>
          ))}
        </div>
      )}
      {canSubmit && (
        <div className="mt-3 flex flex-wrap gap-2">
          <ButtonLink href={`/costs/fuel/new?vehicle=${vehicleId}`} variant="outline">
            Add fuel
          </ButtonLink>
          <ButtonLink href={`/costs/expenses/new?vehicle=${vehicleId}`} variant="ghost">
            Add expense
          </ButtonLink>
        </div>
      )}
    </Card>
  );
}
