-- Database-side guards that Drizzle's schema can't express: the restricted app role,
-- tenant row-level security (SEC-11), append-only tables, ledger balancing and immutable
-- paid settlements. Request code runs as oyo_app via withScope() in src/db/client.ts.

-- 1. Restricted role. The connection's owner role has BYPASSRLS, so every request switches to
--    this role with SET LOCAL ROLE. It never logs in on its own.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oyo_app') THEN
    CREATE ROLE oyo_app NOLOGIN NOBYPASSRLS;
  END IF;
  EXECUTE format('GRANT oyo_app TO %I', current_user);
END $$;

GRANT USAGE ON SCHEMA public TO oyo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO oyo_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO oyo_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO oyo_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO oyo_app;

-- 2. Scope, set per transaction by withScope(). Unset means no rows: deny by default.
CREATE FUNCTION app_is_platform() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.scope', true), '') = 'platform'
$$;

CREATE FUNCTION app_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

-- 3. Row-level security on every table.
--    Tenant tables: platform scope sees all rows; tenant scope sees only its restaurant's rows.
--    Platform tables: only platform scope; restaurant users never read them directly.
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON restaurants TO oyo_app
  USING (app_is_platform() OR id = app_tenant_id())
  WITH CHECK (app_is_platform() OR id = app_tenant_id());

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'accounts', 'restaurant_hours', 'restaurant_hour_overrides', 'menu_categories', 'menu_items',
    'modifier_groups', 'modifiers', 'menu_change_requests', 'orders', 'order_items',
    'order_events', 'payments', 'bank_slips', 'settlements', 'settlement_lines', 'reviews',
    'support_cases'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I TO oyo_app
         USING (app_is_platform() OR tenant_id = app_tenant_id())
         WITH CHECK (app_is_platform() OR tenant_id = app_tenant_id())', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY[
    'settings', 'customer_addresses', 'riders', 'rider_documents', 'rider_locations', 'batches',
    'offers', 'cash_handovers', 'ledger_transactions', 'ledger_entries', 'audit_log'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY platform_only ON %I TO oyo_app
         USING (app_is_platform()) WITH CHECK (app_is_platform())', t);
  END LOOP;
END $$;

-- 4. Append-only tables: no UPDATE, DELETE or TRUNCATE, for any role.
CREATE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['order_events', 'ledger_transactions', 'ledger_entries', 'audit_log'] LOOP
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I FROM oyo_app', t);
    EXECUTE format(
      'CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION forbid_change()', t);
    EXECUTE format(
      'CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON %I
         FOR EACH STATEMENT EXECUTE FUNCTION forbid_change()', t);
  END LOOP;
END $$;

-- 5. Double-entry: each ledger transaction has at least two entries summing to zero, checked at
--    commit so all entries can be inserted first. SECURITY DEFINER so RLS can't hide entries.
CREATE FUNCTION check_ledger_balanced() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  total bigint;
  entries int;
BEGIN
  SELECT coalesce(sum(amount_cents), 0), count(*) INTO total, entries
    FROM ledger_entries WHERE transaction_id = NEW.transaction_id;
  IF total <> 0 OR entries < 2 THEN
    RAISE EXCEPTION 'ledger transaction % does not balance (sum %, % entries)',
      NEW.transaction_id, total, entries;
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER ledger_balanced AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_ledger_balanced();

-- 6. Settlements are immutable once paid, and so are their lines.
CREATE FUNCTION forbid_change_when_paid() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'paid' THEN
    RAISE EXCEPTION 'settlement % is paid and cannot change', OLD.id;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER immutable_when_paid BEFORE UPDATE OR DELETE ON settlements
  FOR EACH ROW EXECUTE FUNCTION forbid_change_when_paid();

CREATE FUNCTION forbid_line_change_when_paid() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  parent uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.settlement_id ELSE NEW.settlement_id END;
BEGIN
  IF EXISTS (SELECT 1 FROM settlements WHERE id = parent AND status = 'paid')
     OR (TG_OP = 'UPDATE' AND EXISTS (
       SELECT 1 FROM settlements WHERE id = OLD.settlement_id AND status = 'paid')) THEN
    RAISE EXCEPTION 'settlement % is paid and its lines cannot change', parent;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER immutable_when_paid BEFORE INSERT OR UPDATE OR DELETE ON settlement_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_line_change_when_paid();
