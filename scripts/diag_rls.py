#!/usr/bin/env python3
"""Diagnose current RLS state of every relevant Forensique table."""
import os, sys, json, urllib.request

def load_env(path='/app/.env'):
    env = {}
    for line in open(path):
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line: continue
        k, v = line.split('=', 1)
        env[k] = v
    return env

env = load_env()
url = env['NEXT_PUBLIC_SUPABASE_URL']
# Try both possible env var names
key = env.get('SUPABASE_SERVICE_ROLE_KEY') or env.get('SUPABASE_SECRET_KEY')

# We'll query pg_class + pg_policy via the exposed information_schema through PostgREST.
# PostgREST doesn't expose pg_class directly by default — use RPC via the exec pattern, or
# just try each table with anon-key and see what happens. Instead, easier: use service key
# to query pg_catalog view via a plain REST call to an RPC we know exists... none.
#
# Fallback: probe each table with the anon key (which is subject to RLS) and see what's blocked.

anon = env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']

TABLES_SHOULD_BE_OPEN = [
    'tests', 'units', 'topics', 'subtopics',
    'question_options', 'question_statements', 'question_match_items',
    'passages', 'questions', 'plans',
]
TABLES_USER_OWNED = ['test_attempts', 'attempt_responses', 'bookmarks', 'profiles', 'subscriptions']
TABLES_RLS_ENFORCED = ['answers', 'notes']

def probe(table, api_key):
    req = urllib.request.Request(
        f'{url}/rest/v1/{table}?select=*&limit=1',
        headers={'apikey': api_key, 'Authorization': f'Bearer {api_key}', 'Accept': 'application/json'}
    )
    try:
        r = urllib.request.urlopen(req, timeout=10)
        body = r.read().decode()
        return r.status, body[:200]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:200]
    except Exception as e:
        return None, str(e)[:200]

print('== Anon-key probe (RLS enforced) ==')
for t in TABLES_SHOULD_BE_OPEN + TABLES_USER_OWNED + TABLES_RLS_ENFORCED:
    status, body = probe(t, anon)
    tag = ''
    if t in TABLES_SHOULD_BE_OPEN: tag = '[should be open]'
    elif t in TABLES_USER_OWNED: tag = '[user-owned]'
    else: tag = '[gated]'
    print(f'{t:32} {tag:18} status={status}  {body[:80]}')

if key:
    print('\n== Service-key probe (bypasses RLS) ==')
    for t in TABLES_SHOULD_BE_OPEN[:3] + TABLES_USER_OWNED[:2]:
        status, body = probe(t, key)
        print(f'{t:32} status={status}  {body[:80]}')

# Also query pg_tables view via service key to see rowsecurity flag
if key:
    print('\n== pg_tables rowsecurity flags (via information_schema) ==')
    # information_schema doesn't expose rowsecurity, but we can use pg_catalog.pg_tables
    # PostgREST doesn't expose pg_catalog by default. Best we can do: attempt a public RPC.
    # Skip if not available.
