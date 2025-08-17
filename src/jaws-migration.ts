import { createClient } from '@supabase/supabase-js';
import { Client as PgClient } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

// Source database configuration
const sourceDb = new PgClient({
  host: process.env.SOURCE_DB_HOST!,
  port: parseInt(process.env.SOURCE_DB_PORT!),
  user: process.env.SOURCE_DB_USER!,
  password: process.env.SOURCE_DB_PASSWORD!,
  database: process.env.SOURCE_DB_NAME!,
});

// Supabase client configuration
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE!
);

interface SourceJaw {
  id: number;
  bond_teeth: string;
  extract_teeth: string;
  reason: number | null;
  product_id: number | null;
  labial: boolean;
  jaw_type: 'upper' | 'lower';
  instruction_id: number;
}

interface TargetJaw {
  order_id: string;
  product_id: string | null;
  jaw_type: 'upper' | 'lower';
  labial: boolean;
  bond_teeth: string;
  extract_teeth: string;
  replacement_reason: string | null;
  metadata: any;
  legacy_jaw_id: number;
}

// Mapping reason codes to replacement_reason text
const REASON_MAPPING: Record<number, string> = {
  1: 'breakage',   // Assuming reason 1 = breakage
  2: 'other',      // Assuming reason 2 = other  
  3: 'complete',   // Assuming reason 3 = complete
};

class JawsMigration {
  private processed = 0;
  private errors = 0;
  private skipped = 0;
  private orderLookupMap = new Map<number, string>();
  private productLookupMap = new Map<number, string>();
  private batchSize = 100;

  async migrate() {
    const isValidation = process.argv.includes('validate');
    const isRollback = process.argv.includes('rollback');

    if (isValidation) {
      return this.validate();
    }
    
    if (isRollback) {
      return this.rollback();
    }

    console.log('🦷 Starting jaws migration...\n');

    try {
      await sourceDb.connect();
      await this.buildLookupMaps();
      await this.migrateJaws();
      console.log('\n✅ Jaws migration completed successfully!');
      console.log(`📊 Summary: ${this.processed} processed, ${this.errors} errors, ${this.skipped} skipped`);
    } catch (error) {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    } finally {
      await sourceDb.end();
    }
  }

  private async buildLookupMaps() {
    console.log('🔍 Building lookup maps...');

    // Build order lookup map
    console.log('  📋 Building order lookup map...');
    const { data: orders, error: orderError } = await supabase
      .from('orders')
      .select('id, legacy_instruction_id')
      .not('legacy_instruction_id', 'is', null);

    if (orderError) {
      throw new Error(`Error fetching orders: ${orderError.message}`);
    }

    orders?.forEach(order => {
      if (order.legacy_instruction_id) {
        this.orderLookupMap.set(order.legacy_instruction_id, order.id);
      }
    });

    console.log(`    ✅ Built order lookup map: ${this.orderLookupMap.size} orders`);

    // Build product lookup map  
    console.log('  🦷 Building product lookup map...');
    const { data: products, error: productError } = await supabase
      .from('products')
      .select('id, legacy_course_id')
      .not('legacy_course_id', 'is', null);

    if (productError) {
      throw new Error(`Error fetching products: ${productError.message}`);
    }

    products?.forEach(product => {
      if (product.legacy_course_id) {
        this.productLookupMap.set(product.legacy_course_id, product.id);
      }
    });

    console.log(`    ✅ Built product lookup map: ${this.productLookupMap.size} products\n`);
  }

  private async migrateJaws() {
    // Fetch jaws with their jaw_type determined by dispatch_instruction references
    const query = `
      WITH jaw_types AS (
        SELECT 
          dj.id,
          dj.bond_teeth,
          dj.extract_teeth,
          dj.reason,
          dj.product_id,
          dj.labial,
          CASE 
            WHEN di_upper.upper_jaw_id = dj.id THEN 'upper'
            WHEN di_lower.lower_jaw_id = dj.id THEN 'lower'
            ELSE NULL
          END as jaw_type,
          COALESCE(di_upper.id, di_lower.id) as instruction_id
        FROM dispatch_jaw dj
        LEFT JOIN dispatch_instruction di_upper ON di_upper.upper_jaw_id = dj.id
        LEFT JOIN dispatch_instruction di_lower ON di_lower.lower_jaw_id = dj.id
      )
      SELECT 
        id, bond_teeth, extract_teeth, reason, product_id, labial, jaw_type, instruction_id
      FROM jaw_types 
      WHERE jaw_type IS NOT NULL AND instruction_id IS NOT NULL
      ORDER BY id;
    `;

    const result = await sourceDb.query(query);
    const sourceJaws: SourceJaw[] = result.rows;

    console.log(`🦷 Found ${sourceJaws.length} jaws with order relationships to migrate`);

    // Process in batches
    for (let i = 0; i < sourceJaws.length; i += this.batchSize) {
      const batch = sourceJaws.slice(i, i + this.batchSize);
      await this.processBatch(batch);
      
      if (this.processed % 1000 === 0 || i + this.batchSize >= sourceJaws.length) {
        console.log(`⏳ Processed ${this.processed}/${sourceJaws.length} jaws (${Math.round(this.processed/sourceJaws.length * 100)}%)`);
      }
    }
  }

  private async processBatch(batch: SourceJaw[]) {
    const targetJaws: TargetJaw[] = [];

    for (const sourceJaw of batch) {
      try {
        const targetJaw = await this.transformJaw(sourceJaw);
        if (targetJaw) {
          targetJaws.push(targetJaw);
        }
      } catch (error) {
        console.error(`❌ Error transforming jaw ${sourceJaw.id}:`, error);
        this.errors++;
      }
    }

    if (targetJaws.length > 0) {
      try {
        // Try bulk insert first
        const { error } = await supabase
          .from('jaws')
          .insert(targetJaws);

        if (error) {
          console.warn(`⚠️  Bulk insert failed, trying individual inserts: ${error.message}`);
          await this.insertIndividually(targetJaws);
        } else {
          this.processed += targetJaws.length;
        }
      } catch (error) {
        console.error(`❌ Batch insert failed:`, error);
        await this.insertIndividually(targetJaws);
      }
    }
  }

  private async insertIndividually(targetJaws: TargetJaw[]) {
    for (const jaw of targetJaws) {
      try {
        const { error } = await supabase
          .from('jaws')
          .insert(jaw);

        if (error) {
          console.error(`❌ Error inserting jaw ${jaw.legacy_jaw_id}:`, error.message);
          this.errors++;
        } else {
          this.processed++;
        }
      } catch (error) {
        console.error(`❌ Error inserting jaw ${jaw.legacy_jaw_id}:`, error);
        this.errors++;
      }
    }
  }

  private async transformJaw(source: SourceJaw): Promise<TargetJaw | null> {
    // Map instruction_id to order_id
    const orderId = this.orderLookupMap.get(source.instruction_id);
    if (!orderId) {
      console.warn(`⚠️  Skipping jaw ${source.id}: order not found for instruction ${source.instruction_id}`);
      this.skipped++;
      return null;
    }

    // Map product_id to product UUID (optional)
    let productId: string | null = null;
    if (source.product_id) {
      productId = this.productLookupMap.get(source.product_id) || null;
      if (!productId) {
        console.warn(`⚠️  Warning: Product UUID not found for product ${source.product_id} in jaw ${source.id}`);
      }
    }

    // Map reason to replacement_reason
    const replacementReason = source.reason ? REASON_MAPPING[source.reason] || null : null;

    const metadata = {
      legacy_jaw_id: source.id,
      legacy_product_id: source.product_id,
      legacy_instruction_id: source.instruction_id,
      original_reason_code: source.reason,
    };

    return {
      order_id: orderId,
      product_id: productId,
      jaw_type: source.jaw_type,
      labial: source.labial,
      bond_teeth: source.bond_teeth || '0000000000000000',
      extract_teeth: source.extract_teeth || '0000000000000000',
      replacement_reason: replacementReason,
      metadata,
      legacy_jaw_id: source.id,
    };
  }

  private async validate() {
    console.log('🔍 Validating jaws migration...\n');

    try {
      await sourceDb.connect();

      // Count source jaws that should be migrated (those with order relationships)
      const sourceQuery = `
        WITH jaw_types AS (
          SELECT dj.id
          FROM dispatch_jaw dj
          LEFT JOIN dispatch_instruction di_upper ON di_upper.upper_jaw_id = dj.id
          LEFT JOIN dispatch_instruction di_lower ON di_lower.lower_jaw_id = dj.id
          WHERE di_upper.id IS NOT NULL OR di_lower.id IS NOT NULL
        )
        SELECT COUNT(*) as count FROM jaw_types;
      `;
      
      const sourceResult = await sourceDb.query(sourceQuery);
      const sourceCount = parseInt(sourceResult.rows[0].count);

      // Count target jaws
      const { count: targetCount, error } = await supabase
        .from('jaws')
        .select('*', { count: 'exact', head: true });

      if (error) {
        throw new Error(`Error counting target jaws: ${error.message}`);
      }

      console.log('📊 Migration Validation Results:');
      console.log(`Source jaws (with orders): ${sourceCount}`);
      console.log(`Target jaws: ${targetCount}`);
      console.log(`Match: ${sourceCount === targetCount ? '✅ Yes' : '❌ No'}`);

      // Validate jaw type distribution
      const { data: jawTypeDistribution, error: jawTypeError } = await supabase
        .from('jaws')
        .select('jaw_type')
        .not('jaw_type', 'is', null);

      if (jawTypeError) {
        throw new Error(`Error getting jaw type distribution: ${jawTypeError.message}`);
      }

      const upperCount = jawTypeDistribution?.filter(j => j.jaw_type === 'upper').length || 0;
      const lowerCount = jawTypeDistribution?.filter(j => j.jaw_type === 'lower').length || 0;

      console.log('\n📈 Jaw Type Distribution:');
      console.log(`Upper jaws: ${upperCount}`);
      console.log(`Lower jaws: ${lowerCount}`);

    } catch (error) {
      console.error('❌ Validation failed:', error);
      process.exit(1);
    } finally {
      await sourceDb.end();
    }
  }

  private async rollback() {
    console.log('🔄 Rolling back jaws migration...\n');

    try {
      const { error } = await supabase
        .from('jaws')
        .delete()
        .not('legacy_jaw_id', 'is', null);

      if (error) {
        throw new Error(`Rollback error: ${error.message}`);
      }

      console.log('✅ Jaws migration rolled back successfully');

    } catch (error) {
      console.error('❌ Rollback failed:', error);
      process.exit(1);
    }
  }
}

const migration = new JawsMigration();
migration.migrate().catch(console.error);
