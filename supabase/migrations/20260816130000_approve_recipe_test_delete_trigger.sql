-- Test-only failure-forcing mechanism for the atomicity integration test. Fires only on an
-- exact sentinel product name, so it is a safe no-op for every other row and can be left
-- installed permanently — including in a hosted environment, where the sentinel name is
-- simply never used.
CREATE OR REPLACE FUNCTION public.force_delete_failure_for_test_sentinel()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.name = '__test_force_delete_failure__' THEN
    RAISE EXCEPTION 'forced delete failure for test sentinel: %', OLD.name;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_force_delete_failure_for_test_sentinel ON public.products;

CREATE TRIGGER trg_force_delete_failure_for_test_sentinel
BEFORE DELETE ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.force_delete_failure_for_test_sentinel();
