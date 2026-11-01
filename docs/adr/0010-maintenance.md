# ADR 0010: Maintenance

Status: Accepted (Phase 14)

## Decisions

- **Schedules** repeat by date, by distance, or both, and whichever comes first decides. Being due isn't stored: it's worked out from today and the odometer each time, so it can't go out of date.
- **Work orders** go open → in progress → completed, or are cancelled before completion. Finished ones can't be edited, because they're the service history. Completed work orders are that history, so there's no second table to disagree with them.
- **Off the road:** starting work sets the vehicle to `maintenance` by default, which already blocks dispatch. It can't happen during a trip in progress. When the last such job ends, the vehicle returns to its earlier status, unless someone has changed the status in the meantime.
- **One unfinished work order per schedule,** enforced by a partial unique index, so a reminder can't be booked twice.
- **Completing scheduled work resets the schedule.** A schedule that goes by distance requires an odometer reading, because assuming one would move the next service to the wrong distance. Backdated work never moves a schedule backwards, and an older reading never winds the odometer back.
- **Unknown costs stay null,** which is different from zero. The currency is stored on each work order, so changing the organisation's currency doesn't rewrite history. Totals are grouped by currency, with no conversion.
- **The odometer is typed in,** not measured. `vehicles.odometer_recorded_at` records when, and the schedule page warns when a distance-based schedule relies on a reading over 30 days old. GPS distance isn't added automatically, because it undercounts and would present an estimate as a reading.
- **Reminders** are alerts from the scheduled sweep: a warning when due soon and critical when overdue, closing themselves once the work is done.
- **Provider details** are kept on each work order, not in a shared directory.

## Consequences

- Alert text and vehicle odometers are stored in kilometres. Screens convert to the organisation's unit, but alert messages written at the time stay in kilometres.
- Reminders appear in the app until Phase 17 adds delivery.
- Maintenance costs aren't yet combined with other costs. Phase 15 does that.
