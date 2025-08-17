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

interface SourceProduct {
  id: number;
  name: string;
  description: string | null;
  free: boolean;
  deleted: boolean;
  customization: string;
  type: number | null;
  substitute: boolean;
  course_id: number;
}

interface TargetProduct {
  name: string;
  course_type: string;
  base_price: number | null;
  customization: any;
  is_active: boolean;
  metadata: any;
  legacy_course_id: number;
}

// Mapping course_id to course_type enum
const COURSE_TYPE_MAPPING: Record<number, string> = {
  1: 'main',        // Main -> main
  2: 'refinement',  // Refinement -> refinement  
  3: 'replacement', // Replacement -> replacement
  7: 'invoice',     // Invoice -> invoice
};

class ProductsMigration {
  private processed = 0;
  private errors = 0;
  private skipped = 0;

  async migrate() {
    const isValidation = process.argv.includes('validate');
    const isRollback = process.argv.includes('rollback');

    if (isValidation) {
      return this.validate();
    }
    
    if (isRollback) {
      return this.rollback();
    }

    console.log('🚀 Starting products migration...\n');

    try {
      await sourceDb.connect();
      await this.migrateProducts();
      console.log('\n✅ Products migration completed successfully!');
      console.log(`📊 Summary: ${this.processed} processed, ${this.errors} errors, ${this.skipped} skipped`);
    } catch (error) {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    } finally {
      await sourceDb.end();
    }
  }

  private async migrateProducts() {
    // Fetch all active products from source
    const query = `
      SELECT 
        id, name, description, free, deleted, customization, type, substitute, course_id
      FROM dispatch_product
      WHERE deleted = false
      ORDER BY id;
    `;

    const result = await sourceDb.query(query);
    const sourceProducts: SourceProduct[] = result.rows;

    console.log(`📦 Found ${sourceProducts.length} products to migrate`);

    for (const sourceProduct of sourceProducts) {
      try {
        await this.migrateProduct(sourceProduct);
        this.processed++;
        
        if (this.processed % 5 === 0) {
          console.log(`✅ Migrated ${this.processed}/${sourceProducts.length} products`);
        }
      } catch (error) {
        console.error(`❌ Error migrating product ${sourceProduct.id} (${sourceProduct.name}):`, error);
        this.errors++;
      }
    }
  }

  private async migrateProduct(source: SourceProduct) {
    // Check if course_id maps to a valid course_type
    const courseType = COURSE_TYPE_MAPPING[source.course_id];
    if (!courseType) {
      console.warn(`⚠️  Skipping product ${source.id}: unmapped course_id ${source.course_id}`);
      this.skipped++;
      return;
    }

    // Parse customization JSON
    let customization = {};
    let metadata: any = {
      legacy_product_id: source.id,
      source_type: source.type,
      is_substitute: source.substitute,
      source_course_id: source.course_id, // Store the course_id in metadata for reference
    };

    if (source.customization) {
      try {
        customization = JSON.parse(source.customization);
      } catch (error) {
        console.warn(`⚠️  Invalid JSON in customization for product ${source.id}, using empty object`);
        metadata.invalid_customization = source.customization;
      }
    }

    // Add description to metadata if exists
    if (source.description) {
      metadata.description = source.description;
    }

    const targetProduct: TargetProduct = {
      name: source.name,
      course_type: courseType,
      base_price: source.free ? 0.00 : null, // Free products get 0, others get null (to be set later)
      customization,
      is_active: !source.deleted,
      metadata,
      legacy_course_id: source.id, // Use the actual product ID, not course_id!
    };

    // Insert into Supabase
    const { error } = await supabase
      .from('products')
      .insert(targetProduct);

    if (error) {
      throw new Error(`Supabase insert error: ${error.message}`);
    }

    console.log(`✅ Migrated product: ${source.id} -> ${source.name}`);
  }

  private async validate() {
    console.log('🔍 Validating products migration...\n');

    try {
      await sourceDb.connect();

      // Count source products
      const sourceResult = await sourceDb.query('SELECT COUNT(*) FROM dispatch_product WHERE deleted = false');
      const sourceCount = parseInt(sourceResult.rows[0].count);

      // Count target products  
      const { count: targetCount, error } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true });

      if (error) {
        throw new Error(`Error counting target products: ${error.message}`);
      }

      console.log('📊 Migration Validation Results:');
      console.log(`Source products (active): ${sourceCount}`);
      console.log(`Target products: ${targetCount}`);
      console.log(`Match: ${sourceCount === targetCount ? '✅ Yes' : '❌ No'}`);

      // Validate specific mappings
      const mappingResult = await sourceDb.query(`
        SELECT course_id, COUNT(*) as count 
        FROM dispatch_product 
        WHERE deleted = false 
        GROUP BY course_id 
        ORDER BY course_id
      `);

      console.log('\n📈 Course Distribution Validation:');
      for (const row of mappingResult.rows) {
        const courseType = COURSE_TYPE_MAPPING[row.course_id];
        console.log(`Course ${row.course_id} -> ${courseType}: ${row.count} products`);
      }

    } catch (error) {
      console.error('❌ Validation failed:', error);
      process.exit(1);
    } finally {
      await sourceDb.end();
    }
  }

  private async rollback() {
    console.log('🔄 Rolling back products migration...\n');

    try {
      // Delete all products (they have legacy_course_id which indicates they were migrated)
      const { error } = await supabase
        .from('products')
        .delete()
        .not('legacy_course_id', 'is', null);

      if (error) {
        throw new Error(`Rollback error: ${error.message}`);
      }

      console.log('✅ Products migration rolled back successfully');

    } catch (error) {
      console.error('❌ Rollback failed:', error);
      process.exit(1);
    }
  }
}

const migration = new ProductsMigration();
migration.migrate().catch(console.error);
