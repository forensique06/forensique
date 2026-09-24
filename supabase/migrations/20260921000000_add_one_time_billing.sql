BEGIN;

-- ============================================================================
-- 1. Add explicit billing mode to plans.
--
-- Existing plans become "recurring" by default.
-- ============================================================================

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS billing_type text
  NOT NULL
  DEFAULT 'recurring';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'plans_billing_type_check'
      AND conrelid = 'public.plans'::regclass
  ) THEN
    ALTER TABLE public.plans
      ADD CONSTRAINT plans_billing_type_check
      CHECK (billing_type IN ('recurring', 'one_time'));
  END IF;
END $$;


-- ============================================================================
-- 2. Add one-time Razorpay identifiers.
--
-- Existing ₹149 Subscription rows keep these columns NULL.
-- ============================================================================

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS razorpay_order_id text;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS razorpay_payment_id text;


-- ============================================================================
-- 3. Prevent the same Razorpay Order/payment from being attached to
--    multiple subscription/entitlement rows.
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_razorpay_order_id_key
  ON public.subscriptions (razorpay_order_id)
  WHERE razorpay_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_razorpay_payment_id_key
  ON public.subscriptions (razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL;


-- ============================================================================
-- 4. Prevent concurrent payment creation for the same user.
--
-- The application already intends to allow only one payment/subscription
-- flow to be in "created" state at a time.
--
-- This protects against two simultaneous create-order requests.
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_created_per_user_key
  ON public.subscriptions (user_id)
  WHERE status = 'created';


-- ============================================================================
-- 5. Seed the new one-time plan.
--
-- It is deliberately hidden and non-purchasable at this stage.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.plans
    WHERE name = 'Test Series - 3 Months'
  ) THEN

    INSERT INTO public.plans (
      name,
      price_paise,
      duration_days,
      features,
      is_purchasable,
      is_active,
      razorpay_plan_id,
      billing_type,
      sort_order
    )
    VALUES (
      'Test Series - 3 Months',
      39900,
      90,
      '{"tests": true, "notes": false}'::jsonb,
      false,
      false,
      NULL,
      'one_time',
      4
    );

  END IF;
END $$;

COMMIT;
