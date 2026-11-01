# FLEETPULSE — MASTER PRODUCT DEVELOPMENT PROMPT

## 1. YOUR ROLE

Act as a senior software architect, principal full-stack engineer, backend engineer, frontend engineer, database architect, DevOps engineer, security engineer, and product designer.

Your responsibility is to help build FleetPulse into a commercial-grade, production-oriented SaaS platform.

Do not treat this as a simple portfolio project, demonstration dashboard, or collection of disconnected CRUD pages.

Build it as a real software product that businesses can eventually subscribe to and depend on for their daily fleet operations.

Think carefully about architecture, security, scalability, maintainability, user experience, reliability, and business requirements before implementing anything.

## 2. PRODUCT IDENTITY

Product name: FleetPulse

Tagline:

Every Vehicle. Every Journey. Under Control.

Product category:

Fleet Management, GPS Vehicle Tracking, Fleet Intelligence and Operations Automation SaaS.

Product vision:

FleetPulse helps organisations monitor vehicles, manage drivers, track journeys, control operational costs, schedule maintenance, monitor compliance, receive alerts, and automate fleet operations from one central platform.

The product should give fleet managers visibility into what is happening across their fleets and help them make better operational decisions.

## 3. TARGET CUSTOMERS

Design the platform to support:

- Logistics and delivery companies.
- Transportation businesses.
- Distribution companies.
- Construction companies.
- Corporate organisations.
- Car rental companies.
- Schools and institutions operating buses.
- Field service companies.
- Government fleet operators.
- Small, medium and large fleet businesses.

The architecture should support businesses managing approximately 5 vehicles to thousands of vehicles.

## 4. CORE PRODUCT VALUE

FleetPulse must deliver three major capabilities.

### A. Fleet Visibility

- Know where vehicles are.
- View live GPS locations when connected to a real tracking provider.
- View last-known vehicle locations.
- Monitor vehicle movement.
- Review trip history.
- Monitor vehicle status.
- Track routes and journeys.

### B. Fleet Intelligence

- Monitor vehicle utilisation.
- Identify overdue maintenance.
- Monitor fuel consumption and expenses.
- Detect operational anomalies.
- Monitor driver behaviour when reliable data is available.
- Generate useful reports.
- Provide actionable operational insights.

### C. Operational Automation

- Generate alerts automatically.
- Schedule maintenance reminders.
- Monitor document and insurance expiry.
- Trigger notifications based on defined rules.
- Create follow-up tasks.
- Maintain audit records of important operations.

Do not create fake intelligence, simulated live data presented as real, or meaningless dashboard statistics.

## 5. TECHNOLOGY STACK

Use the following technology stack unless a documented technical reason requires an alternative.

### Frontend

- Next.js App Router.
- React.
- TypeScript.
- Tailwind CSS.
- DaisyUI.
- Lucide React.
- TanStack Query.
- TanStack Table.
- React Hook Form.
- Zod.
- Recharts.
- Leaflet.
- React Leaflet.
- @xyflow/react for visual workflow automation.
- date-fns.
- Sonner.
- clsx.
- tailwind-merge.

Testing:

- Vitest.
- React Testing Library.
- Playwright.

### Backend

- Python.
- FastAPI.
- SQLModel.
- SQLAlchemy.
- Pydantic.
- Pydantic Settings.
- Alembic.
- PostgreSQL.
- PostGIS.
- Psycopg.
- Argon2.
- PyJWT.
- cryptography.
- Redis.
- Celery.
- Celery Beat.
- Native FastAPI/Starlette WebSockets.
- HTTPX.
- tenacity.
- structlog.

Testing and quality:

- Pytest.
- Ruff.
- Mypy.

### Infrastructure

- Docker.
- Docker Compose.
- GitHub Actions.
- S3-compatible object storage.
- PostgreSQL with PostGIS.
- Redis.

Use appropriate environment-specific configuration.

Separate development and production dependencies.

Pin compatible dependency versions and maintain a reliable lockfile.

Do not install unnecessary packages.

Before adding a library, explain why it is needed.

## 6. ARCHITECTURE REQUIREMENTS

Build a modular, maintainable architecture.

The backend must have clear separation between:

- API routes.
- Request and response schemas.
- Database models.
- Business services.
- Repository/data-access logic where useful.
- Authentication and authorisation.
- Background jobs.
- External integrations.
- Configuration.
- Logging.
- Tests.

Use SQLModel as the primary ORM modelling interface.

Use Pydantic schemas for request validation and response contracts.

Use Alembic for database migrations.

Never rely on automatic table creation during production startup.

Use PostgreSQL and PostGIS for location-aware data and spatial queries.

Start with synchronous SQLModel/Psycopg database operations unless a documented requirement justifies an asynchronous design. Do not mix synchronous and asynchronous database sessions carelessly.

Use Redis and Celery for appropriate background tasks.

Use native WebSockets for realtime communication unless another approach is technically justified.

Build reusable frontend components and maintain clear separation between:

- Pages.
- Layouts.
- Components.
- Features.
- Hooks.
- API clients.
- Types.
- Utilities.
- State management.

Do not place the entire application inside a few oversized files.

## 7. MULTI-TENANT SAAS ARCHITECTURE

FleetPulse must support multiple independent organisations.

Each organisation must have its own:

- Users and memberships.
- Vehicles.
- Drivers.
- Trips.
- Maintenance records.
- Expenses.
- Documents.
- Alerts.
- Reports.
- Settings.
- Subscription and billing information.

A user may belong to more than one organisation.

Implement organisation membership and role-based access control.

Tenant isolation must be enforced in the backend and database access layer.

Never rely on frontend filtering as a security boundary.

A user from Organisation A must never access Organisation B's protected records by changing an ID in an API request.

Test tenant isolation explicitly.

## 8. CUSTOM AUTHENTICATION

FleetPulse must own its authentication system.

Do not use Clerk, Auth0, Firebase Authentication, Supabase Authentication, or another hosted authentication service as the primary authentication provider.

Implement custom authentication using FastAPI, PostgreSQL, Argon2, JWT, HTTP-only cookies, and database-backed sessions.

Required features:

- User registration.
- Email verification.
- Login.
- Logout.
- Logout from all devices.
- Forgot password.
- Password reset.
- Access token renewal.
- Refresh token rotation.
- Session listing.
- Individual session revocation.
- Account security controls.

### Password security

Use Argon2id for password hashing.

Never store plaintext passwords.

Never log passwords.

### Access tokens

Use short-lived JWT access tokens, with an initial target of approximately 15 minutes.

Validate:

- Signature.
- Allowed signing algorithm.
- Expiration.
- Issuer.
- Audience.
- Relevant token claims.

Use minimal claims such as:

- Subject/user ID.
- Session ID.
- Issued-at time.
- Expiration time.
- Issuer.
- Audience.
- Unique token ID where appropriate.

### Refresh tokens

Use cryptographically secure refresh tokens.

Set an initial target lifetime of approximately 14 days, configurable through environment settings.

Implement:

- Refresh token rotation.
- Hashed refresh token storage.
- Token family tracking.
- Reuse detection.
- Session revocation.
- Expiry.
- Secure renewal.

### Browser cookie security

Use HTTP-only cookies for browser authentication.

Suggested cookie names:

- fleetpulse_access.
- fleetpulse_refresh.

Cookies must have appropriate:

- HttpOnly.
- Secure in production.
- SameSite.
- Path.
- Domain where applicable.
- Expiry.

Never store authentication tokens in localStorage or sessionStorage.

Implement appropriate CSRF protection.

Use strict, explicitly configured CORS origins.

Never combine wildcard origins with credentialed requests.

### Database-backed sessions

Store session records in PostgreSQL.

Include appropriate fields such as:

- Session ID.
- User ID.
- Organisation context where appropriate.
- Refresh token hash or token-family metadata.
- Created timestamp.
- Last activity timestamp.
- Expiration timestamp.
- Revocation timestamp.
- Device/browser information.
- IP metadata only where justified and with documented retention.

Users must be able to view and revoke their active sessions.

### Authentication endpoints

Use a versioned API structure such as:

/api/v1/auth/register
/api/v1/auth/login
/api/v1/auth/refresh
/api/v1/auth/logout
/api/v1/auth/logout-all
/api/v1/auth/me
/api/v1/auth/sessions
/api/v1/auth/sessions/{session_id}
/api/v1/auth/verify-email
/api/v1/auth/forgot-password
/api/v1/auth/reset-password

Use generic responses where necessary to prevent account enumeration.

Implement login rate limiting.

Handle session invalidation after password changes and resets.

Separate authentication from authorisation.

## 9. ROLE-BASED ACCESS CONTROL

Support organisation roles such as:

- Owner.
- Administrator.
- Fleet Manager.
- Dispatcher.
- Maintenance Manager.
- Finance Manager.
- Driver.
- Read Only.

Permissions must be explicit and enforced by backend services and API dependencies.

Do not assume that hiding a button or page protects an operation.

Provide a separate platform administration role for authorised FleetPulse internal administrators.

Organisation administrators must not automatically become FleetPulse platform administrators.

## 10. PRODUCT MODULES

Build the product in phases.

### Module 1: Marketing Website

Create a polished public website with:

- Home.
- Features.
- Solutions.
- Pricing.
- About.
- Contact.
- Login.
- Registration.

Explain FleetPulse's value clearly.

Include strong calls to action.

Use realistic product screenshots or carefully labelled illustrations.

Do not display fake customer testimonials, fake client logos, or unsupported performance claims.

### Module 2: Dashboard

Create a professional fleet operations dashboard containing:

- Total vehicles.
- Active vehicles.
- Idle vehicles.
- Vehicles under maintenance.
- Active trips.
- Driver availability.
- Upcoming maintenance.
- Expiring documents.
- Recent alerts.
- Fuel and operating expenses.
- Fleet utilisation.
- Operational trends.

Every metric must come from real application data.

Provide sensible empty states when an organisation has no records.

### Module 3: Vehicle Management

Implement:

- Add vehicle.
- Edit vehicle.
- View vehicle details.
- Archive or deactivate vehicle.
- Vehicle registration number.
- Make and model.
- Year.
- Vehicle type.
- VIN.
- Fuel type.
- Current odometer.
- Assigned driver.
- Ownership information.
- Tracking device information.
- Operational status.
- Maintenance history.
- Document records.

Prevent duplicate vehicle registrations within the appropriate organisation scope.

### Module 4: Driver Management

Implement:

- Driver profiles.
- Contact information.
- Licence information.
- Licence expiry.
- Driver status.
- Vehicle assignments.
- Trip history.
- Performance information where supported.
- Documents.
- Driver availability.

Protect sensitive personal information.

### Module 5: GPS Tracking

Implement an extensible GPS provider integration architecture.

Support:

- Vehicle coordinates.
- Latitude and longitude.
- Speed.
- Heading.
- Timestamp.
- Device identifier.
- Ignition state where supported.
- GPS signal status.
- Last-known location.
- Historical telemetry.
- Trip reconstruction.

Build provider adapters instead of tightly coupling the product to one tracking vendor.

Do not claim to provide real live tracking unless connected to an actual data source.

Simulated GPS must be clearly labelled and disabled in production by default.

### Module 6: Live Fleet Map

Provide:

- Interactive map.
- Vehicle markers.
- Vehicle status indicators.
- Vehicle selection.
- Location details.
- Last update timestamp.
- Search and filters.
- Vehicle clustering where useful.
- Trip route visualisation.
- Map refresh and realtime updates.

Handle stale GPS data honestly.

### Module 7: Trips and Dispatch

Implement:

- Trip creation.
- Trip assignment.
- Driver assignment.
- Vehicle assignment.
- Origin.
- Destination.
- Planned departure.
- Estimated arrival.
- Actual departure.
- Actual arrival.
- Trip status.
- Distance.
- Trip history.
- Dispatch notes.

Use a controlled trip lifecycle.

### Module 8: Geofencing and Alerts

Implement:

- Geofence creation.
- Circular and polygonal geofences.
- Entry events.
- Exit events.
- Speed alerts where reliable data exists.
- Unusual movement alerts.
- Vehicle offline alerts.
- Maintenance alerts.
- Document expiry alerts.
- Alert acknowledgement.
- Alert history.

### Module 9: Maintenance

Implement:

- Maintenance schedules.
- Preventive maintenance.
- Corrective maintenance.
- Service history.
- Work orders.
- Maintenance reminders.
- Odometer-based scheduling.
- Time-based scheduling.
- Maintenance expenses.
- Service provider details.

### Module 10: Fuel and Expenses

Implement:

- Fuel transactions.
- Fuel quantity.
- Fuel price.
- Currency.
- Odometer.
- Fuel station.
- Vehicle expenses.
- Expense categories.
- Receipt attachments.
- Expense approval.
- Cost-per-kilometre calculations where data permits.

Support multiple currencies from the beginning.

Do not assume every customer operates in Nigeria.

### Module 11: Inspections, Documents and Compliance

Implement:

- Vehicle inspections.
- Inspection templates.
- Inspection results.
- Defect reports.
- Vehicle documents.
- Driver documents.
- Insurance.
- Roadworthiness.
- Licence information.
- Expiry dates.
- Compliance reminders.

Use private object storage for sensitive documents.

Use short-lived signed URLs for authorised file access.

### Module 12: Notifications

Support:

- In-app notifications.
- Email notifications.
- Configurable notification preferences.
- Notification history.
- Read/unread status.
- Relevant operational alerts.

Keep notification delivery reliable and retryable.

### Module 13: Automation

Build a rules-based automation engine.

Examples:

- If insurance expires within 30 days, notify the fleet manager.
- If a vehicle exceeds its maintenance threshold, create a maintenance task.
- If a vehicle enters a restricted geofence, generate an alert.
- If a vehicle stops reporting GPS data, notify an authorised user.

Include:

- Trigger.
- Conditions.
- Actions.
- Execution history.
- Error handling.
- Retry policies.
- Enable/disable controls.

Use background jobs for suitable automation tasks.

Do not execute arbitrary user-supplied code.

### Module 14: Reports and Analytics

Implement reports for:

- Vehicle utilisation.
- Trip performance.
- Driver activity.
- Fuel consumption.
- Operating expenses.
- Maintenance costs.
- Fleet performance.
- Compliance.
- Alerts.

Support date filtering and organisation scoping.

Provide CSV and PDF exports where appropriate.

### Module 15: Integrations and Billing

Build integration adapters for:

- GPS tracking providers.
- Email providers.
- Object storage.
- Payment providers.
- External business systems where justified.

Implement subscriptions and billing with:

- Plans.
- Subscription status.
- Billing history.
- Usage limits.
- Payment records.
- Webhook handling.

Verify payment webhooks server-side.

Use idempotency for payment processing.

Never trust a browser redirect as proof of successful payment.

Do not claim that an external integration is operational until it has been configured and tested.

### Module 16: Platform Administration

Provide a protected internal administration area for authorised FleetPulse administrators.

Include:

- Organisation overview.
- User overview.
- Subscription overview.
- System health.
- Background job health.
- Integration status.
- Support tools.
- Audit logs.

Protect this area independently from organisation-level administration.

### Module 17: Audit Logging

Record important security and operational events, including:

- Login and logout.
- Failed authentication attempts where appropriate.
- Password changes.
- Session revocations.
- User and role changes.
- Vehicle changes.
- Driver changes.
- Trip changes.
- Financial record changes.
- Administrative operations.

Do not log passwords, raw tokens, or unnecessary sensitive information.

## 11. FRONTEND DESIGN REQUIREMENTS

The user interface must look like a premium, modern commercial SaaS product.

Design direction:

- Clean.
- Professional.
- Modern.
- Enterprise-ready.
- Responsive.
- Consistent.
- Easy to navigate.
- Data-focused without visual clutter.

Create a coherent design system.

Use:

- Consistent typography.
- Clear spacing.
- Reusable cards.
- Accessible forms.
- Responsive tables.
- Useful filters.
- Meaningful status indicators.
- Good empty states.
- Loading states.
- Error states.
- Confirmation dialogs.
- Toast notifications.
- Accessible keyboard interactions.

The interface should feel like a product that businesses would trust with their fleet operations.

Do not overuse gradients, glassmorphism, unnecessary animations, or decorative elements.

Do not make the interface look like a generic AI-generated dashboard.

Ensure desktop, tablet and mobile usability.

## 12. DATABASE DESIGN

Design a relational database with appropriate relationships and constraints.

Potential core entities include:

- users
- organisations
- organisation_memberships
- roles
- permissions
- sessions
- email_verification_tokens
- password_reset_tokens
- vehicles
- drivers
- vehicle_assignments
- tracking_devices
- vehicle_locations
- trips
- geofences
- alerts
- maintenance_records
- work_orders
- fuel_transactions
- expenses
- inspections
- documents
- notifications
- automation_rules
- automation_executions
- subscriptions
- payments
- audit_logs

These are starting concepts, not a command to create every table immediately.

Review relationships, indexes, constraints, tenant isolation, retention, and expected data volume before implementation.

Use appropriate database indexes and PostGIS spatial indexes.

Do not store large telemetry histories without considering retention and partitioning strategies.

Use migrations for schema changes.

## 13. SECURITY REQUIREMENTS

Security must be part of every phase.

Implement:

- Secure password hashing.
- Authentication and authorisation.
- Tenant isolation.
- Role-based permissions.
- CSRF protection.
- Strict CORS.
- Rate limiting.
- Input validation.
- Secure file uploads.
- Private file access.
- Secret management.
- Audit logging.
- Secure error responses.
- SQL injection prevention through safe database access.
- Protection against insecure direct object references.
- Webhook signature verification.
- Idempotent external event processing.

Never expose secrets in frontend code.

Never commit real credentials.

Use environment variables and provide `.env.example` files containing placeholders.

## 14. TESTING REQUIREMENTS

Write tests throughout development.

Backend tests should cover:

- Authentication.
- Authorisation.
- Tenant isolation.
- API validation.
- Database behaviour.
- Business rules.
- Background jobs.
- External integration boundaries.

Frontend tests should cover:

- Forms.
- Components.
- Navigation.
- Loading states.
- Error states.
- Important user workflows.

Use end-to-end tests for critical flows.

Test security-sensitive functionality explicitly.

Do not report tests as passing unless they were actually executed.

## 15. DEVELOPMENT AND DELIVERY RULES

Follow these rules strictly.

1. Inspect the existing repository before modifying it.
2. Never delete or overwrite existing working code without explaining why and obtaining approval where the change is destructive.
3. Preserve useful existing implementation.
4. Work in small, verifiable phases.
5. Do not implement every module in one operation.
6. Do not skip database migrations.
7. Do not skip security.
8. Do not use fake production data.
9. Do not create buttons that do nothing.
10. Do not leave important workflows as frontend-only demonstrations.
11. Do not hardcode secrets.
12. Do not silently ignore errors.
13. Do not claim a deployment or integration succeeded unless verified.
14. Document architectural decisions.
15. Keep the README and environment examples updated.
16. Use clear, maintainable code.
17. Run relevant tests and quality checks after implementation.
18. Fix failures before declaring a phase complete.
19. Identify unresolved issues honestly.
20. Stop after each phase and wait for approval before continuing.

## 16. PHASED DEVELOPMENT ROADMAP

Follow this implementation order:

PHASE 0 — Repository inspection and implementation assessment.

PHASE 1 — Project foundation and development environment.

PHASE 2 — Database architecture, models and migrations.

PHASE 3 — Custom authentication and session security.

PHASE 4 — Organisations, multi-tenancy and RBAC.

PHASE 5 — Design system and public marketing website.

PHASE 6 — Frontend authentication.

PHASE 7 — Protected application shell and dashboard.

PHASE 8 — Vehicle management.

PHASE 9 — Driver management.

PHASE 10 — GPS tracking backend and telemetry ingestion.

PHASE 11 — Live fleet map.

PHASE 12 — Trips and dispatch.

PHASE 13 — Geofencing and alerts.

PHASE 14 — Maintenance management.

PHASE 15 — Fuel and expense management.

PHASE 16 — Inspections, documents and compliance.

PHASE 17 — Notifications, background jobs and automation.

PHASE 18 — Reports and analytics.

PHASE 19 — External integrations, subscriptions and billing.

PHASE 20 — Platform administration and support.

PHASE 21 — Security review, testing and performance improvements.

PHASE 22 — Deployment and production readiness.

## 17. PHASE ACCEPTANCE PROCESS

At the end of every phase, provide:

1. What was implemented.
2. Files created.
3. Files modified.
4. Database changes.
5. API endpoints created or modified.
6. Frontend workflows completed.
7. Tests executed.
8. Exact commands executed.
9. Actual test and lint results.
10. Known limitations.
11. Security considerations.
12. Outstanding issues.
13. Recommended next phase.

Use these status labels:

- Not Started.
- In Progress.
- Implemented.
- Tested.
- Verified in Staging.
- Production Ready.

Do not mark a feature Production Ready simply because the code exists.

## 18. IMMEDIATE INSTRUCTION

For now, your task is to understand this complete product specification.

Do not begin implementing all phases.

Do not generate the entire application at once.

Do not overwrite existing files.

We will provide the implementation prompts one phase at a time.

Acknowledge the product requirements and prepare to begin with PHASE 0: Repository Inspection.

Wait for the separate Phase 0 prompt before making project changes.
