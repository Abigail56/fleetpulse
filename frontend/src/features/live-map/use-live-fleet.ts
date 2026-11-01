"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import {
  fetchConfig,
  fetchFleet,
  type FleetVehicleRow,
  TRACKING_KEY,
} from "@/features/tracking/api";
import { api } from "@/lib/api/client";

export type StreamPosition = Pick<
  FleetVehicleRow,
  | "recorded_at"
  | "latitude"
  | "longitude"
  | "speed_kph"
  | "heading_degrees"
  | "ignition_on"
  | "signal_status"
  | "is_simulated"
> & { vehicle_id: string };

export type StreamState = "connecting" | "live" | "polling";

export const POLL_MS = 30_000;
const CLOSE_FORBIDDEN = 4403;
const MAX_RETRY_MS = 30_000;
// The server pings every 60 seconds, so silence for this long means the connection has died.
const SILENCE_LIMIT_MS = 150_000;
const FLEET_KEY = [...TRACKING_KEY, "fleet"];

/** Older positions never replace newer ones, because messages and polls can arrive in any order. */
export function applyPositions(rows: FleetVehicleRow[], positions: StreamPosition[]) {
  const byVehicle = new Map(positions.map((position) => [position.vehicle_id, position]));
  return rows.map((row) => {
    const update = byVehicle.get(row.id);
    if (!update) return row;
    if (row.recorded_at && new Date(update.recorded_at!) <= new Date(row.recorded_at)) return row;
    return { ...row, ...update, id: row.id };
  });
}

function streamUrl() {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
  return `${base.replace(/^http/, "ws")}/api/v1/tracking/stream`;
}

export function useLiveFleet() {
  const queryClient = useQueryClient();
  const [stream, setStream] = useState<StreamState>("connecting");
  const config = useQuery({ queryKey: [...TRACKING_KEY, "config"], queryFn: fetchConfig });
  // Keeps running while the stream is up: it also picks up new vehicles and anything missed.
  // A response can have been read before a position that arrives while it's on its way.
  const received = useRef(new Map<string, StreamPosition>());
  const fleet = useQuery({
    queryKey: FLEET_KEY,
    queryFn: async () => applyPositions(await fetchFleet(), [...received.current.values()]),
    refetchInterval: POLL_MS,
  });

  useEffect(() => {
    let socket: WebSocket | null = null;
    let stopped = false;
    let attempts = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let silence: ReturnType<typeof setTimeout> | undefined;

    function expectMessage() {
      clearTimeout(silence);
      silence = setTimeout(() => socket?.close(), SILENCE_LIMIT_MS);
    }

    function connect() {
      socket = new WebSocket(streamUrl());
      expectMessage();
      socket.onmessage = (event) => {
        expectMessage();
        const message = JSON.parse(String(event.data)) as
          | { type: "ready" | "ping" }
          | { type: "positions"; positions: StreamPosition[] };
        if (message.type === "ready") {
          attempts = 0;
          setStream("live");
          // Anything sent while disconnected was missed.
          void queryClient.invalidateQueries({ queryKey: FLEET_KEY });
        } else if (message.type === "positions") {
          for (const item of message.positions) received.current.set(item.vehicle_id, item);
          const rows = queryClient.getQueryData<FleetVehicleRow[]>(FLEET_KEY);
          if (rows?.some((row) => message.positions.some((item) => item.vehicle_id === row.id))) {
            queryClient.setQueryData(FLEET_KEY, applyPositions(rows, message.positions));
          }
          if (message.positions.some((item) => !rows?.some((row) => row.id === item.vehicle_id))) {
            void queryClient.invalidateQueries({ queryKey: FLEET_KEY });
          }
        }
      };
      socket.onclose = (event) => {
        clearTimeout(silence);
        if (stopped) return;
        setStream("polling");
        if (event.code === CLOSE_FORBIDDEN) {
          // Access was taken away while connected. The next poll shows the page's error.
          void queryClient.invalidateQueries({ queryKey: FLEET_KEY });
          return;
        }
        const delay = Math.min(1000 * 2 ** attempts, MAX_RETRY_MS) * (0.5 + Math.random() / 2);
        attempts += 1;
        retry = setTimeout(() => {
          // Browsers hide why a connection was refused, and the usual reason is an access token
          // that expired. This request renews it, and sends the user to sign in if it can't.
          void api("/auth/me")
            .then(() => {
              if (!stopped) connect();
            })
            .catch(() => {
              if (!stopped) retry = setTimeout(connect, MAX_RETRY_MS);
            });
        }, delay);
      };
    }

    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearTimeout(silence);
      socket?.close();
    };
  }, [queryClient]);

  return { config, fleet, stream };
}
