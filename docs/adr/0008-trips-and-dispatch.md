# ADR 0008: Trips and dispatch

Status: Accepted (Phase 12)

## Decisions

- **Lifecycle:** draft → planned → dispatched → in progress → completed. Any unfinished trip can be cancelled. Completed and cancelled are final. The allowed moves live in `services/trips.py`, and database constraints reject states that are invalid however a row got there.
- **After dispatch:** only the estimated arrival and notes can change. Anything else means cancelling and creating a new trip, so the driver's instructions never change silently.
- **Readiness is checked twice:** at dispatch and again at departure, because a vehicle can enter maintenance, or a licence can expire, in between. Being on two trips at once is stopped by the unique indexes, including when two requests race.
- **Double-booking future trips is allowed:** a vehicle can have overlapping planned trips, since plans often change. Only departure is a hard limit.
- **Drivers see their own trips only:** the new `trips.view_all` permission separates them from other roles. A driver's account is linked to their driver record on the driver page, and they can start and complete their own trips. Other people's trips return 404.
- **Distance is labelled by source:** `gps`, `simulated` or `manual`. It's measured from positions between departure and arrival, as straight lines between them, so it can read short on winding roads or with sparse reporting. Without two positions it stays unknown rather than zero.
- **History comes from the audit log:** it's already append-only and records the actor, so there's no second copy to disagree with it. Details hold field names only, because notes and places can contain personal information.
- **Route access:** `/trips/{id}/route` follows trip access, so a driver can see their own trip's route without `vehicles.view`.

## Consequences

- Origins and destinations are names. The coordinate columns stay empty until a geocoding provider is chosen, so there's no planned route or estimated distance before departure.
- Drivers aren't notified of dispatch until Phase 17 builds notifications.
