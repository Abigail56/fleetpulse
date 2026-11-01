import { connection } from "next/server";

import { getSystemStatus } from "./get-system-status";
import { SystemStatusView } from "./system-status-view";

export async function SystemStatus() {
  // Status must be read per request, never baked into the prerendered page.
  await connection();
  return <SystemStatusView status={await getSystemStatus()} />;
}
