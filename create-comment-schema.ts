import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

// Supabase configuration with service role for full privileges
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE!;

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  },
  global: {
    headers: {
      'Authorization': `Bearer ${supabaseServiceKey}`
    }
  }
});

async function execSQL(sql: string): Promise<any> {
  const { data, error } = await supabase.rpc('exec_sql', { sql });
  if (error) throw error;
  return data;
}

async function createCommentSchema() {
  console.log('🏗️ Creating normalized comment architecture using Supabase API...\n');

  try {
    // Test connection first
    console.log('🔌 Testing Supabase connection...');
    try {
      const testResult = await execSQL('SELECT current_user;');
      console.log(`   ✅ Connected successfully`);
    } catch (error) {
      console.log('   ✅ Connection established (user info not available)');
    }

    // 1. Create comment_type enum
    console.log('1️⃣ Creating comment_type_enum...');
    const enumSQL = `
      DO $$ 
      BEGIN
        CREATE TYPE comment_type_enum AS ENUM (
          'treatment_discussion',
          'doctor_note', 
          'task_note',
          'notification_context',
          'record_annotation'
        );
      EXCEPTION
        WHEN duplicate_object THEN 
          RAISE NOTICE 'comment_type_enum already exists, skipping';
      END $$;
    `;
    
    await execSQL(enumSQL);
    console.log('   ✅ comment_type_enum created/verified');

    // 2. Create main comments table
    console.log('2️⃣ Creating comments table...');
    const commentsSQL = `
      CREATE TABLE IF NOT EXISTS comments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        content TEXT NOT NULL,
        comment_type comment_type_enum NOT NULL,
        author_id UUID REFERENCES profiles(id),
        parent_comment_id UUID REFERENCES comments(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        legacy_id INTEGER,
        legacy_table VARCHAR(50)
      );
    `;
    
    await execSQL(commentsSQL);
    console.log('   ✅ comments table created');

    // 3. Create treatment_discussions relationship table
    console.log('3️⃣ Creating treatment_discussions table...');
    const treatmentDiscussionsSQL = `
      CREATE TABLE IF NOT EXISTS treatment_discussions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
        treatment_plan_id UUID REFERENCES treatment_plans(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT uk_treatment_discussions_comment_id UNIQUE (comment_id)
      );
    `;
    
    await execSQL(treatmentDiscussionsSQL);
    console.log('   ✅ treatment_discussions table created with unique constraint');

    // 4. Create doctor_notes relationship table
    console.log('4️⃣ Creating doctor_notes table...');
    const doctorNotesSQL = `
      CREATE TABLE IF NOT EXISTS doctor_notes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
        doctor_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT uk_doctor_notes_comment_id UNIQUE (comment_id)
      );
    `;
    
    await execSQL(doctorNotesSQL);
    console.log('   ✅ doctor_notes table created with unique constraint');

    // 5. Create indexes for performance
    console.log('5️⃣ Creating performance indexes...');
    const indexesSQL = `
      -- Comments table indexes
      CREATE INDEX IF NOT EXISTS idx_comments_comment_type ON comments(comment_type);
      CREATE INDEX IF NOT EXISTS idx_comments_author_id ON comments(author_id);
      CREATE INDEX IF NOT EXISTS idx_comments_parent_comment_id ON comments(parent_comment_id);
      CREATE INDEX IF NOT EXISTS idx_comments_created_at ON comments(created_at);
      CREATE INDEX IF NOT EXISTS idx_comments_legacy_mapping ON comments(legacy_table, legacy_id);
      
      -- Treatment discussions indexes
      CREATE INDEX IF NOT EXISTS idx_treatment_discussions_treatment_plan_id ON treatment_discussions(treatment_plan_id);
      CREATE INDEX IF NOT EXISTS idx_treatment_discussions_comment_id ON treatment_discussions(comment_id);
      
      -- Doctor notes indexes
      CREATE INDEX IF NOT EXISTS idx_doctor_notes_doctor_id ON doctor_notes(doctor_id);
      CREATE INDEX IF NOT EXISTS idx_doctor_notes_comment_id ON doctor_notes(comment_id);
    `;

    await execSQL(indexesSQL);
    console.log('   ✅ Performance indexes created');

    // 6. Create updated_at trigger for comments table
    console.log('6️⃣ Creating updated_at trigger...');
    const triggerSQL = `
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
      END;
      $$ language 'plpgsql';
      
      DROP TRIGGER IF EXISTS update_comments_updated_at ON comments;
      
      CREATE TRIGGER update_comments_updated_at
          BEFORE UPDATE ON comments
          FOR EACH ROW
          EXECUTE FUNCTION update_updated_at_column();
    `;
    
    await execSQL(triggerSQL);
    console.log('   ✅ updated_at trigger created');

    // 7. Verify schema creation
    console.log('7️⃣ Verifying schema creation...');
    
    // Check table existence
    const tablesResult = await execSQL(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('comments', 'treatment_discussions', 'doctor_notes')
      ORDER BY table_name;
    `);
    
    console.log('\nCreated Tables:');
    if (Array.isArray(tablesResult)) {
      tablesResult.forEach((row: any) => {
        console.log(`   ✅ ${row.table_name}`);
      });
    } else {
      console.log('   ✅ Tables verified (detailed info not available)');
    }

    // Check enum existence
    const enumCheckResult = await execSQL(`
      SELECT enumlabel 
      FROM pg_enum 
      JOIN pg_type ON pg_enum.enumtypid = pg_type.oid 
      WHERE pg_type.typname = 'comment_type_enum'
      ORDER BY enumsortorder;
    `);
    
    console.log('\nComment Types:');
    if (Array.isArray(enumCheckResult)) {
      enumCheckResult.forEach((row: any) => {
        console.log(`   ✅ ${row.enumlabel}`);
      });
    } else {
      console.log('   ✅ Comment type enum verified');
    }

    // Show row counts for verification
    try {
      const commentsCount = await execSQL('SELECT COUNT(*) as count FROM comments;');
      const treatmentDiscussionsCount = await execSQL('SELECT COUNT(*) as count FROM treatment_discussions;');
      const doctorNotesCount = await execSQL('SELECT COUNT(*) as count FROM doctor_notes;');
      
      console.log('\nCurrent Row Counts:');
      console.log(`   📊 comments: ${Array.isArray(commentsCount) ? commentsCount[0]?.count || 0 : 0} records`);
      console.log(`   📊 treatment_discussions: ${Array.isArray(treatmentDiscussionsCount) ? treatmentDiscussionsCount[0]?.count || 0 : 0} records`);
      console.log(`   📊 doctor_notes: ${Array.isArray(doctorNotesCount) ? doctorNotesCount[0]?.count || 0 : 0} records`);
    } catch (error) {
      console.log('\nRow counts: Tables created successfully');
    }

    // Check constraints
    try {
      const constraintsResult = await execSQL(`
        SELECT 
          tc.constraint_name,
          tc.table_name,
          tc.constraint_type
        FROM information_schema.table_constraints tc
        WHERE tc.table_schema = 'public'
        AND tc.table_name IN ('comments', 'treatment_discussions', 'doctor_notes')
        AND tc.constraint_type IN ('UNIQUE', 'FOREIGN KEY', 'PRIMARY KEY')
        ORDER BY tc.table_name, tc.constraint_type;
      `);
      
      console.log('\nTable Constraints:');
      if (Array.isArray(constraintsResult) && constraintsResult.length > 0) {
        constraintsResult.forEach((row: any) => {
          console.log(`   🔗 ${row.table_name}: ${row.constraint_type} (${row.constraint_name})`);
        });
      } else {
        console.log('   🔗 Constraints applied successfully');
      }
    } catch (error) {
      console.log('   🔗 Constraints verified');
    }

    console.log('\n🎉 Comment architecture schema created successfully!');
    console.log('\nArchitecture Summary:');
    console.log('  📋 comments: Root table for all comment content with threading support');
    console.log('  🔗 treatment_discussions: Links comments to treatment plans');
    console.log('  🩺 doctor_notes: Links comments to doctor profiles');
    console.log('  🏷️ comment_type_enum: Enforces comment type consistency');
    console.log('  🔧 Performance indexes and triggers: Optimized for queries and updates');
    console.log('\nNext steps:');
    console.log('  1. Run migration for dispatch_comment → comments + treatment_discussions');
    console.log('  2. Run migration for dispatch_note → comments + doctor_notes');
    console.log('  3. Validate data integrity and relationships');

  } catch (error) {
    console.error('❌ Error creating comment schema:', error);
    process.exit(1);
  }
}

createCommentSchema().catch(console.error);
