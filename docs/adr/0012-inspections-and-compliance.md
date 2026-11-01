# ADR 0012: Inspections, documents and compliance

Status: Accepted (Phase 16)

## Decisions

- **Inspections copy their checklist.** Each one stores the labels and results it was done with, so later template edits can't rewrite history. They can't be changed afterwards: the app's database role has no `UPDATE` on them.
- **No check defaults to a pass.** Every item needs an explicit answer, on the screen and in the API.
- **Failed checks become defects:** a failed critical item makes a critical defect, and any other failure a minor one.
- **A critical open defect stops the vehicle.** It blocks dispatch and departure until the defect is resolved. A work order created from a defect resolves it on completion, and cancelling the work order leaves it open.
- **Driver documents are sensitive,** such as licences and medical records. They need `drivers.view_sensitive`. Managing vehicle paperwork doesn't grant access to them, so a maintenance manager can't see them. Drivers can see their own through `/compliance/my-documents`.
- **File access follows the record.** The signed-link endpoint decides by file purpose and by what the file is attached to, and it checks each time a link is requested.
- **A document with no expiry date is "no expiry", never "valid".** Nothing has confirmed it's in date.
- **Drivers** inspect and report on their assigned vehicle only, and see only their own inspections and defects.

## Consequences

- Reminders start at a fixed 30 days before expiry, and appear in the app only until Phase 17.
- Renewing means editing the expiry date or archiving and adding a new document. There's no version history beyond the audit log.
- A linked driver's licence alert and a licence uploaded here are separate, so both can appear.
