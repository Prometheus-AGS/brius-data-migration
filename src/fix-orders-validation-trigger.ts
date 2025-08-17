import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE!;
  
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
  
  try {
    console.log('🔧 Fixing orders validation trigger...');
    
    // Create a temporary function that will execute our DDL
    const tempFunctionSQL = `
      CREATE OR REPLACE FUNCTION temp_fix_validation()
      RETURNS text
      LANGUAGE plpgsql
      SECURITY DEFINER
      AS $temp$
      BEGIN
        -- Update the validate_orders function
        EXECUTE $fix$
          CREATE OR REPLACE FUNCTION validate_orders()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $function$
          BEGIN
              -- Check if patient_id exists in patients table (not profiles)
              IF NOT EXISTS (SELECT 1 FROM patients WHERE id = NEW.patient_id) THEN
                  RAISE EXCEPTION ''Patient ID must reference a valid patient'';
              END IF;

              -- Check if doctor_id references a doctor profile
              IF NOT validate_profile_type(NEW.doctor_id, ''doctor'') THEN
                  RAISE EXCEPTION ''Doctor ID must reference a doctor profile'';
              END IF;

              RETURN NEW;
          END;
          $function$;
        $fix$;
        
        RETURN 'validate_orders function updated successfully';
      END;
      $temp$;
    `;
    
    // First, create the temporary function
    const { error: createError } = await supabase.rpc('exec', { 
      sql: tempFunctionSQL 
    });
    
    if (createError) {
      console.log('❌ Could not create temp function, trying direct approach...');
      console.log('Error:', createError);
      
      // Try direct SQL execution through PostgREST SQL interface
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sql: `
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
          `
        })
      });
      
      const result = await response.text();
      console.log('Direct SQL result:', result);
      
      if (!response.ok) {
        console.error('❌ Direct SQL execution failed');
        console.error('Response:', result);
        process.exit(1);
      }
    } else {
      // Call the temporary function to execute our fix
      const { data: execData, error: execError } = await supabase.rpc('temp_fix_validation');
      
      if (execError) {
        console.error('❌ Error executing temp function:', execError);
        process.exit(1);
      }
      
      console.log('✅ Temp function result:', execData);
      
      // Clean up the temporary function
      await supabase.rpc('exec', { 
        sql: 'DROP FUNCTION IF EXISTS temp_fix_validation();' 
      });
    }
    
    console.log('✅ Successfully updated the validate_orders function');
    console.log('🎯 The orders table now correctly validates against the patients table');
    
  } catch (error) {
    console.error('❌ Failed to fix validation trigger:', error);
    process.exit(1);
  }
}

main().catch(console.error);
