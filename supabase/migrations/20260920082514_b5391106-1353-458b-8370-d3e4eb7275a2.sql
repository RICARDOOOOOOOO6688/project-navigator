CREATE TABLE public.phone_accounts (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT ON public.phone_accounts TO authenticated;
GRANT ALL ON public.phone_accounts TO service_role;

ALTER TABLE public.phone_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own phone account"
ON public.phone_accounts
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);