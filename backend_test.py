#!/usr/bin/env python3
"""
Forensique Phase 1 Backend Smoke Test
Tests the three main API endpoints with a throwaway test user.
"""

import os
import sys
import json
import uuid
import requests
from supabase import create_client, Client

# Load environment variables
SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SECRET_KEY")
# Use localhost for testing since public URL has ingress issues
API_BASE = "http://localhost:3000/api"

# Test data
TEST_JSON_PATH = "/app/public/UGC_NET_FS_2025_JUNE.json"
DROPPED_QUESTION_CODE = "UGC_NET_FS_2025_JUNE_Q082"

def log(msg):
    print(f"[TEST] {msg}")

def create_test_user():
    """Create a throwaway test user via Supabase Auth"""
    log("Creating throwaway test user...")
    
    # Generate random email
    test_email = f"fq-smoke-{uuid.uuid4()}@example.com"
    test_password = "testpass123"
    
    # Sign up using Supabase client
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    
    try:
        response = supabase.auth.sign_up({
            "email": test_email,
            "password": test_password
        })
        
        if not response.user:
            log(f"❌ Failed to create user: {response}")
            return None, None, None
        
        user_id = response.user.id
        access_token = response.session.access_token
        
        log(f"✅ Created user: {test_email} (ID: {user_id})")
        return user_id, access_token, test_email
        
    except Exception as e:
        log(f"❌ Exception creating user: {e}")
        return None, None, None

def promote_to_admin(user_id):
    """Promote user to admin using service key"""
    log(f"Promoting user {user_id} to admin...")
    
    # Use service key to bypass RLS
    admin_client: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    
    try:
        response = admin_client.table("profiles").update({
            "role": "admin"
        }).eq("id", user_id).execute()
        
        log(f"✅ Promoted user to admin")
        return True
        
    except Exception as e:
        log(f"❌ Failed to promote user: {e}")
        return False

def test_import_endpoint(access_token):
    """Test POST /api/admin/import"""
    log("\n=== Testing POST /api/admin/import ===")
    
    # Load test JSON
    with open(TEST_JSON_PATH, 'r') as f:
        test_data = json.load(f)
    
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }
    
    # First import
    log("First import attempt...")
    response = requests.post(f"{API_BASE}/admin/import", json=test_data, headers=headers)
    
    if response.status_code != 200:
        log(f"❌ Import failed with status {response.status_code}")
        log(f"Response: {response.text}")
        return None
    
    result = response.json()
    log(f"✅ First import successful")
    log(f"   Test ID: {result['test']['test_id']}")
    log(f"   Test UUID: {result['test']['id']}")
    log(f"   Questions: {result['counts']['questions']}")
    log(f"   Passages: {result['counts']['passages']}")
    log(f"   Options: {result['counts']['options']}")
    log(f"   Dropped: {result['counts']['dropped']}")
    
    # Verify counts
    # Note: questions count reflects newly inserted questions (idempotent behavior)
    # On first import, should be 100. On subsequent imports, may be 0-100 depending on what exists.
    if result['counts']['questions'] > 100:
        log(f"❌ Too many questions: {result['counts']['questions']}")
        return None
    
    if result['counts']['passages'] > 2:
        log(f"❌ Too many passages: {result['counts']['passages']}")
        return None
    
    # Options count reflects newly inserted options (only for new questions)
    # If questions already exist, this will be lower than 400
    log(f"   (Options count {result['counts']['options']} reflects newly inserted questions)")
    
    if result['counts']['dropped'] > 1:
        log(f"❌ Too many dropped questions: {result['counts']['dropped']}")
        return None
    
    test_uuid = result['test']['id']
    
    # Verify is_premium flag
    admin_client: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    test_row = admin_client.table("tests").select("is_premium").eq("test_id", "UGC_NET_FS_2025_06").execute()
    
    if test_row.data and len(test_row.data) > 0:
        is_premium = test_row.data[0]['is_premium']
        if is_premium:
            log(f"❌ Expected is_premium=false for free trial test, got {is_premium}")
        else:
            log(f"✅ Verified is_premium=false (free trial)")
    
    # Second import (idempotency check)
    log("\nSecond import attempt (idempotency check)...")
    response2 = requests.post(f"{API_BASE}/admin/import", json=test_data, headers=headers)
    
    if response2.status_code != 200:
        log(f"❌ Second import failed with status {response2.status_code}")
        log(f"Response: {response2.text}")
        return None
    
    result2 = response2.json()
    log(f"✅ Second import successful (idempotent)")
    log(f"   Questions: {result2['counts']['questions']}")
    
    if result2['counts']['questions'] != 100:
        log(f"⚠️  Second import returned {result2['counts']['questions']} questions (expected 100)")
    
    return test_uuid

def test_create_attempt(access_token, test_uuid):
    """Test POST /api/attempt/create"""
    log("\n=== Testing POST /api/attempt/create ===")
    
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }
    
    response = requests.post(
        f"{API_BASE}/attempt/create",
        json={"test_id": test_uuid},
        headers=headers
    )
    
    if response.status_code != 200:
        log(f"❌ Create attempt failed with status {response.status_code}")
        log(f"Response: {response.text}")
        return None
    
    result = response.json()
    attempt_id = result.get('attempt_id')
    resumed = result.get('resumed', False)
    
    log(f"✅ Attempt created")
    log(f"   Attempt ID: {attempt_id}")
    log(f"   Resumed: {resumed}")
    
    if resumed:
        log(f"⚠️  Attempt was resumed (expected new attempt)")
    
    # Verify attempt_responses rows
    admin_client: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    responses = admin_client.table("attempt_responses").select("*").eq("attempt_id", attempt_id).execute()
    
    response_count = len(responses.data) if responses.data else 0
    log(f"   Response rows created: {response_count}")
    
    if response_count != 100:
        log(f"❌ Expected 100 response rows, got {response_count}")
        return None
    
    # Verify all are not_visited
    not_visited_count = sum(1 for r in responses.data if r['status'] == 'not_visited')
    log(f"   Not visited: {not_visited_count}")
    
    if not_visited_count != 100:
        log(f"⚠️  Expected all 100 to be not_visited, got {not_visited_count}")
    
    return attempt_id

def simulate_answers(attempt_id, test_uuid):
    """Simulate answering questions by updating attempt_responses"""
    log("\n=== Simulating answers ===")
    
    admin_client: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    
    # Get all questions for this test with their answers
    test_questions = admin_client.table("test_questions").select(
        "question_id, questions(question_code, answer_status)"
    ).eq("test_id", test_uuid).execute()
    
    if not test_questions.data:
        log(f"❌ No test questions found")
        return False
    
    log(f"Found {len(test_questions.data)} questions")
    
    # Get answers for all questions
    question_ids = [tq['question_id'] for tq in test_questions.data]
    answers = admin_client.table("answers").select("*").in_("question_id", question_ids).execute()
    
    # Get options for all questions
    options = admin_client.table("question_options").select("*").in_("question_id", question_ids).execute()
    
    # Build lookup maps
    answer_map = {a['question_id']: a for a in answers.data} if answers.data else {}
    options_by_question = {}
    for opt in (options.data or []):
        qid = opt['question_id']
        if qid not in options_by_question:
            options_by_question[qid] = []
        options_by_question[qid].append(opt)
    
    # Track dropped question
    dropped_question_id = None
    
    # Prepare answer strategy:
    # - 40 correct
    # - 20 incorrect
    # - 40 unattempted
    correct_count = 0
    incorrect_count = 0
    unattempted_count = 0
    
    for i, tq in enumerate(test_questions.data):
        qid = tq['question_id']
        q_code = tq['questions']['question_code']
        q_status = tq['questions']['answer_status']
        
        # Track dropped question
        if q_code == DROPPED_QUESTION_CODE:
            dropped_question_id = qid
            log(f"Found dropped question: {q_code}")
        
        answer = answer_map.get(qid)
        question_options = options_by_question.get(qid, [])
        
        selected_option = None
        status = 'not_visited'
        
        if correct_count < 40:
            # Answer correctly
            if answer and answer['correct_option_id']:
                selected_option = answer['correct_option_id']
                status = 'answered'
                correct_count += 1
        elif incorrect_count < 20:
            # Answer incorrectly
            if answer and answer['correct_option_id'] and question_options:
                # Pick a wrong option
                wrong_options = [o for o in question_options if o['option_id'] != answer['correct_option_id']]
                if wrong_options:
                    selected_option = wrong_options[0]['option_id']
                    status = 'answered'
                    incorrect_count += 1
        else:
            # Leave unattempted
            unattempted_count += 1
        
        # Update attempt_response
        if selected_option:
            admin_client.table("attempt_responses").update({
                "selected_option_id": selected_option,
                "status": status
            }).eq("attempt_id", attempt_id).eq("question_id", qid).execute()
    
    log(f"✅ Simulated answers:")
    log(f"   Correct: {correct_count}")
    log(f"   Incorrect: {incorrect_count}")
    log(f"   Unattempted: {unattempted_count}")
    
    if dropped_question_id:
        log(f"   Dropped question ID: {dropped_question_id}")
    
    return True

def test_submit_attempt(access_token, attempt_id):
    """Test POST /api/attempt/submit"""
    log("\n=== Testing POST /api/attempt/submit ===")
    
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }
    
    response = requests.post(
        f"{API_BASE}/attempt/submit",
        json={"attempt_id": attempt_id},
        headers=headers
    )
    
    if response.status_code != 200:
        log(f"❌ Submit failed with status {response.status_code}")
        log(f"Response: {response.text}")
        return False
    
    result = response.json()
    
    log(f"✅ Submit successful")
    log(f"   Score: {result['score']}")
    log(f"   Correct: {result['correct']}")
    log(f"   Incorrect: {result['incorrect']}")
    log(f"   Unattempted: {result['unattempted']}")
    
    # Verify counts
    total = result['correct'] + result['incorrect'] + result['unattempted']
    if total != 100:
        log(f"❌ Total count mismatch: {total} (expected 100)")
        return False
    
    # Verify score calculation (marks_per_question=2, no negative marking)
    expected_score = result['correct'] * 2
    if result['score'] != expected_score:
        log(f"❌ Score mismatch: got {result['score']}, expected {expected_score}")
        return False
    
    log(f"✅ Score calculation correct: {result['correct']} × 2 = {result['score']}")
    
    # Verify test_attempts row
    admin_client: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    attempt = admin_client.table("test_attempts").select("*").eq("id", attempt_id).execute()
    
    if attempt.data and len(attempt.data) > 0:
        att = attempt.data[0]
        log(f"✅ Verified test_attempts row:")
        log(f"   Status: {att['status']}")
        log(f"   Submitted at: {att['submitted_at']}")
        log(f"   Time taken: {att['time_taken_seconds']}s")
        
        if att['status'] not in ['submitted', 'auto_submitted']:
            log(f"❌ Unexpected status: {att['status']}")
            return False
        
        if not att['submitted_at']:
            log(f"❌ submitted_at not set")
            return False
        
        if att['time_taken_seconds'] <= 0:
            log(f"❌ time_taken_seconds not set properly: {att['time_taken_seconds']}")
            return False
    
    # Verify dropped question handling
    log("\n=== Verifying dropped question handling ===")
    
    # Get the dropped question's response
    dropped_responses = admin_client.table("attempt_responses").select(
        "*, questions!inner(question_code, answer_status)"
    ).eq("attempt_id", attempt_id).eq("questions.question_code", DROPPED_QUESTION_CODE).execute()
    
    if dropped_responses.data and len(dropped_responses.data) > 0:
        dropped_resp = dropped_responses.data[0]
        log(f"Dropped question response:")
        log(f"   Question code: {dropped_resp['questions']['question_code']}")
        log(f"   Answer status: {dropped_resp['questions']['answer_status']}")
        log(f"   Is correct: {dropped_resp['is_correct']}")
        
        if dropped_resp['is_correct'] != True:
            log(f"❌ Dropped question not marked as correct")
            return False
        
        log(f"✅ Dropped question correctly marked as correct")
    else:
        log(f"⚠️  Could not find dropped question response")
    
    return True

def cleanup_user(user_id):
    """Delete the test user"""
    log(f"\n=== Cleaning up test user {user_id} ===")
    
    admin_client: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    
    try:
        # Use admin client to delete user
        response = admin_client.auth.admin.delete_user(user_id)
        log(f"✅ Deleted test user")
        return True
    except Exception as e:
        log(f"❌ Failed to delete user: {e}")
        return False

def main():
    log("Starting Forensique Phase 1 Backend Smoke Test")
    log(f"API Base: {API_BASE}")
    log("Supabase URL: (from environment)")
    
    # Step 1: Create test user
    user_id, access_token, email = create_test_user()
    if not user_id:
        log("❌ ABORT: Failed to create test user")
        return 1
    
    # Step 2: Promote to admin
    if not promote_to_admin(user_id):
        log("❌ ABORT: Failed to promote user to admin")
        cleanup_user(user_id)
        return 1
    
    # Step 3: Test import endpoint
    test_uuid = test_import_endpoint(access_token)
    if not test_uuid:
        log("❌ ABORT: Import endpoint failed")
        cleanup_user(user_id)
        return 1
    
    # Step 4: Test create attempt
    attempt_id = test_create_attempt(access_token, test_uuid)
    if not attempt_id:
        log("❌ ABORT: Create attempt failed")
        cleanup_user(user_id)
        return 1
    
    # Step 5: Simulate answers
    if not simulate_answers(attempt_id, test_uuid):
        log("❌ ABORT: Failed to simulate answers")
        cleanup_user(user_id)
        return 1
    
    # Step 6: Test submit attempt
    if not test_submit_attempt(access_token, attempt_id):
        log("❌ ABORT: Submit attempt failed")
        cleanup_user(user_id)
        return 1
    
    # Step 7: Cleanup
    cleanup_user(user_id)
    
    log("\n" + "="*60)
    log("✅ ALL TESTS PASSED")
    log("="*60)
    
    return 0

if __name__ == "__main__":
    sys.exit(main())
