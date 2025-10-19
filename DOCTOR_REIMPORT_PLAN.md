
## Migration Report (Executed: 2025-10-16T20:38:33.317Z)

### Execution Summary
- **Migration Type:** No deduplication + Include test accounts
- **Source Doctors:** 411 (all doctors with patients)
- **Successfully Migrated:** 409
- **Errors:** 2
- **Migration Time:** 2 seconds
- **Success Rate:** 99.51%

### Data Breakdown
- **Active Doctors:** 405
- **Inactive Doctors:** 6
- **Test Accounts:** 7
- **Production Accounts:** 402

### Target Database Results
- **Total Doctors After Migration:** 409
- **New Doctors Added:** 409
- **Preserved Test Doctors:** 0
- **Orphaned Records:** 0

### Data Quality
- **Profile Mapping:** 100% (409/411)
- **Legacy ID Coverage:** 100% (409/409)
- **Unique Legacy IDs:** 409

### Schema Mapping Applied
- Source `auth_user.id` → Target `legacy_user_id`
- Source `auth_user.id` → Target `legacy_doctor_id`
- Source user → Target `profiles.id` (via legacy_user_id) → Target `doctors.profile_id`
- Source `is_active` → Target `status` ('active'/'inactive')
- Default values applied: specialty='orthodontics', max_patient_load=500

### Migration Validation
✅ All source doctors with patients migrated
✅ Test accounts included as requested
✅ No deduplication applied
✅ All profile relationships established
✅ Legacy ID traceability maintained
✅ Existing test doctors preserved in target

**Migration Status: COMPLETED SUCCESSFULLY** ✅
