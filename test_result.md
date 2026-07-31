#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  Forensique — UGC NET/JRF Forensic Science Paper II platform.
  Phase 1 scope: user signup → dashboard → admin JSON import → take CBT test (with palette,
  timer, autosave, mark-for-review) → submit → scored results with per-question explanations
  and bookmarks. Stack: Next.js App Router + Supabase (Postgres) + Supabase Auth email/password.
  Schema v3 applied, RLS on `answers` and `notes` per spec.

backend:
  - task: "POST /api/admin/import — bulk import a UGC_NET_FS test JSON"
    implemented: true
    working: true
    file: "/app/app/api/[[...path]]/route.js"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: |
          Uses service-role key to bypass RLS. Validates shape (4 options, dropped rules,
          passage refs). Upserts exam → passages → units/topics/subtopics → questions →
          options/statements/match_items → answers → tests → test_questions.
          The sample UGC_NET_FS_2025_06 test is flagged is_premium=false (free trial);
          everything else defaults to is_premium=true. Idempotent per question_code.
          Requires the caller's profile.role='admin'.
        -working: true
        -agent: "testing"
        -comment: |
          ✅ PASSED - Tested with throwaway admin user and UGC_NET_FS_2025_JUNE.json
          - First import: Successfully imported 100 questions, 2 passages, 1 dropped question
          - Verified is_premium=false for UGC_NET_FS_2025_06 (free trial flag)
          - Second import: Idempotency confirmed - no errors, same test returned
          - All validation rules working (4 options, passage refs, dropped question handling)
          - Admin role check working correctly

  - task: "POST /api/attempt/create — start / resume attempt"
    implemented: true
    working: true
    file: "/app/app/api/[[...path]]/route.js"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: |
          If an in_progress attempt already exists for (user, test), returns it (resume).
          Otherwise inserts test_attempts row and initializes attempt_responses with
          status='not_visited' for every question in the test.
        -working: true
        -agent: "testing"
        -comment: |
          ✅ PASSED - Created new attempt successfully
          - Returned attempt_id and resumed=false
          - Verified 100 attempt_responses rows created
          - All responses initialized with status='not_visited'
          - Resume logic not tested (would require existing in_progress attempt)

  - task: "POST /api/attempt/submit — score and finalize"
    implemented: true
    working: true
    file: "/app/app/api/[[...path]]/route.js"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: |
          Reads answers server-side (service key), computes correct/incorrect/unattempted,
          updates every attempt_responses.is_correct, then updates test_attempts with score,
          counts, time_taken_seconds, status='submitted' or 'auto_submitted'.
          Dropped questions (answer_status='dropped') always score as correct.
        -working: true
        -agent: "testing"
        -comment: |
          ✅ PASSED - Scoring and finalization working correctly
          - Simulated 40 correct, 20 incorrect, 40 unattempted (one was dropped)
          - Submit returned: 41 correct, 20 incorrect, 39 unattempted
          - Dropped question (UGC_NET_FS_2025_JUNE_Q082) correctly counted as correct
          - Score calculation: 41 × 2 = 82 (no negative marking)
          - test_attempts row updated: status='submitted', submitted_at set, time_taken_seconds=23s
          - All attempt_responses.is_correct flags set correctly

  - task: "GET /api/health"
    implemented: true
    working: true
    file: "/app/app/api/[[...path]]/route.js"
    stuck_count: 0
    priority: "low"
    needs_retesting: false
    status_history:
        -working: true
        -agent: "main"
        -comment: "Returns {ok:true, ts:...}. Verified with curl."

frontend:
  - task: "Landing / auth / dashboard / attempt / results pages"
    implemented: true
    working: "NA"
    file: "/app/app/page.js and children"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Not tested in this run — will ask user before running frontend tests."

metadata:
  created_by: "main_agent"
  version: "1.0"
  test_sequence: 1
  run_ui: false

test_plan:
  current_focus:
    - "POST /api/admin/import — bulk import a UGC_NET_FS test JSON"
    - "POST /api/attempt/create — start / resume attempt"
    - "POST /api/attempt/submit — score and finalize"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
    -agent: "main"
    -message: |
      Phase 1 backend built. User has already applied the schema in Supabase SQL Editor,
      disabled email confirmations, signed up, and set their own profile.role='admin'.

      Please run an end-to-end smoke test that verifies the three Supabase-backed API routes
      work correctly. Use a FRESH throwaway test user (not the user's own account) — sign
      them up via Supabase Auth REST directly, then promote them to admin using the service
      key (write a tiny Python helper for this). Then:

        1. POST /api/admin/import with the JSON at /app/public/UGC_NET_FS_2025_JUNE.json
           - expect 200, counts.questions=100, counts.passages=2
           - re-run it and confirm it's idempotent (no duplicate errors, same counts logic)

        2. POST /api/attempt/create with the returned test uuid
           - expect { attempt_id, resumed: false }

        3. Simulate submitting responses via direct Supabase upsert into attempt_responses
           (use the test user's JWT — attempt_responses has no RLS, so browser client works,
           OR just use the service key from Python). Answer ~40 questions correctly,
           ~20 incorrectly, leave ~40 unattempted. Include at least one 'dropped'
           question (Q004 in the sample is dropped per the JSON — verify by scanning
           the JSON) and verify it scores as correct regardless of user's answer.

        4. POST /api/attempt/submit
           - expect 200, correct+incorrect+unattempted == 100
           - score == correct * 2 (since negative_marking is false)
           - dropped question scored as correct

        5. Verify test_attempts row updated: status='submitted', score set, timings set.

      Supabase creds are in /app/.env (NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY).
      Backend is at http://localhost:3000/api (also exposed at NEXT_PUBLIC_BASE_URL/api).

      Notes:
      - Signup returns a session immediately since email confirmations are OFF.
      - Do NOT touch or delete the user's real account (only admins can see profiles, but
        still — use a random email like fq-smoke-<uuid>@example.com).
      - Clean up: at the end, delete the test user via admin.auth.admin.deleteUser().
        This will cascade-delete their profile, subscriptions, attempts via FKs.
      - Do NOT delete the imported test or questions — the user wants that data to persist.
    -agent: "testing"
    -message: |
      ✅ BACKEND SMOKE TEST COMPLETED SUCCESSFULLY
      
      All three Phase 1 backend endpoints are working correctly:
      
      1. POST /api/admin/import
         - Successfully imported 100 questions, 2 passages, 1 dropped question
         - Idempotency verified (second import returned same test, no errors)
         - Free trial flag (is_premium=false) correctly set for UGC_NET_FS_2025_06
         - Admin role check working
      
      2. POST /api/attempt/create
         - Created new attempt with 100 response rows
         - All responses initialized as 'not_visited'
      
      3. POST /api/attempt/submit
         - Scoring logic correct: 41 correct × 2 = 82 points
         - Dropped question (Q082) correctly counted as correct
         - test_attempts row properly updated with status, timestamp, time_taken
         - All attempt_responses.is_correct flags set correctly
      
      Test used throwaway admin user (created, promoted, tested, deleted).
      Test data persisted as requested (not deleted).
      
      Note: Public URL (NEXT_PUBLIC_BASE_URL) returns 502 Bad Gateway (Cloudflare/ingress issue),
      but localhost:3000 works perfectly. This is an infrastructure issue, not a code issue.
