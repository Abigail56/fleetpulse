"""platform administration

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-31 02:00:00+00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CURRENT_USER = "NULLIF(current_setting('app.current_user_id', true), '')::uuid"
FUNCTIONS = (
    "admin_require()",
    "admin_organisations(text, integer, integer)",
    "admin_users(text, integer, integer)",
    "admin_audit(text, uuid, integer, integer)",
    "admin_set_organisation_status(uuid, text, text)",
    "admin_set_user_active(uuid, boolean, text)",
    "admin_system_counts()",
)


def upgrade() -> None:
    # Each function checks for itself, so reaching one isn't enough to read across organisations.
    # Only account-level facts come back: fleets' routes, drivers and documents stay private.
    op.execute(
        f"""
        CREATE FUNCTION admin_require() RETURNS uuid
        LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
        DECLARE
            actor uuid := {CURRENT_USER};
        BEGIN
            IF actor IS NULL OR NOT EXISTS (
                SELECT 1 FROM public.users
                WHERE id = actor AND is_platform_admin AND is_active
            ) THEN
                RAISE EXCEPTION 'not_found';
            END IF;
            RETURN actor;
        END;
        $$
        """
    )
    op.execute(
        r"""
        CREATE FUNCTION admin_organisations(p_search text, p_limit integer, p_offset integer)
        RETURNS TABLE (
            id uuid, name text, slug text, country_code text, status text,
            created_at timestamptz, members bigint, vehicles bigint, plan text,
            paid_until timestamptz, total bigint
        )
        LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
        BEGIN
            PERFORM public.admin_require();
            RETURN QUERY
            SELECT o.id, o.name::text, o.slug::text, o.country_code::text, o.status::text,
                o.created_at,
                (SELECT count(*) FROM public.organisation_memberships m
                 WHERE m.organisation_id = o.id AND m.status = 'active'),
                (SELECT count(*) FROM public.vehicles v
                 WHERE v.organisation_id = o.id AND v.archived_at IS NULL),
                s.plan::text, s.paid_until, count(*) OVER ()
            FROM public.organisations o
            LEFT JOIN public.subscriptions s ON s.organisation_id = o.id
            WHERE p_search = ''
               OR o.name ILIKE '%' || replace(replace(p_search, '%', '\%'), '_', '\_') || '%'
               OR o.slug ILIKE '%' || replace(replace(p_search, '%', '\%'), '_', '\_') || '%'
            ORDER BY o.created_at DESC
            LIMIT p_limit OFFSET p_offset;
        END;
        $$
        """
    )
    op.execute(
        r"""
        CREATE FUNCTION admin_users(p_search text, p_limit integer, p_offset integer)
        RETURNS TABLE (
            id uuid, email text, full_name text, is_active boolean, is_platform_admin boolean,
            email_verified boolean, last_login_at timestamptz, created_at timestamptz,
            organisations bigint, total bigint
        )
        LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
        BEGIN
            PERFORM public.admin_require();
            RETURN QUERY
            SELECT u.id, u.email::text, u.full_name::text, u.is_active, u.is_platform_admin,
                u.email_verified_at IS NOT NULL, u.last_login_at, u.created_at,
                (SELECT count(*) FROM public.organisation_memberships m
                 WHERE m.user_id = u.id AND m.status = 'active'),
                count(*) OVER ()
            FROM public.users u
            WHERE p_search = ''
               OR u.email ILIKE '%' || replace(replace(p_search, '%', '\%'), '_', '\_') || '%'
               OR u.full_name ILIKE '%' || replace(replace(p_search, '%', '\%'), '_', '\_') || '%'
            ORDER BY u.created_at DESC
            LIMIT p_limit OFFSET p_offset;
        END;
        $$
        """
    )
    op.execute(
        r"""
        CREATE FUNCTION admin_audit(
            p_action text, p_organisation uuid, p_limit integer, p_offset integer
        )
        RETURNS TABLE (
            id uuid, occurred_at timestamptz, action text, organisation_id uuid,
            actor_user_id uuid, actor_email text, entity_type text, entity_id text,
            details jsonb, total bigint
        )
        LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
        BEGIN
            PERFORM public.admin_require();
            RETURN QUERY
            SELECT a.id, a.occurred_at, a.action::text, a.organisation_id, a.actor_user_id,
                u.email::text, a.entity_type::text, a.entity_id::text, a.details,
                count(*) OVER ()
            FROM public.audit_logs a
            LEFT JOIN public.users u ON u.id = a.actor_user_id
            WHERE (p_action = ''
                   OR a.action ILIKE '%' || replace(replace(p_action, '%', '\%'), '_', '\_') || '%')
              AND (p_organisation IS NULL OR a.organisation_id = p_organisation)
            ORDER BY a.occurred_at DESC
            LIMIT p_limit OFFSET p_offset;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE FUNCTION admin_set_organisation_status(p_id uuid, p_status text, p_reason text)
        RETURNS void
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
        DECLARE
            actor uuid := public.admin_require();
        BEGIN
            IF p_status NOT IN ('active', 'suspended') THEN
                RAISE EXCEPTION 'not_found';
            END IF;
            UPDATE public.organisations SET status = p_status, updated_at = now() WHERE id = p_id;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'not_found';
            END IF;
            INSERT INTO public.audit_logs
                (id, action, actor_user_id, organisation_id, entity_type, entity_id, details,
                 occurred_at)
            VALUES (gen_random_uuid(), 'platform.organisation_' || p_status, actor, p_id,
                'organisation', p_id::text, jsonb_build_object('reason', p_reason), now());
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE FUNCTION admin_set_user_active(p_id uuid, p_active boolean, p_reason text)
        RETURNS void
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
        DECLARE
            actor uuid := public.admin_require();
        BEGIN
            -- An admin locking themselves out would leave nobody able to undo it.
            IF p_id = actor THEN
                RAISE EXCEPTION 'own_account';
            END IF;
            UPDATE public.users SET is_active = p_active, updated_at = now() WHERE id = p_id;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'not_found';
            END IF;
            IF NOT p_active THEN
                UPDATE public.sessions SET revoked_at = now()
                WHERE user_id = p_id AND revoked_at IS NULL;
            END IF;
            INSERT INTO public.audit_logs
                (id, action, actor_user_id, entity_type, entity_id, details, occurred_at)
            VALUES (gen_random_uuid(),
                CASE WHEN p_active THEN 'platform.user_reactivated'
                     ELSE 'platform.user_deactivated' END,
                actor, 'user', p_id::text, jsonb_build_object('reason', p_reason), now());
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE FUNCTION admin_system_counts()
        RETURNS TABLE (
            organisations bigint, users bigint, vehicles bigint, active_subscriptions bigint,
            emails_waiting bigint, emails_failed bigint, automation_failed bigint,
            active_gps_feeds bigint
        )
        LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
        BEGIN
            PERFORM public.admin_require();
            RETURN QUERY SELECT
                (SELECT count(*) FROM public.organisations),
                (SELECT count(*) FROM public.users),
                (SELECT count(*) FROM public.vehicles WHERE archived_at IS NULL),
                (SELECT count(*) FROM public.subscriptions WHERE paid_until > now()),
                (SELECT count(*) FROM public.notifications WHERE email_status = 'pending'),
                (SELECT count(*) FROM public.notifications WHERE email_status = 'failed'),
                (SELECT count(*) FROM public.automation_runs WHERE status = 'failed'),
                (SELECT count(*) FROM public.gps_integrations WHERE revoked_at IS NULL);
        END;
        $$
        """
    )
    for signature in FUNCTIONS:
        op.execute(f"REVOKE ALL ON FUNCTION {signature} FROM PUBLIC")
        op.execute(f"GRANT EXECUTE ON FUNCTION {signature} TO fleetpulse_app")


def downgrade() -> None:
    for signature in reversed(FUNCTIONS):
        op.execute(f"DROP FUNCTION {signature}")
