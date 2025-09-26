#!/usr/bin/env ts-node

/**
 * Fix Orders Doctor References
 *
 * This script fixes the 20,529 orders that have invalid doctor_id UUIDs
 * by looking up the correct doctor from the source database and updating
 * the orders with the proper doctor UUID from the profiles table.
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface SourceOrderDoctor {
  legacy_instruction_id: number;
  doctor_id: number;
}

interface DoctorMapping {
  legacy_user_id: number;
  profile_uuid: string;
}

class OrdersDoctorFixer {
  private sourcePool: Pool;
  private targetPool: Pool;

  constructor() {
    this.sourcePool = new Pool({
      host: process.env.SOURCE_DB_HOST,
      port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
      database: process.env.SOURCE_DB_NAME,
      user: process.env.SOURCE_DB_USER,
      password: process.env.SOURCE_DB_PASSWORD,
    });

    this.targetPool = new Pool({
      host: process.env.TARGET_DB_HOST,
      port: parseInt(process.env.TARGET_DB_PORT || '5432'),
      database: process.env.TARGET_DB_NAME,
      user: process.env.TARGET_DB_USER,
      password: process.env.TARGET_DB_PASSWORD,
    });
  }

  async fixOrdersDoctorReferences(): Promise<void> {
    console.log('🔧 Starting fix for orders doctor references...');

    try {
      // Step 1: Get problematic orders
      console.log('📋 Finding orders with invalid doctor references...');
      const problematicOrders = await this.targetPool.query(`
        SELECT legacy_instruction_id, doctor_id
        FROM orders o
        WHERE legacy_instruction_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM doctors d WHERE d.id = o.doctor_id)
        ORDER BY legacy_instruction_id
      `);

      console.log(`Found ${problematicOrders.rows.length} orders with invalid doctor references`);

      if (problematicOrders.rows.length === 0) {
        console.log('✅ No orders need fixing!');
        return;
      }

      // Step 2: Get correct doctor assignments from source
      console.log('🔍 Getting correct doctor assignments from source database...');
      const instructionIds = problematicOrders.rows.map(row => row.legacy_instruction_id);

      const sourceAssignments = await this.sourcePool.query(`
        SELECT
          i.id as legacy_instruction_id,
          p.doctor_id
        FROM dispatch_instruction i
        INNER JOIN dispatch_patient p ON i.patient_id = p.id
        WHERE i.id = ANY($1)
        ORDER BY i.id
      `, [instructionIds]);

      console.log(`Retrieved ${sourceAssignments.rows.length} source doctor assignments`);

      // Step 3: Build doctor UUID lookup map
      console.log('🗺️ Building doctor UUID lookup map...');
      const uniqueDoctorIds = [...new Set(sourceAssignments.rows.map((row: SourceOrderDoctor) => row.doctor_id))];

      const doctorMappings = await this.targetPool.query(`
        SELECT legacy_user_id, id as doctor_uuid
        FROM doctors
        WHERE legacy_user_id = ANY($1)
      `, [uniqueDoctorIds]);

      const doctorMap = new Map<number, string>();
      doctorMappings.rows.forEach((row: any) => {
        doctorMap.set(row.legacy_user_id, row.doctor_uuid);
      });

      console.log(`Built lookup map for ${doctorMap.size} doctors`);

      // Step 4: Prepare updates
      console.log('🔄 Preparing order updates...');
      const updates: Array<{ legacy_instruction_id: number; new_doctor_id: string }> = [];
      let skippedCount = 0;

      for (const sourceAssignment of sourceAssignments.rows) {
        const doctorUuid = doctorMap.get(sourceAssignment.doctor_id);
        if (doctorUuid) {
          updates.push({
            legacy_instruction_id: sourceAssignment.legacy_instruction_id,
            new_doctor_id: doctorUuid
          });
        } else {
          skippedCount++;
          console.warn(`⚠️ No doctor UUID found for legacy_user_id ${sourceAssignment.doctor_id} (instruction ${sourceAssignment.legacy_instruction_id})`);
        }
      }

      console.log(`Prepared ${updates.length} updates, skipped ${skippedCount} orders`);

      // Step 5: Execute updates in batches
      console.log('💾 Updating orders with correct doctor references...');
      const batchSize = 1000;
      let updatedCount = 0;

      for (let i = 0; i < updates.length; i += batchSize) {
        const batch = updates.slice(i, i + batchSize);

        console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(updates.length / batchSize)}...`);

        for (const update of batch) {
          try {
            const result = await this.targetPool.query(`
              UPDATE orders
              SET doctor_id = $1, updated_at = NOW()
              WHERE legacy_instruction_id = $2
            `, [update.new_doctor_id, update.legacy_instruction_id]);

            if (result.rowCount && result.rowCount > 0) {
              updatedCount++;
            }
          } catch (error) {
            console.error(`❌ Failed to update order ${update.legacy_instruction_id}:`, error);
          }
        }
      }

      console.log(`✅ Successfully updated ${updatedCount} orders`);

      // Step 6: Validate the fix
      console.log('🔍 Validating the fix...');
      const remainingProblems = await this.targetPool.query(`
        SELECT COUNT(*) as count
        FROM orders o
        WHERE legacy_instruction_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM doctors d WHERE d.id = o.doctor_id)
      `);

      const remainingCount = parseInt(remainingProblems.rows[0].count);
      console.log(`📊 Remaining orders with invalid doctor references: ${remainingCount}`);

      if (remainingCount === 0) {
        console.log('🎉 All orders now have valid doctor references!');
      } else {
        console.log(`⚠️ ${remainingCount} orders still need attention`);
      }

    } catch (error) {
      console.error('❌ Error during fix process:', error);
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    await this.sourcePool.end();
    await this.targetPool.end();
  }
}

// Main execution
async function main() {
  const fixer = new OrdersDoctorFixer();

  try {
    await fixer.fixOrdersDoctorReferences();
  } catch (error) {
    console.error('💥 Fix process failed:', error);
    process.exit(1);
  } finally {
    await fixer.cleanup();
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}