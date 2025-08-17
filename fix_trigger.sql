CREATE OR REPLACE FUNCTION validate_orders()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM patients WHERE id = NEW.patient_id) THEN
        RAISE EXCEPTION 'Patient ID must reference a valid patient';
    END IF;
    IF NOT validate_profile_type(NEW.doctor_id, 'doctor') THEN
        RAISE EXCEPTION 'Doctor ID must reference a doctor profile';
    END IF;
    RETURN NEW;
END;
$function$;
