# Doctor Migration Plan

**Date:** 2025-10-16  
**Migration Type:** Source PostgreSQL → Target Supabase  
**Dependencies:** Profiles migration must be completed first  

## Overview

This plan addresses the migration of 399 high-quality doctor records from the source database, taking into account the profile-based architecture of the target system where doctor names are stored in associated profile records.

## Architecture Understanding

### Source Database Structure
```sql
auth_user (contains doctor names & credentials)
├─ id (primary key)
├─ first_name, last_name, email
├─ is_active, last_login
└─ username, date_joined

dispatch_usersetting (doctor system settings)
├─ user_id → auth_user.id
└─ system preferences

dispatch_office_doctors (office assignments)
├─ user_id → auth_user.id
└─ office_id

dispatch_patient (patient relationships)
├─ doctor_id → auth_user.id
└─ patient data
```

### Target Database Structure
```sql
profiles (contains all user names & basic info)
├─ id: uuid (PK)
├─ legacy_user_id: integer → source auth_user.id
├─ first_name, last_name, email
├─ profile_type: 'doctor' | 'patient' | 'admin'
└─ created_at, updated_at

doctors (contains professional doctor data)
├─ id: uuid (PK)
├─ legacy_user_id: bigint → source auth_user.id
├─ profile_id: uuid → profiles.id (CRITICAL RELATIONSHIP)
├─ doctor_id: bigint
├─ license_number, specialty
├─ professional fields (25+ columns)
└─ created_at, updated_at
```

## Prerequisites & Dependencies

### Phase 1: Profile Migration Validation
**Status Check Required**

1. **Verify Profile Migration Completion**
   - Confirm profiles table contains doctor records
   - Check profile_type = 'doctor' records exist
   - Validate legacy_user_id mapping integrity

2. **Profile Coverage Analysis**
   ```sql
   -- Check coverage for our 399 target doctors
   SELECT COUNT(*) 
   FROM profiles p
   WHERE p.legacy_user_id IN (
     -- Our filtered 399 doctor IDs
     SELECT au.id FROM auth_user au
     LEFT JOIN dispatch_usersetting dus ON au.id = dus.user_id
     -- ... filtering logic
   ) AND p.profile_type = 'doctor'
   ```

3. **Profile Quality Assessment**
   - Verify profile names match source auth_user names
   - Check for missing profiles that need creation
   - Validate email consistency between profiles and source

### Phase 2: Pre-Migration Setup

1. **Target Schema Validation**
   - Confirm doctors table structure matches expectations
   - Verify foreign key constraint: doctors.profile_id → profiles.id
   - Check for any required fields or constraints

2. **Migration User Setup**
   - Database connection permissions
   - Transaction isolation level configuration
   - Rollback procedure preparation

## Migration Execution Plan

### Step 1: Pre-Migration Analysis (Duration: 15 minutes)

**1.1 Extract Clean Doctor Dataset**
```sql
-- Identifies our 399 high-quality doctors
WITH clean_doctors AS (
  SELECT DISTINCT ON (
    CASE 
      WHEN au.email IS NOT NULL AND au.email != '' 
      THEN TRIM(LOWER(au.email))
      ELSE CONCAT(TRIM(LOWER(COALESCE(au.first_name, ''))), '_', TRIM(LOWER(COALESCE(au.last_name, ''))))
    END
  ) 
  au.id as user_id,
  au.first_name,
  au.last_name,
  au.email,
  au.username,
  au.is_active,
  au.date_joined,
  au.last_login,
  COALESCE(patient_stats.patient_count, 0) as patient_count,
  CASE WHEN dod.user_id IS NOT NULL THEN true ELSE false END as has_office_assignment,
  CASE WHEN dus.user_id IS NOT NULL THEN true ELSE false END as has_settings
  FROM auth_user au
  LEFT JOIN dispatch_usersetting dus ON au.id = dus.user_id
  LEFT JOIN dispatch_office_doctors dod ON au.id = dod.user_id
  LEFT JOIN (
    SELECT doctor_id, COUNT(*) as patient_count
    FROM dispatch_patient
    WHERE archived = false OR archived IS NULL
    GROUP BY doctor_id
  ) patient_stats ON au.id = patient_stats.doctor_id
  WHERE (dus.user_id IS NOT NULL OR dod.user_id IS NOT NULL)
  AND au.is_active = true
  AND COALESCE(patient_stats.patient_count, 0) > 0
  AND NOT (
    LOWER(au.email) LIKE '%test%' OR
    LOWER(au.email) LIKE '%demo%' OR
    LOWER(au.first_name) LIKE '%test%' OR
    LOWER(au.last_name) LIKE '%test%' OR
    au.email LIKE '%brius.com' OR
    au.email LIKE '%mechanodontics.com'
  )
  ORDER BY 
    CASE 
      WHEN au.email IS NOT NULL AND au.email != '' 
      THEN TRIM(LOWER(au.email))
      ELSE CONCAT(TRIM(LOWER(COALESCE(au.first_name, ''))), '_', TRIM(LOWER(COALESCE(au.last_name, ''))))
    END,
    COALESCE(patient_stats.patient_count, 0) DESC,
    au.last_login DESC NULLS LAST,
    au.id ASC
)
SELECT * FROM clean_doctors;
```

**1.2 Profile Mapping Validation**
```sql
-- Verify profile coverage for our doctors
SELECT 
  cd.user_id,
  cd.first_name,
  cd.last_name,
  cd.email,
  p.id as profile_id,
  CASE WHEN p.id IS NOT NULL THEN 'PROFILE_EXISTS' ELSE 'PROFILE_MISSING' END as status
FROM clean_doctors cd
LEFT JOIN profiles p ON p.legacy_user_id = cd.user_id 
  AND p.profile_type = 'doctor'
ORDER BY cd.patient_count DESC;
```

**1.3 Dependency Check**
- Expected: 399 doctors with matching profiles
- If profiles missing: **STOP MIGRATION** - run profile migration first
- If profile data inconsistent: **STOP MIGRATION** - fix profile data

### Step 2: Migration Execution (Duration: 30 minutes)

**2.1 Clear Existing Doctors (if re-running)**
```sql
-- Clean slate approach
DELETE FROM doctors;
-- Reset sequences if needed
```

**2.2 Doctor Record Migration**
```sql
INSERT INTO doctors (
  legacy_user_id,
  profile_id,
  doctor_id,
  doctor_number,
  license_number,
  npi_number,
  specialty,
  board_certifications,
  education,
  years_experience,
  primary_office_id,
  practice_type,
  status,
  is_accepting_patients,
  max_patient_load,
  bio,
  specialties,
  languages_spoken,
  professional_memberships,
  consultation_duration_minutes,
  follow_up_duration_minutes,
  working_hours,
  consultation_fee,
  accepts_insurance,
  payment_terms,
  licensed_since,
  joined_practice_at,
  updated_at,
  legacy_doctor_id,
  legacy_user_id -- Note: appears twice in target schema
) 
SELECT 
  cd.user_id,                           -- legacy_user_id (bigint)
  p.id,                                 -- profile_id (uuid) - CRITICAL
  cd.user_id,                           -- doctor_id (bigint)
  'DOC-' || cd.user_id,                 -- doctor_number (generated)
  NULL,                                 -- license_number (not in source)
  NULL,                                 -- npi_number (not in source)
  'General Practice',                   -- specialty (default)
  '{}',                                 -- board_certifications (empty JSON)
  '{}',                                 -- education (empty JSON)
  EXTRACT(YEAR FROM AGE(cd.date_joined)) as years_experience,
  NULL,                                 -- primary_office_id (requires office migration)
  'Private Practice',                   -- practice_type (default)
  'active',                             -- status (enum value)
  true,                                 -- is_accepting_patients
  NULL,                                 -- max_patient_load
  'Migrated doctor profile',            -- bio (default)
  '["General Practice"]',               -- specialties (JSON array)
  '["English"]',                        -- languages_spoken (default)
  '{}',                                 -- professional_memberships (empty JSON)
  30,                                   -- consultation_duration_minutes (default)
  15,                                   -- follow_up_duration_minutes (default)
  '{}',                                 -- working_hours (empty JSON)
  NULL,                                 -- consultation_fee
  true,                                 -- accepts_insurance (default)
  '{}',                                 -- payment_terms (empty JSON)
  cd.date_joined::date,                 -- licensed_since (approximation)
  cd.date_joined,                       -- joined_practice_at
  NOW(),                                -- updated_at
  cd.user_id,                           -- legacy_doctor_id (integer)
  cd.user_id                            -- legacy_user_id (integer) - second occurrence
FROM clean_doctors cd
INNER JOIN profiles p ON p.legacy_user_id = cd.user_id 
  AND p.profile_type = 'doctor'
ORDER BY cd.patient_count DESC;
```

**2.3 Migration Metadata**
Store migration metadata in doctor records:
```json
{
  "migration_date": "2025-10-16",
  "source_patient_count": 17,
  "has_office_assignment": true,
  "has_settings": true,
  "deduplication_method": "email_priority",
  "data_quality_score": "high"
}
```

### Step 3: Post-Migration Validation (Duration: 15 minutes)

**3.1 Count Validation**
```sql
-- Should return exactly 399
SELECT COUNT(*) as migrated_doctors FROM doctors;
```

**3.2 Profile Relationship Validation**
```sql
-- Should return 0 orphaned doctors
SELECT COUNT(*) as orphaned_doctors 
FROM doctors d 
LEFT JOIN profiles p ON d.profile_id = p.id 
WHERE p.id IS NULL;
```

**3.3 Data Quality Checks**
```sql
-- Verify no test accounts leaked through
SELECT COUNT(*) as test_accounts
FROM doctors d
JOIN profiles p ON d.profile_id = p.id
WHERE LOWER(p.email) LIKE '%test%'
   OR LOWER(p.email) LIKE '%demo%'
   OR p.email LIKE '%brius.com'
   OR p.email LIKE '%mechanodontics.com';
-- Should return 0
```

**3.4 Legacy ID Mapping Validation**
```sql
-- Ensure all legacy_user_id values are preserved
SELECT 
  COUNT(*) as total_doctors,
  COUNT(CASE WHEN legacy_user_id IS NOT NULL THEN 1 END) as with_legacy_id,
  COUNT(DISTINCT legacy_user_id) as unique_legacy_ids
FROM doctors;
-- All counts should equal 399
```

### Step 4: Performance & Relationship Testing (Duration: 15 minutes)

**4.1 Profile Join Performance**
```sql
-- Test critical join performance
EXPLAIN ANALYZE
SELECT d.*, p.first_name, p.last_name, p.email
FROM doctors d
JOIN profiles p ON d.profile_id = p.id
WHERE d.status = 'active';
```

**4.2 Legacy ID Lookup Performance**  
```sql
-- Test reverse lookup performance
EXPLAIN ANALYZE
SELECT * FROM doctors WHERE legacy_user_id = 257;
```

## Rollback Procedure

**If migration fails or data issues discovered:**

1. **Immediate Rollback**
   ```sql
   BEGIN TRANSACTION;
   DELETE FROM doctors WHERE updated_at >= '2025-10-16 12:00:00';
   COMMIT;
   ```

2. **Profile Integrity Check**
   ```sql
   -- Ensure profiles weren't affected
   SELECT COUNT(*) FROM profiles WHERE profile_type = 'doctor';
   ```

3. **Investigation Steps**
   - Check migration logs for specific errors
   - Validate source data hasn't changed
   - Verify profile migration is still intact

## Success Criteria

**✅ Migration Considered Successful When:**

1. **Quantitative Measures**
   - Exactly 399 doctor records migrated
   - 100% profile relationship establishment (399/399)
   - Zero test accounts in final dataset
   - Zero duplicate records
   - Zero orphaned doctor records

2. **Qualitative Measures**
   - All doctors have `is_active = true` in source
   - All doctors have active patients (verified in source)
   - Profile names match source auth_user names
   - Legacy ID mapping preserved for all records

3. **Performance Measures**
   - Profile join queries perform adequately (<100ms)
   - Legacy ID lookups perform adequately (<10ms)
   - No foreign key constraint violations

## Risk Mitigation

**High Risk Items:**
- **Profile dependency**: If profiles missing, migration fails completely
- **Foreign key constraints**: Could prevent doctor record creation
- **Data type mismatches**: UUID vs integer compatibility

**Medium Risk Items:**
- **Legacy ID conflicts**: Duplicate legacy_user_id values
- **Profile name mismatches**: Inconsistency between profiles and source
- **Performance issues**: Large dataset joins

**Mitigation Strategies:**
- Pre-migration validation catches most issues
- Rollback procedure provides quick recovery
- Transaction isolation prevents partial failures
- Comprehensive testing plan validates all scenarios

## Post-Migration Tasks

**Immediate (within 24 hours):**
1. Monitor application performance with new data
2. Validate doctor-patient relationships in application
3. Test doctor authentication flows
4. Verify profile display functionality

**Short-term (within 1 week):**
1. Performance optimization based on usage patterns
2. Index analysis and optimization
3. Data integrity monitoring setup
4. User acceptance testing with actual doctors

**Long-term (within 1 month):**
1. Cleanup procedures for any edge cases discovered
2. Documentation updates based on lessons learned
3. Process improvements for future migrations
4. Data governance policy implementation

## Expected Timeline

**Total Migration Time: ~75 minutes**

- Pre-migration validation: 15 minutes
- Migration execution: 30 minutes  
- Post-migration validation: 15 minutes
- Performance testing: 15 minutes

**Additional Time Buffers:**
- Profile migration dependency: 0-120 minutes (if needed)
- Issue investigation: 0-60 minutes (if problems found)
- Rollback execution: 5-15 minutes (if needed)

**Recommended Migration Window:**
- Start: After profile migration completion confirmed
- Duration: 2-hour maintenance window
- Rollback deadline: Within 30 minutes of issue detection
