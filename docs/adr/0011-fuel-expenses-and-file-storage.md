# ADR 0011: Fuel, expenses and file storage

Status: Accepted (Phase 15)

## Decisions

- **File storage is S3-compatible, reached through `boto3`,** so hosting isn't tied to one vendor. Local development and CI use SeaweedFS, because MinIO's images weren't available to pull when this was built. Only the container differs, not the application code.
- **Files stay private.** The API checks access, then issues a 5-minute signed link. A link is requested only when someone clicks. The object key holds nothing a person typed.
- **Uploads are identified by their own bytes.** Only PDF, JPEG, PNG and WebP are accepted, up to 10 MB, whatever the name or browser claims. Files always download rather than display, so one can't run as a page on the storage host. The download header is stored with the file as well as requested on the link, because SeaweedFS ignores the link's override. Real S3 honours both.
- **The server works out fuel totals,** from quantity and price, so a client can't send a total that disagrees with them.
- **Financial records are voided, not deleted,** and the app's database role has no `DELETE` on them.
- **Approval:** someone other than the submitter approves an expense. The exception is an owner, who may have nobody else to ask. A rejection needs a reason, and editing a rejected expense resubmits it. Approved expenses are locked. Only approved expenses count as costs.
- **Multiple currencies from the start:** each record keeps its own currency, totals are grouped by currency, and nothing is converted, because that would need an exchange rate source and would present an estimate as a fact.
- **Cost per kilometre** needs two different odometer readings in the period, and otherwise says so. It divides everything spent in the period by the distance between the lowest and highest readings.
- **Consumption** is measured from one full fill to the next. A full fill without a reading breaks the chain, because the distance is unknown.
- **Drivers** record costs only for their assigned vehicle, and see only their own records and receipts.

## Consequences

- Fuel is recorded in litres or kWh. Gallons aren't supported yet.
- An upload that's never attached to a record stays in storage. A cleanup job can follow when one's needed.
- Editing or voiding a record doesn't lower the vehicle's odometer, so a mistyped high reading must be corrected on the vehicle.
- Production must supply its own private bucket. Bucket creation is automatic only outside production.
