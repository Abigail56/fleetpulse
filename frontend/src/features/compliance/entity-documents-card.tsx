"use client";

import { useQuery } from "@tanstack/react-query";

import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { COMPLIANCE_KEY, fetchDocuments } from "./api";
import { DocumentRow } from "./compliance-overview";

/** Shown on vehicle and driver pages. */
export function EntityDocumentsCard({
  vehicleId,
  driverId,
  canManage,
}: {
  vehicleId?: string;
  driverId?: string;
  canManage: boolean;
}) {
  const documents = useQuery({
    queryKey: [...COMPLIANCE_KEY, "documents", "entity", vehicleId, driverId],
    queryFn: () => fetchDocuments({ vehicle: vehicleId, driver: driverId }),
  });
  const query = vehicleId ? `vehicle=${vehicleId}` : `driver=${driverId}`;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Documents</h2>
        {canManage && (
          <ButtonLink href={`/compliance/documents/new?${query}`} variant="outline">
            Add document
          </ButtonLink>
        )}
      </div>
      {documents.isPending && <p className="mt-2 text-sm opacity-75">Loading documents…</p>}
      {documents.isError && <p className="mt-2 text-sm">Documents couldn&apos;t be loaded.</p>}
      {documents.data?.length === 0 && <p className="mt-2 text-sm opacity-75">No documents yet.</p>}
      {documents.data && documents.data.length > 0 && (
        <ul aria-label="Documents" className="mt-3 divide-y divide-base-300 border-y border-base-300">
          {documents.data.map((document) => (
            <DocumentRow key={document.id} document={document} canManage={canManage} />
          ))}
        </ul>
      )}
    </Card>
  );
}
