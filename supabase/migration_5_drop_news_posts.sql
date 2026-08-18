-- Miami-Dade Commission Watch: drop news_posts (Quick Updates feature removed)
-- Run this once in the Supabase SQL editor, after migration_4.

drop table if exists public.news_posts;
