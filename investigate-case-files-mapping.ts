import dotenv from 'dotenv';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

async function investigateMapping() {
    console.log('🔍 Investigating case_files mapping requirements...\n');
    
    // 1. First, check target case_files table schema by looking at constraints
    console.log('📋 Checking case_files table constraints...');
    
    const { data: constraintData, error: constraintError } = await supabase.rpc('exec_sql', {
        sql: `
            SELECT 
                conname as constraint_name,
                pg_get_constraintdef(c.oid) as constraint_def
            FROM pg_constraint c
            JOIN pg_class t ON c.conrelid = t.oid
            JOIN pg_namespace n ON t.relnamespace = n.oid
            WHERE t.relname = 'case_files' AND n.nspname = 'public';
        `
    });
    
    if (constraintData) {
        console.log('Constraints found:');
        constraintData.forEach(row => {
            console.log(`  ${row.constraint_name}: ${row.constraint_def}`);
        });
    }
    
    // 2. Check source instruction to case relationships
    const sourceClient = new Client({
        host: process.env.SOURCE_DB_HOST!,
        port: parseInt(process.env.SOURCE_DB_PORT!),
        user: process.env.SOURCE_DB_USER!,
        password: process.env.SOURCE_DB_PASSWORD!,
        database: process.env.SOURCE_DB_NAME!,
    });
    
    try {
        await sourceClient.connect();
        
        console.log('\n🔗 Analyzing instruction to case relationships...');
        
        // Check dispatch_instruction structure
        const instructionStructure = await sourceClient.query(`
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_name = 'dispatch_instruction' AND table_schema = 'public'
            ORDER BY ordinal_position;
        `);
        
        console.log('\n📋 dispatch_instruction structure:');
        instructionStructure.rows.forEach(col => {
            console.log(`  - ${col.column_name}: ${col.data_type}`);
        });
        
        // Sample instructions to understand the relationship
        const sampleInstructions = await sourceClient.query(`
            SELECT * FROM dispatch_instruction
            ORDER BY id
            LIMIT 3;
        `);
        
        console.log('\n📄 Sample dispatch_instruction records:');
        sampleInstructions.rows.forEach((row, index) => {
            console.log(`Instruction ${index + 1}:`, JSON.stringify(row, null, 2));
        });
        
        // Check how instructions relate to cases/orders
        console.log('\n🔍 Checking instruction relationships...');
        
        // Look for case_id or patient_id in instructions
        const instructionCaseLinks = await sourceClient.query(`
            SELECT COUNT(*) as count
            FROM dispatch_instruction
            WHERE case_id IS NOT NULL;
        `);
        console.log(`Instructions with case_id: ${instructionCaseLinks.rows[0].count}`);
        
        // Check if we have patient relationships
        try {
            const instructionPatientLinks = await sourceClient.query(`
                SELECT COUNT(*) as count
                FROM dispatch_instruction
                WHERE patient_id IS NOT NULL;
            `);
            console.log(`Instructions with patient_id: ${instructionPatientLinks.rows[0].count}`);
        } catch (e) {
            console.log('Instructions with patient_id: Column not found');
        }
        
        // Check cases table to see what we have migrated
        console.log('\n📊 Checking target cases for mapping...');
        
        const { data: casesData, error: casesError } = await supabase
            .from('cases')
            .select('id, legacy_case_id')
            .limit(5);
            
        if (casesData) {
            console.log('Sample migrated cases:');
            casesData.forEach(caseRow => {
                console.log(`  Case ID: ${caseRow.id}, Legacy ID: ${caseRow.legacy_case_id}`);
            });
        }
        
        // Check orders table
        const { data: ordersData, error: ordersError } = await supabase
            .from('orders')
            .select('id, legacy_order_id, case_id')
            .limit(5);
            
        if (ordersData) {
            console.log('\nSample migrated orders:');
            ordersData.forEach(orderRow => {
                console.log(`  Order ID: ${orderRow.id}, Legacy ID: ${orderRow.legacy_order_id}, Case ID: ${orderRow.case_id}`);
            });
        }
        
    } catch (error) {
        console.error('❌ Error investigating mapping:', error);
    } finally {
        await sourceClient.end();
    }
}

investigateMapping().catch(console.error);
