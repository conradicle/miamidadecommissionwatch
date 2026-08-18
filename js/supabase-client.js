// Public project URL and anon key: safe to expose in client-side code.
// Row Level Security policies (see supabase/schema.sql) are what actually
// protect the data, not secrecy of this key.
var SUPABASE_URL = 'https://kpchirnlgjwdqducqdtx.supabase.co';
var SUPABASE_ANON_KEY = 'sb_publishable_pI7mYQIuFox4C9xedVB2DA_lQoV2eSx';

var supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
