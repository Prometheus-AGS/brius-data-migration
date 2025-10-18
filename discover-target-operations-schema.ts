import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function discoverTargetOperationsSchema() {
  console.log('🔍 Discovering actual operations table schema...\n');

  // Common operation field combinations to test
  const testConfigurations = [
    {
      name: 'Basic operation fields',
      fields: {
        case_id: '00000000-0000-0000-0000-000000000001',
        description: 'Test operation',
        status: 'completed'
      }
    },
    {
      name: 'Simple minimal fields',
      fields: {
        case_id: '00000000-0000-0000-0000-000000000001'
      }
    },
    {
      name: 'With payment info',
      fields: {
        case_id: '00000000-0000-0000-0000-000000000001',
        payment_id: '00000000-0000-0000-0000-000000000002',
        total_amount: 100.50
      }
    },
    {
      name: 'Alternative amount field names',
      fields: {
        case_id: '00000000-0000-0000-0000-000000000001',
        cost: 100.50,
        price: 100.50
      }
    },
    {
      name: 'Healthcare/medical operation fields',
      fields: {
        case_id: '00000000-0000-0000-0000-000000000001',
        procedure_name: 'Test procedure',
        procedure_cost: 100.50
      }
    },
    {
      name: 'Transaction fields',
      fields: {
        case_id: '00000000-0000-0000-0000-000000000001',
        transaction_id: 'test_transaction_123',
        transaction_amount: 100.50,
        transaction_type: 'payment'
      }
    },
    {
      name: 'Order-related operation',
      fields: {
        case_id: '00000000-0000-0000-0000-000000000001',
        order_id: '00000000-0000-0000-0000-000000000003',
        operation_name: 'Payment processing'
      }
    }
  ];

  const successfulFields: string[] = [];
  let workingConfiguration: any = null;

  for (const config of testConfigurations) {
    console.log(`🧪 Testing: ${config.name}`);

    try {
      const { data: insertResult, error: insertError } = await supabase
        .from('operations')
        .insert(config.fields)
        .select();

      if (insertError) {
        console.log(`   ❌ ${insertError.message}`);
      } else {
        console.log(`   ✅ SUCCESS! Fields: ${Object.keys(config.fields).join(', ')}`);
        workingConfiguration = config;

        // Clean up successful test record
        if (insertResult && insertResult.length > 0) {
          await supabase
            .from('operations')
            .delete()
            .eq('id', insertResult[0].id);
          console.log(`   🧹 Cleaned up test record`);
        }

        break; // Stop on first success
      }
    } catch (error: any) {
      console.log(`   ❌ Exception: ${error.message}`);
    }
  }

  if (workingConfiguration) {
    console.log(`\n🎉 Found working configuration: ${workingConfiguration.name}`);
    console.log(`📋 Required fields: ${Object.keys(workingConfiguration.fields).join(', ')}`);

    // Try to determine what other fields might be available
    console.log(`\n🔍 Testing additional optional fields...`);

    const additionalFields = [
      'created_at', 'updated_at', 'metadata', 'notes', 'operation_date',
      'performed_by', 'doctor_id', 'patient_id', 'office_id', 'room_id',
      'duration_minutes', 'success', 'complications'
    ];

    const baseFields = { ...workingConfiguration.fields };
    const availableOptionalFields: string[] = [];

    for (const field of additionalFields) {
      const testFields = {
        ...baseFields,
        [field]: field.includes('_id') ? '00000000-0000-0000-0000-000000000004' :
                field.includes('_at') ? new Date().toISOString() :
                field === 'metadata' ? { test: true } :
                field === 'duration_minutes' ? 30 :
                field === 'success' ? true :
                field === 'complications' ? false :
                `test_${field}`
      };

      try {
        const { data: testResult, error: testError } = await supabase
          .from('operations')
          .insert(testFields)
          .select();

        if (!testError && testResult) {
          availableOptionalFields.push(field);
          console.log(`   ✅ ${field}: Available`);

          // Clean up
          await supabase
            .from('operations')
            .delete()
            .eq('id', testResult[0].id);
        } else {
          console.log(`   ❌ ${field}: ${testError?.message || 'Not available'}`);
        }
      } catch (error: any) {
        console.log(`   ❌ ${field}: ${error.message}`);
      }
    }

    console.log(`\n📊 FINAL SCHEMA DISCOVERY:`);
    console.log(`✅ Required fields: ${Object.keys(workingConfiguration.fields).join(', ')}`);
    console.log(`✅ Optional fields: ${availableOptionalFields.join(', ')}`);

    return {
      requiredFields: Object.keys(workingConfiguration.fields),
      optionalFields: availableOptionalFields,
      workingExample: workingConfiguration.fields
    };

  } else {
    console.log(`\n❌ Could not find any working field configuration for operations table`);
    console.log(`💡 The operations table might have a very specific schema or be read-only`);

    return null;
  }
}

// Run the discovery
if (require.main === module) {
  discoverTargetOperationsSchema()
    .then(result => {
      if (result) {
        console.log('\n🎯 Ready to create migration script with discovered schema!');
      }
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export default discoverTargetOperationsSchema;