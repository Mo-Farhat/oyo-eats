-- Live updates (Socket.IO): every order event and menu change request sends a small notification
-- on channel oyo_live once its transaction commits. The API forwards it to the right rooms; apps
-- then refetch through the normal, permission-checked endpoints. No order data in the payload
-- beyond ids, so nothing leaks to a listener.

CREATE FUNCTION oyo_live_order_payload(e order_events) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'kind', 'order',
    'orderId', o.id,
    'type', e.type,
    'tenantId', o.tenant_id,
    'customerId', o.customer_id,
    -- The assigned rider, or the rider an offer was just sent to or taken from.
    'riderIds', to_jsonb(array_remove(ARRAY[o.rider_id::text, e.payload->>'riderId'], NULL))
  )
  FROM orders o WHERE o.id = e.order_id
$$;

CREATE FUNCTION oyo_live_order_notify() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('oyo_live', oyo_live_order_payload(NEW)::text);
  RETURN NULL;
END $$;

CREATE TRIGGER live_notify AFTER INSERT ON order_events
  FOR EACH ROW EXECUTE FUNCTION oyo_live_order_notify();

CREATE FUNCTION oyo_live_menu_notify() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('oyo_live', jsonb_build_object(
    'kind', 'menu',
    'tenantId', COALESCE(NEW.tenant_id, OLD.tenant_id)
  )::text);
  RETURN NULL;
END $$;

CREATE TRIGGER live_notify AFTER INSERT OR UPDATE OR DELETE ON menu_change_requests
  FOR EACH ROW EXECUTE FUNCTION oyo_live_menu_notify();
