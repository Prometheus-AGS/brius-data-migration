# Comprehensive Source to Target Field Mapping
**Generated:** November 4, 2025
**Based on:** Source PostgreSQL + Target Supabase schema investigations
**Purpose:** Complete field mapping for differential migrations and data synchronization

---

## 🔍 INVESTIGATION SUMMARY

### Source Database Structure (PostgreSQL)
- **Database:** mdw_db on AWS RDS
- **Total Users:** 9,839 in auth_user (all types)
- **Patient Records:** 8,488 in dispatch_patient
- **User Groups:** auth_user_groups (1=Patient, 2=Doctor, 11=Technician)
- **Offices:** 897 in dispatch_office
- **Files:** 327,771 in dispatch_file

### Target Database Structure (Supabase)
- **Profiles:** 9,805 records (UUID-based, all user types)
- **Doctors:** 1,332 records (profile_id -> profiles.id)
- **Patients:** 8,456 records (profile_id -> profiles.id)
- **Technicians:** 85 records (profile_id -> profiles.id)
- **Offices:** 896 records
- **Orders:** 24,996 records

---

## 📋 DETAILED FIELD MAPPINGS

### 1. PROFILES TABLE MAPPING

**Source:** `auth_user` (primary) + `dispatch_patient` (for patients) + `auth_user_groups` (for type classification)

| Target Field | Source Field(s) | Type | Notes |
|--------------|----------------|------|-------|
| `id` | Generated UUID | uuid | Primary key in target |
| `profile_type` | Derived from `auth_user_groups.group_id` | enum | 1=patient, 2=doctor, 11=technician, 4=admin, 5=master |
| `first_name` | `auth_user.first_name` | text | Direct mapping |
| `last_name` | `auth_user.last_name` | text | Direct mapping |
| `email` | `auth_user.email` | text | Nullable, direct mapping |
| `phone` | Not in source | text | Default to empty string |
| `date_of_birth` | `dispatch_patient.birthdate` | date | Only for patients |
| `gender` | `dispatch_patient.sex` | enum | 1=male, 2=female, null=unknown |
| `username` | `auth_user.username` | text | Direct mapping |
| `password_hash` | `auth_user.password` | text | Direct mapping |
| `is_active` | `auth_user.is_active` | boolean | Direct mapping |
| `is_verified` | Not in source | boolean | Default false |
| `archived` | Not in source | boolean | Default false |
| `suspended` | `dispatch_patient.suspended` | boolean | For patients only |
| `patient_suffix` | `dispatch_patient.suffix` | varchar(10) | For patients only |
| `insurance_info` | Not in source | jsonb | Default {} |
| `medical_history` | Not in source | jsonb | Default {} |
| `created_at` | `auth_user.date_joined` | timestamp | Direct mapping |
| `updated_at` | `auth_user.last_login` or `date_joined` | timestamp | Use last_login if available |
| `last_login_at` | `auth_user.last_login` | timestamp | Direct mapping |
| `metadata` | Constructed | jsonb | Migration metadata |
| `embedding` | Not in source | vector | Default null |
| `legacy_user_id` | `auth_user.id` | integer | **CRITICAL MAPPING** |
| `legacy_patient_id` | `dispatch_patient.id` | integer | For patients only |

**Profile Type Derivation Logic:**
```sql
CASE
  WHEN aug.group_id = 1 THEN 'patient'
  WHEN aug.group_id = 2 THEN 'doctor'
  WHEN aug.group_id = 11 THEN 'technician'
  WHEN aug.group_id = 4 THEN 'admin'
  WHEN aug.group_id = 5 THEN 'master'
  WHEN au.is_superuser = true THEN 'master'
  WHEN au.is_staff = true THEN 'admin'
  ELSE 'patient' -- Default fallback
END
```

### 2. DOCTORS TABLE MAPPING

**Source:** `auth_user` (filtered by group_id=2) + `dispatch_usersetting` + `dispatch_office_doctors`

| Target Field | Source Field(s) | Type | Notes |
|--------------|----------------|------|-------|
| `id` | Generated UUID | uuid | Primary key |
| `profile_id` | Linked to profiles.id via legacy_user_id | uuid | **CRITICAL RELATIONSHIP** |
| `doctor_number` | Generated: "DOC-" + legacy_user_id | text | e.g., "DOC-000056" |
| `license_number` | Not in source | text | Default null |
| `npi_number` | Not in source | text | Default null |
| `specialty` | Default "orthodontics" | text | All doctors are orthodontists |
| `board_certifications` | Not in source | jsonb array | Default [] |
| `education` | Not in source | jsonb | Default {} |
| `years_experience` | Calculated from date_joined | integer | EXTRACT(YEAR FROM AGE()) |
| `primary_office_id` | From dispatch_office_doctors | uuid | Link to offices table |
| `practice_type` | Not in source | text | Default null |
| `status` | Based on is_active | enum | active/inactive |
| `is_accepting_patients` | Default true | boolean | Default true |
| `max_patient_load` | Default 500 | integer | Standard default |
| `bio` | Not in source | text | Default null |
| `specialties` | Default ["orthodontics"] | jsonb array | Default array |
| `languages_spoken` | Default ["English"] | jsonb array | Default array |
| `professional_memberships` | Not in source | jsonb array | Default [] |
| `consultation_duration_minutes` | Default 60 | integer | Standard duration |
| `follow_up_duration_minutes` | Default 30 | integer | Standard duration |
| `working_hours` | Not in source | jsonb | Default {} |
| `consultation_fee` | Not in source | numeric | Default null |
| `accepts_insurance` | Default true | boolean | Default true |
| `payment_terms` | Not in source | jsonb | Default {} |
| `licensed_since` | `auth_user.date_joined` | date | Approximation |
| `joined_practice_at` | `auth_user.date_joined` | timestamp | Direct mapping |
| `updated_at` | Current timestamp | timestamp | Migration timestamp |
| `legacy_doctor_id` | Not applicable | integer | Set to null |
| `legacy_user_id` | `auth_user.id` | integer | **CRITICAL MAPPING** |
| `metadata` | Constructed | jsonb | Migration metadata |

### 3. PATIENTS TABLE MAPPING

**Source:** `dispatch_patient` (primary) + `auth_user` (via user_id)

| Target Field | Source Field(s) | Type | Notes |
|--------------|----------------|------|-------|
| `id` | Generated UUID | uuid | Primary key |
| `profile_id` | Linked to profiles.id via legacy_user_id | uuid | **CRITICAL RELATIONSHIP** |
| `patient_number` | "PAT-" + dispatch_patient.id | text | e.g., "PAT-523064" |
| `suffix` | `dispatch_patient.suffix` | text | Direct mapping (e.g., "00BB") |
| `sex` | `dispatch_patient.sex` -> enum | enum | 1=male, 2=female, null=unknown |
| `date_of_birth` | `dispatch_patient.birthdate` | date | Direct mapping |
| `primary_doctor_id` | `dispatch_patient.doctor_id` -> doctors.id | uuid | Link via legacy_user_id |
| `assigned_office_id` | `dispatch_patient.office_id` -> offices.id | uuid | Link via legacy_office_id |
| `status` | Based on dispatch_patient.status | enum | active/inactive/archived |
| `archived` | `dispatch_patient.archived` | boolean | Direct mapping |
| `suspended` | `dispatch_patient.suspended` | boolean | Direct mapping |
| `medical_history` | Not in source | jsonb | Default {} |
| `insurance_info` | Not in source | jsonb | Default {} |
| `schemes` | `dispatch_patient.schemes` | jsonb | Parse JSON string |
| `enrolled_at` | `dispatch_patient.submitted_at` | timestamp | Direct mapping |
| `updated_at` | `dispatch_patient.updated_at` | timestamp | Direct mapping |
| `legacy_patient_id` | `dispatch_patient.id` | integer | **CRITICAL MAPPING** |
| `legacy_user_id` | `dispatch_patient.user_id` | integer | **CRITICAL MAPPING** |
| `metadata` | Constructed | jsonb | Migration metadata |
| `legacy_doctor_id` | `dispatch_patient.doctor_id` | integer | Source doctor reference |

### 4. TECHNICIANS TABLE MAPPING

**Source:** `auth_user` (filtered by group_id=11)

| Target Field | Source Field(s) | Type | Notes |
|--------------|----------------|------|-------|
| `id` | Generated UUID | uuid | Primary key |
| `user_id` | Not used | uuid | Set to null |
| `profile_id` | Linked to profiles.id via legacy_user_id | uuid | **CRITICAL RELATIONSHIP** |
| `first_name` | `auth_user.first_name` | text | Direct mapping |
| `last_name` | `auth_user.last_name` | text | Direct mapping |
| `email` | `auth_user.email` | text | Direct mapping |
| `phone` | Not in source | text | Default null |
| `specialty` | Not in source | text | Default null |
| `is_active` | `auth_user.is_active` | boolean | Direct mapping |
| `hire_date` | `auth_user.date_joined` | date | Direct mapping |
| `created_at` | `auth_user.date_joined` | timestamp | Direct mapping |
| `updated_at` | `auth_user.last_login` or date_joined | timestamp | Use last_login if available |
| `metadata` | Constructed | jsonb | Migration metadata |
| `legacy_user_id` | `auth_user.id` | integer | **CRITICAL MAPPING** |
| `employee_id` | `auth_user.username` | text | Direct mapping |
| `status` | Based on is_active | enum | active/inactive |
| `legacy_technician_id` | `auth_user.id` | integer | Same as legacy_user_id |

### 5. OFFICES TABLE MAPPING

**Source:** `dispatch_office`

| Target Field | Source Field(s) | Type | Notes |
|--------------|----------------|------|-------|
| `id` | Generated UUID | uuid | Primary key |
| `name` | `dispatch_office.name` (normalized) | text | Lowercase, trimmed |
| `address` | `dispatch_office.address` (normalized) | text | Lowercase, trimmed |
| `apartment` | `dispatch_office.apt` | text | Direct mapping |
| `city` | `dispatch_office.city` (normalized) | text | Lowercase, trimmed |
| `state` | `dispatch_office.state` | text | Direct mapping |
| `zip_code` | `dispatch_office.zip` | text | Direct mapping |
| `country` | `dispatch_office.country` | text | Default "USA" |
| `phone` | `dispatch_office.phone` | text | Direct mapping |
| `tax_rate` | `dispatch_office.tax_rate` | numeric | Direct mapping |
| `square_customer_id` | `dispatch_office.sq_customer_id` | text | Direct mapping |
| `is_active` | `dispatch_office.valid` | boolean | Direct mapping or default true |
| `email_notifications` | `dispatch_office.emails` | boolean | Direct mapping |
| `created_at` | Current timestamp | timestamp | Migration timestamp |
| `updated_at` | Current timestamp | timestamp | Migration timestamp |
| `metadata` | Constructed | jsonb | Migration metadata |
| `legacy_office_id` | `dispatch_office.id` | integer | **CRITICAL MAPPING** |

---

## 🔄 RELATIONSHIP MAPPINGS

### Primary Key Relationships
```
Source auth_user.id -> Target profiles.legacy_user_id -> Target profiles.id
Source dispatch_patient.id -> Target profiles.legacy_patient_id (patients only)
Source dispatch_office.id -> Target offices.legacy_office_id -> Target offices.id
```

### Foreign Key Relationships
```
doctors.profile_id -> profiles.id (via legacy_user_id matching)
patients.profile_id -> profiles.id (via legacy_user_id matching)
technicians.profile_id -> profiles.id (via legacy_user_id matching)

patients.primary_doctor_id -> doctors.id (via legacy_user_id matching)
patients.assigned_office_id -> offices.id (via legacy_office_id matching)
doctors.primary_office_id -> offices.id (via dispatch_office_doctors relationship)
```

### Migration Join Patterns
```sql
-- Profile to Doctor relationship
SELECT p.*, d.*
FROM profiles p
INNER JOIN doctors d ON d.legacy_user_id = p.legacy_user_id
WHERE p.profile_type = 'doctor'

-- Profile to Patient relationship
SELECT p.*, pat.*
FROM profiles p
INNER JOIN patients pat ON pat.legacy_user_id = p.legacy_user_id
WHERE p.profile_type = 'patient'

-- Source to Target Patient relationship
SELECT au.*, dp.*, p.id as profile_id, pat.id as patient_id
FROM auth_user au
INNER JOIN dispatch_patient dp ON au.id = dp.user_id
INNER JOIN profiles p ON p.legacy_user_id = au.id
INNER JOIN patients pat ON pat.legacy_patient_id = dp.id
```

---

## 📊 DATA QUALITY VALIDATION

### Critical Validation Queries

**1. Profile Completeness Check:**
```sql
-- Every specialized record should have a profile
SELECT
  'doctors' as table_name,
  COUNT(*) as total_records,
  COUNT(profile_id) as with_profiles,
  COUNT(*) - COUNT(profile_id) as missing_profiles
FROM doctors
UNION ALL
SELECT 'patients', COUNT(*), COUNT(profile_id), COUNT(*) - COUNT(profile_id) FROM patients
UNION ALL
SELECT 'technicians', COUNT(*), COUNT(profile_id), COUNT(*) - COUNT(profile_id) FROM technicians;
```

**2. Legacy ID Integrity Check:**
```sql
-- Verify legacy_user_id mapping integrity
SELECT
  p.profile_type,
  COUNT(*) as profile_count,
  COUNT(DISTINCT p.legacy_user_id) as unique_legacy_ids,
  COUNT(*) - COUNT(DISTINCT p.legacy_user_id) as duplicate_legacy_ids
FROM profiles p
GROUP BY p.profile_type;
```

**3. Relationship Integrity Check:**
```sql
-- Check for orphaned specialized records
SELECT
  COUNT(*) as orphaned_doctors
FROM doctors d
LEFT JOIN profiles p ON d.profile_id = p.id
WHERE p.id IS NULL;
```

---

## 🚨 MIGRATION GAPS IDENTIFIED

### Current Data Gaps (November 4, 2025)

1. **Missing Profiles:** 34 profiles (9,839 source users vs 9,805 target profiles)
2. **Missing Patients:** 32 patient records (8,488 source vs 8,456 target)
3. **Profile Relationship Status:** ✅ **ALL SPECIALIZED RECORDS HAVE PROFILES**

### Migration Status Assessment
- **Profiles:** 99.7% complete (9,805/9,839)
- **Patients:** 99.6% complete (8,456/8,488)
- **Doctors:** Fully migrated (1,332 records)
- **Technicians:** Fully migrated (85 records)
- **Profile Linking:** 100% complete (no orphaned records)

---

## 🎯 RECOMMENDED MIGRATION ACTIONS

### Immediate Actions Required:
1. **Migrate 34 missing profiles** from source auth_user
2. **Migrate 32 missing patient records** from source dispatch_patient
3. **Validate legacy_user_id uniqueness** across all profiles

### Migration Priority:
1. **HIGH:** Complete missing profiles (34 records)
2. **HIGH:** Complete missing patients (32 records)
3. **LOW:** Data quality cleanup and optimization

### Implementation Strategy:
1. Use `legacy_user_id` and `legacy_patient_id` as primary mapping keys
2. Maintain all existing profile_id relationships (DO NOT BREAK)
3. Use differential migration (only missing records)
4. Comprehensive validation after each migration phase

---

**This mapping serves as the definitive source for all future migration and synchronization work.**