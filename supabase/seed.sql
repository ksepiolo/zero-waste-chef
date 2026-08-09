-- Test user: test@example.com / Test1234!
-- instance_id and aud are required: GoTrue looks users up by (instance_id, aud, email).
INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  role,
  -- GoTrue scans these into non-nullable strings; NULL makes sign-in fail with
  -- "Database error querying schema".
  confirmation_token,
  recovery_token,
  email_change,
  email_change_token_new,
  email_change_token_current,
  phone_change_token,
  reauthentication_token
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000001',
  'authenticated',
  'test@example.com',
  crypt('Test1234!', gen_salt('bf')),
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  false,
  'authenticated',
  '',
  '',
  '',
  '',
  '',
  '',
  ''
) ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (
  id,
  user_id,
  provider_id,
  provider,
  identity_data,
  last_sign_in_at,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'test@example.com',
  'email',
  '{"sub":"00000000-0000-0000-0000-000000000001","email":"test@example.com","email_verified":true}',
  now(),
  now(),
  now()
) ON CONFLICT (provider, provider_id) DO NOTHING;
