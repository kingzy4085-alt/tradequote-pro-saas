ALTER TABLE public.proposals 
ADD COLUMN IF NOT EXISTS deposit_percentage numeric DEFAULT 30.0,
ADD COLUMN IF NOT EXISTS deposit_paid boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS deposit_stripe_session_id text;

CREATE TABLE IF NOT EXISTS public.material_price_book (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  item_code text NOT NULL,
  category text NOT NULL,
  description text NOT NULL,
  unit text NOT NULL,
  unit_cost numeric NOT NULL DEFAULT 0.00,
  markup_percentage numeric NOT NULL DEFAULT 15.00,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

INSERT INTO public.material_price_book (item_code, category, description, unit, unit_cost, markup_percentage)
VALUES 
  ('TECK90-3C-12', 'Cabling', '12/3 Teck90 Armoured Cable', 'm', 4.50, 20.00),
  ('TECK90-3C-10', 'Cabling', '10/3 Teck90 Armoured Cable', 'm', 6.80, 20.00),
  ('EMT-34', 'Conduit', '3/4 inch EMT Conduit', 'm', 2.10, 15.00),
  ('BC-20A-1P', 'Breakers', '20 Amp Single Pole Circuit Breaker', 'ea', 12.50, 25.00),
  ('GRD-6AWG', 'Cabling', '6 AWG Bare Copper Ground Wire', 'm', 3.20, 15.00)
ON CONFLICT DO NOTHING;