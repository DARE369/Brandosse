#!/usr/bin/env python3
"""
Database migration to add Pack 1 columns.
Run once after deploying analyze.py changes.
"""

import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("WORKER_SUPABASE_URL")
SUPABASE_KEY = os.getenv("WORKER_SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ WORKER_SUPABASE_URL or WORKER_SUPABASE_SERVICE_KEY not set in .env")
    exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

print("📝 Adding Pack 1 columns to video_clips table...")

# Check if columns exist before adding
try:
    # Try to add flow_score column
    print("  - Adding flow_score...")
    supabase.rpc("exec_sql", {"query": """
        ALTER TABLE video_clips ADD COLUMN flow_score FLOAT DEFAULT 0.7;
    """}).execute()
    print("    ✅ flow_score added")
except Exception as e:
    if "already exists" in str(e):
        print("    ⚠️  flow_score already exists (skipping)")
    else:
        print(f"    ⚠️  {str(e)[:100]}")

try:
    # Try to add trend_score column
    print("  - Adding trend_score...")
    supabase.rpc("exec_sql", {"query": """
        ALTER TABLE video_clips ADD COLUMN trend_score FLOAT DEFAULT 0.7;
    """}).execute()
    print("    ✅ trend_score added")
except Exception as e:
    if "already exists" in str(e):
        print("    ⚠️  trend_score already exists (skipping)")
    else:
        print(f"    ⚠️  {str(e)[:100]}")

try:
    # Try to add why_this_works column
    print("  - Adding why_this_works...")
    supabase.rpc("exec_sql", {"query": """
        ALTER TABLE video_clips ADD COLUMN why_this_works TEXT;
    """}).execute()
    print("    ✅ why_this_works added")
except Exception as e:
    if "already exists" in str(e):
        print("    ⚠️  why_this_works already exists (skipping)")
    else:
        print(f"    ⚠️  {str(e)[:100]}")

print("\n✅ Migration complete!")
print("\nNote: If all columns already existed, no changes were made.")
print("The new schema is:")
print("""
  - flow_score (FLOAT): 0-1 score for narrative flow
  - trend_score (FLOAT): 0-1 score for trend relevance
  - why_this_works (TEXT): Explanation of why clip is viral-worthy
""")
