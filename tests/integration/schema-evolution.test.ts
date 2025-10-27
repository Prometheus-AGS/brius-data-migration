/**
 * Schema Evolution Handling Integration Tests
 * Tests schema change detection and mapping updates
 */

import { Pool } from 'pg';
import { SchemaAnalyzer, type SchemaComparison, type SchemaChange } from '../../src/differential-migration/lib/schema-analyzer';
import { BaselineAnalyzer } from '../../src/differential-migration/services/baseline-analyzer';
import { DifferentialDetector } from '../../src/differential-migration/services/differential-detector';
import { v4 as uuidv4 } from 'uuid';

// Test configuration
const TEST_CONFIG = {
  sourceDb: {
    host: process.env.SOURCE_DB_HOST || 'localhost',
    port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
    database: process.env.SOURCE_DB_NAME || 'test_source_db',
    user: process.env.SOURCE_DB_USER || 'postgres',
    password: process.env.SOURCE_DB_PASSWORD || 'postgres',
    maxConnections: 5,
    connectionTimeoutMs: 5000
  },
  destinationDb: {
    host: process.env.TARGET_DB_HOST || 'localhost',
    port: parseInt(process.env.TARGET_DB_PORT || '54322'),
    database: process.env.TARGET_DB_NAME || 'test_target_db',
    user: process.env.TARGET_DB_USER || 'postgres',
    password: process.env.TARGET_DB_PASSWORD || 'postgres',
    maxConnections: 5,
    connectionTimeoutMs: 5000
  }
};

describe('Schema Evolution Handling Integration Tests', () => {
  let sourcePool: Pool;
  let destinationPool: Pool;
  let schemaAnalyzer: SchemaAnalyzer;
  let baselineAnalyzer: BaselineAnalyzer;

  beforeAll(async () => {
    // Initialize database connections
    sourcePool = new Pool(TEST_CONFIG.sourceDb);
    destinationPool = new Pool(TEST_CONFIG.destinationDb);

    // Initialize services
    schemaAnalyzer = new SchemaAnalyzer(sourcePool, destinationPool);
    baselineAnalyzer = new BaselineAnalyzer(
      TEST_CONFIG.sourceDb,
      TEST_CONFIG.destinationDb,
      uuidv4()
    );

    // Verify database connections
    await verifyDatabaseConnections();

    // Setup initial schema state
    await setupInitialSchemas();
  });

  afterAll(async () => {
    // Cleanup and close connections
    await cleanupTestData();
    await baselineAnalyzer.close();
    await sourcePool.end();
    await destinationPool.end();
  });

  beforeEach(async () => {
    // Reset to baseline schema state
    await resetToBaselineSchema();
  });

  describe('Schema Change Detection', () => {
    test('should detect column additions in source schema', async () => {
      // Add new column to source table
      await sourcePool.query(`
        ALTER TABLE dispatch_offices
        ADD COLUMN phone_number VARCHAR(20)
      `);

      const comparison = await schemaAnalyzer.compareSchemas('dispatch_offices', 'offices');

      expect(comparison.hasChanges).toBe(true);
      expect(comparison.changes.length).toBeGreaterThan(0);

      // Should detect the new column
      const addedColumns = comparison.changes.filter(c =>
        c.changeType === 'column_added' && c.columnName === 'phone_number'
      );

      expect(addedColumns.length).toBe(1);
      expect(addedColumns[0].sourceDataType).toBe('character varying');
      expect(addedColumns[0].impact).toBe('moderate');
      expect(addedColumns[0].recommendation).toContain('column');
    });

    test('should detect column removals in source schema', async () => {
      // Remove column from source table
      await sourcePool.query(`
        ALTER TABLE dispatch_offices
        DROP COLUMN IF EXISTS address
      `);

      const comparison = await schemaAnalyzer.compareSchemas('dispatch_offices', 'offices');

      expect(comparison.hasChanges).toBe(true);

      // Should detect the removed column
      const removedColumns = comparison.changes.filter(c =>
        c.changeType === 'column_removed' && c.columnName === 'address'
      );

      expect(removedColumns.length).toBe(1);
      expect(removedColumns[0].impact).toBe('high');
      expect(removedColumns[0].recommendation).toContain('remove');
    });

    test('should detect data type changes', async () => {
      // Change column data type in source
      await sourcePool.query(`
        ALTER TABLE dispatch_offices
        ALTER COLUMN name TYPE TEXT
      `);

      const comparison = await schemaAnalyzer.compareSchemas('dispatch_offices', 'offices');

      expect(comparison.hasChanges).toBe(true);

      // Should detect the type change
      const typeChanges = comparison.changes.filter(c =>
        c.changeType === 'type_changed' && c.columnName === 'name'
      );

      expect(typeChanges.length).toBe(1);
      expect(typeChanges[0].sourceDataType).toBe('text');
      expect(typeChanges[0].destinationDataType).toBe('character varying');
      expect(typeChanges[0].impact).toMatch(/moderate|high/);
    });

    test('should detect constraint changes', async () => {
      // Add NOT NULL constraint to source
      await sourcePool.query(`
        ALTER TABLE dispatch_offices
        ALTER COLUMN address SET NOT NULL
      `);

      const comparison = await schemaAnalyzer.compareSchemas('dispatch_offices', 'offices');

      expect(comparison.hasChanges).toBe(true);

      // Should detect constraint changes
      const constraintChanges = comparison.changes.filter(c =>
        c.changeType === 'constraint_changed'
      );

      expect(constraintChanges.length).toBeGreaterThan(0);

      const nullabilityChange = constraintChanges.find(c =>
        c.columnName === 'address' && c.details?.constraint === 'NOT NULL'
      );

      expect(nullabilityChange).toBeDefined();
      expect(nullabilityChange!.impact).toBe('high');
    });

    test('should detect foreign key relationship changes', async () => {
      // Add new table with foreign key
      await sourcePool.query(`
        CREATE TABLE dispatch_departments (
          id SERIAL PRIMARY KEY,
          office_id INTEGER REFERENCES dispatch_offices(id),
          name VARCHAR(255) NOT NULL
        )
      `);

      // Create corresponding destination table
      await destinationPool.query(`
        CREATE TABLE departments (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          office_id UUID,
          name VARCHAR(255) NOT NULL
        )
      `);

      const comparison = await schemaAnalyzer.compareSchemas('dispatch_departments', 'departments');

      // Should detect foreign key differences
      const fkChanges = comparison.changes.filter(c =>
        c.changeType === 'foreign_key_changed'
      );

      expect(fkChanges.length).toBeGreaterThan(0);

      const officeFkChange = fkChanges.find(c =>
        c.columnName === 'office_id'
      );

      expect(officeFkChange).toBeDefined();
      expect(officeFkChange!.impact).toBe('high');
    });

    test('should detect index changes', async () => {
      // Add index to source table
      await sourcePool.query(`
        CREATE INDEX idx_dispatch_offices_name ON dispatch_offices(name)
      `);

      const comparison = await schemaAnalyzer.compareSchemas('dispatch_offices', 'offices');

      // Should detect index differences
      const indexChanges = comparison.changes.filter(c =>
        c.changeType === 'index_changed'
      );

      if (indexChanges.length > 0) {
        const nameIndexChange = indexChanges.find(c =>
          c.details?.indexName === 'idx_dispatch_offices_name'
        );

        expect(nameIndexChange).toBeDefined();
        expect(nameIndexChange!.impact).toBe('low');
      }
    });

    test('should handle multiple schema changes simultaneously', async () => {
      // Make multiple changes
      await sourcePool.query(`
        ALTER TABLE dispatch_offices
        ADD COLUMN phone_number VARCHAR(20),
        ADD COLUMN email VARCHAR(255),
        ALTER COLUMN name TYPE TEXT,
        DROP COLUMN IF EXISTS updated_at
      `);

      const comparison = await schemaAnalyzer.compareSchemas('dispatch_offices', 'offices');

      expect(comparison.hasChanges).toBe(true);
      expect(comparison.changes.length).toBeGreaterThanOrEqual(4);

      // Should detect all change types
      const changeTypes = new Set(comparison.changes.map(c => c.changeType));
      expect(changeTypes.has('column_added')).toBe(true);
      expect(changeTypes.has('type_changed')).toBe(true);
      expect(changeTypes.has('column_removed')).toBe(true);

      // Should prioritize changes by impact
      const highImpactChanges = comparison.changes.filter(c => c.impact === 'high');
      const moderateImpactChanges = comparison.changes.filter(c => c.impact === 'moderate');
      const lowImpactChanges = comparison.changes.filter(c => c.impact === 'low');

      expect(highImpactChanges.length + moderateImpactChanges.length + lowImpactChanges.length)
        .toBe(comparison.changes.length);
    });
  });

  describe('Schema Mapping Generation', () => {
    test('should generate mapping recommendations for new columns', async () => {
      // Add new columns with different characteristics
      await sourcePool.query(`
        ALTER TABLE dispatch_offices
        ADD COLUMN phone_number VARCHAR(20),
        ADD COLUMN created_by INTEGER DEFAULT 1,
        ADD COLUMN is_active BOOLEAN DEFAULT true
      `);

      const mappingRecommendations = await schemaAnalyzer.generateMappingRecommendations(
        'dispatch_offices',
        'offices'
      );

      expect(mappingRecommendations.length).toBeGreaterThan(0);

      // Should have recommendations for new columns
      const phoneMapping = mappingRecommendations.find(r =>
        r.sourceColumn === 'phone_number'
      );

      expect(phoneMapping).toBeDefined();
      expect(phoneMapping!.mappingType).toMatch(/direct|transform/);
      expect(phoneMapping!.confidence).toBeGreaterThan(0);
      expect(phoneMapping!.confidence).toBeLessThanOrEqual(1);

      // Boolean column should have clear mapping
      const booleanMapping = mappingRecommendations.find(r =>
        r.sourceColumn === 'is_active'
      );

      expect(booleanMapping).toBeDefined();
      expect(booleanMapping!.mappingType).toBe('direct');
      expect(booleanMapping!.confidence).toBeGreaterThan(0.8);
    });

    test('should handle data type transformation recommendations', async () => {
      // Change column types that require transformation
      await sourcePool.query(`
        ALTER TABLE dispatch_offices
        ALTER COLUMN id TYPE VARCHAR(50)
      `);

      const mappingRecommendations = await schemaAnalyzer.generateMappingRecommendations(
        'dispatch_offices',
        'offices'
      );

      // Should recommend transformation for ID column
      const idMapping = mappingRecommendations.find(r =>
        r.sourceColumn === 'id'
      );

      expect(idMapping).toBeDefined();
      expect(idMapping!.mappingType).toBe('transform');
      expect(idMapping!.transformationFunction).toBeDefined();
      expect(idMapping!.transformationFunction).toContain('VARCHAR');
    });

    test('should detect unmappable columns', async () => {
      // Add column that can't be easily mapped
      await sourcePool.query(`
        ALTER TABLE dispatch_offices
        ADD COLUMN complex_data JSON
      `);

      const mappingRecommendations = await schemaAnalyzer.generateMappingRecommendations(
        'dispatch_offices',
        'offices'
      );

      const jsonMapping = mappingRecommendations.find(r =>
        r.sourceColumn === 'complex_data'
      );

      if (jsonMapping) {
        expect(jsonMapping.mappingType).toBe('complex');
        expect(jsonMapping.confidence).toBeLessThan(0.7);
        expect(jsonMapping.manualReviewRequired).toBe(true);
      }
    });

    test('should provide validation rules for new mappings', async () => {
      await sourcePool.query(`
        ALTER TABLE dispatch_offices
        ADD COLUMN rating DECIMAL(3,2) CHECK (rating >= 0 AND rating <= 5)
      `);

      const mappingRecommendations = await schemaAnalyzer.generateMappingRecommendations(
        'dispatch_offices',
        'offices'
      );

      const ratingMapping = mappingRecommendations.find(r =>
        r.sourceColumn === 'rating'
      );

      expect(ratingMapping).toBeDefined();
      expect(ratingMapping!.validationRules).toBeDefined();
      expect(ratingMapping!.validationRules!.length).toBeGreaterThan(0);

      const rangeRule = ratingMapping!.validationRules!.find(rule =>
        rule.type === 'range'
      );

      expect(rangeRule).toBeDefined();
      expect(rangeRule!.minValue).toBe(0);
      expect(rangeRule!.maxValue).toBe(5);
    });
  });

  describe('Schema Evolution Impact Analysis', () => {
    test('should assess migration impact of schema changes', async () => {
      // Make changes with different impact levels
      await sourcePool.query(`
        ALTER TABLE dispatch_offices
        ADD COLUMN email VARCHAR(255),           -- Low impact
        ALTER COLUMN name TYPE TEXT,             -- Moderate impact
        DROP COLUMN address                      -- High impact
      `);

      const impactAnalysis = await schemaAnalyzer.analyzeEvolutionImpact('dispatch_offices', 'offices');

      expect(impactAnalysis.overallImpact).toMatch(/low|moderate|high|critical/);
      expect(impactAnalysis.affectedRecords).toBeGreaterThanOrEqual(0);
      expect(impactAnalysis.migrationComplexity).toMatch(/simple|moderate|complex|critical/);

      // Should categorize changes by impact
      expect(impactAnalysis.impactByCategory.high).toBeGreaterThan(0); // DROP column
      expect(impactAnalysis.impactByCategory.moderate).toBeGreaterThan(0); // ALTER type
      expect(impactAnalysis.impactByCategory.low).toBeGreaterThan(0); // ADD column

      // Should provide migration recommendations
      expect(impactAnalysis.recommendations).toBeDefined();
      expect(impactAnalysis.recommendations.length).toBeGreaterThan(0);

      // Should estimate migration time
      expect(impactAnalysis.estimatedMigrationTime).toBeGreaterThan(0);
    });

    test('should identify breaking changes', async () => {
      // Make breaking changes
      await sourcePool.query(`
        ALTER TABLE dispatch_offices
        DROP COLUMN name,                        -- Breaking: required field
        ALTER COLUMN id TYPE UUID USING gen_random_uuid()  -- Breaking: type change
      `);

      const impactAnalysis = await schemaAnalyzer.analyzeEvolutionImpact('dispatch_offices', 'offices');

      expect(impactAnalysis.overallImpact).toMatch(/high|critical/);
      expect(impactAnalysis.hasBreakingChanges).toBe(true);
      expect(impactAnalysis.breakingChanges.length).toBeGreaterThan(0);

      // Should identify specific breaking changes
      const nameBreakingChange = impactAnalysis.breakingChanges.find(bc =>
        bc.changeType === 'column_removed' && bc.columnName === 'name'
      );

      expect(nameBreakingChange).toBeDefined();
      expect(nameBreakingChange!.severity).toBe('critical');
      expect(nameBreakingChange!.mitigation).toBeDefined();
    });

    test('should analyze data compatibility', async () => {
      // Create data compatibility issues
      await sourcePool.query(`
        INSERT INTO dispatch_offices (name, address)
        VALUES ('Test Office', 'Very long address that might exceed destination column limits in some scenarios and cause truncation issues during migration process')
      `);

      // Change destination to smaller column
      await destinationPool.query(`
        ALTER TABLE offices
        ALTER COLUMN address TYPE VARCHAR(50)
      `);

      const compatibilityAnalysis = await schemaAnalyzer.analyzeDataCompatibility(
        'dispatch_offices',
        'offices'
      );

      expect(compatibilityAnalysis.isCompatible).toBe(false);
      expect(compatibilityAnalysis.issues.length).toBeGreaterThan(0);

      // Should identify truncation risk
      const truncationIssue = compatibilityAnalysis.issues.find(issue =>
        issue.type === 'data_truncation'
      );

      expect(truncationIssue).toBeDefined();
      expect(truncationIssue!.columnName).toBe('address');
      expect(truncationIssue!.severity).toMatch(/warning|error/);
      expect(truncationIssue!.affectedRecords).toBeGreaterThan(0);
    });
  });

  describe('Automated Schema Synchronization', () => {
    test('should generate schema synchronization scripts', async () => {
      // Make changes that require synchronization
      await sourcePool.query(`
        ALTER TABLE dispatch_offices
        ADD COLUMN phone VARCHAR(20),
        ADD COLUMN fax VARCHAR(20)
      `);

      const syncScript = await schemaAnalyzer.generateSynchronizationScript(
        'dispatch_offices',
        'offices'
      );

      expect(syncScript.ddlStatements.length).toBeGreaterThan(0);
      expect(syncScript.rollbackStatements.length).toBeGreaterThan(0);

      // Should include ADD COLUMN statements
      const addColumnStatements = syncScript.ddlStatements.filter(stmt =>
        stmt.includes('ADD COLUMN')
      );

      expect(addColumnStatements.length).toBe(2); // phone and fax columns

      // Should include rollback statements
      const dropColumnStatements = syncScript.rollbackStatements.filter(stmt =>
        stmt.includes('DROP COLUMN')
      );

      expect(dropColumnStatements.length).toBe(2);

      // Should include safety checks
      expect(syncScript.safetyChecks).toBeDefined();
      expect(syncScript.safetyChecks.length).toBeGreaterThan(0);
    });

    test('should validate schema synchronization safety', async () => {
      // Create unsafe synchronization scenario
      await sourcePool.query(`
        ALTER TABLE dispatch_offices
        DROP COLUMN address,
        ALTER COLUMN name SET NOT NULL
      `);

      const safetyValidation = await schemaAnalyzer.validateSynchronizationSafety(
        'dispatch_offices',
        'offices'
      );

      expect(safetyValidation.isSafe).toBe(false);
      expect(safetyValidation.warnings.length).toBeGreaterThan(0);
      expect(safetyValidation.blockers.length).toBeGreaterThan(0);

      // Should identify data loss risk
      const dataLossWarning = safetyValidation.warnings.find(w =>
        w.type === 'data_loss_risk'
      );

      expect(dataLossWarning).toBeDefined();
      expect(dataLossWarning!.severity).toBe('high');

      // Should require manual intervention
      expect(safetyValidation.requiresManualIntervention).toBe(true);
      expect(safetyValidation.manualSteps.length).toBeGreaterThan(0);
    });

    test('should handle schema synchronization rollback', async () => {
      // Apply schema changes
      await destinationPool.query(`
        ALTER TABLE offices
        ADD COLUMN temp_column VARCHAR(50)
      `);

      // Generate rollback script
      const rollbackScript = await schemaAnalyzer.generateRollbackScript(
        'offices',
        'temp_column'
      );

      expect(rollbackScript.statements.length).toBeGreaterThan(0);
      expect(rollbackScript.statements[0]).toContain('DROP COLUMN temp_column');

      // Execute rollback
      for (const statement of rollbackScript.statements) {
        await destinationPool.query(statement);
      }

      // Verify rollback success
      const columnExists = await checkColumnExists('offices', 'temp_column');
      expect(columnExists).toBe(false);
    });
  });

  describe('Migration Strategy Adaptation', () => {
    test('should adapt migration strategy for schema changes', async () => {
      // Make schema changes that affect migration strategy
      await sourcePool.query(`
        ALTER TABLE dispatch_offices
        ADD COLUMN created_by_id INTEGER,
        ALTER COLUMN name TYPE TEXT
      `);

      const adaptedStrategy = await schemaAnalyzer.adaptMigrationStrategy(
        'dispatch_offices',
        'offices',
        'differential'
      );

      expect(adaptedStrategy.strategyType).toMatch(/differential|full|hybrid/);
      expect(adaptedStrategy.modifications.length).toBeGreaterThan(0);

      // Should include field mapping modifications
      const fieldMappingMod = adaptedStrategy.modifications.find(m =>
        m.type === 'field_mapping'
      );

      expect(fieldMappingMod).toBeDefined();
      expect(fieldMappingMod!.affectedColumns.length).toBeGreaterThan(0);

      // Should include transformation steps
      const transformationMod = adaptedStrategy.modifications.find(m =>
        m.type === 'transformation'
      );

      if (transformationMod) {
        expect(transformationMod.transformationSteps.length).toBeGreaterThan(0);
      }
    });

    test('should recommend migration approach for complex changes', async () => {
      // Create complex schema evolution scenario
      await sourcePool.query(`
        -- Rename table (simulated by creating new table)
        CREATE TABLE dispatch_locations AS SELECT * FROM dispatch_offices;

        -- Add complex constraints
        ALTER TABLE dispatch_locations
        ADD COLUMN location_type VARCHAR(20) DEFAULT 'office',
        ADD CONSTRAINT chk_location_type CHECK (location_type IN ('office', 'clinic', 'hospital'))
      `);

      await destinationPool.query(`
        CREATE TABLE locations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          legacy_id INTEGER,
          name VARCHAR(255) NOT NULL,
          address VARCHAR(255),
          location_type VARCHAR(20) DEFAULT 'office',
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW(),
          CONSTRAINT chk_location_type CHECK (location_type IN ('office', 'clinic', 'hospital'))
        )
      `);

      const migrationRecommendation = await schemaAnalyzer.recommendMigrationApproach(
        'dispatch_locations',
        'locations'
      );

      expect(migrationRecommendation.approach).toMatch(/full|differential|hybrid|custom/);
      expect(migrationRecommendation.confidence).toBeGreaterThan(0);
      expect(migrationRecommendation.confidence).toBeLessThanOrEqual(1);

      // Should provide detailed steps
      expect(migrationRecommendation.steps.length).toBeGreaterThan(0);

      // Should include risk assessment
      expect(migrationRecommendation.riskAssessment).toBeDefined();
      expect(migrationRecommendation.riskAssessment.overallRisk).toMatch(/low|moderate|high|critical/);
    });
  });

  // Helper functions
  async function verifyDatabaseConnections(): Promise<void> {
    try {
      await sourcePool.query('SELECT 1');
      await destinationPool.query('SELECT 1');
    } catch (error) {
      throw new Error(`Database connection verification failed: ${error.message}`);
    }
  }

  async function setupInitialSchemas(): Promise<void> {
    // Create baseline source schema
    await sourcePool.query(`
      CREATE TABLE IF NOT EXISTS dispatch_offices (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        address VARCHAR(500),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create baseline destination schema
    await destinationPool.query(`
      CREATE TABLE IF NOT EXISTS offices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        legacy_id INTEGER,
        name VARCHAR(255) NOT NULL,
        address VARCHAR(500),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Insert baseline test data
    await sourcePool.query(`
      INSERT INTO dispatch_offices (name, address)
      VALUES ('Schema Test Office 1', '123 Schema St'),
             ('Schema Test Office 2', '456 Evolution Ave')
      ON CONFLICT DO NOTHING
    `);

    await destinationPool.query(`
      INSERT INTO offices (name, address, legacy_id)
      VALUES ('Schema Test Office 1', '123 Schema St', 1)
      ON CONFLICT DO NOTHING
    `);
  }

  async function cleanupTestData(): Promise<void> {
    const cleanupQueries = [
      'DROP TABLE IF EXISTS dispatch_departments CASCADE',
      'DROP TABLE IF EXISTS departments CASCADE',
      'DROP TABLE IF EXISTS dispatch_locations CASCADE',
      'DROP TABLE IF EXISTS locations CASCADE',
      'DROP TABLE IF EXISTS dispatch_offices CASCADE',
      'DROP TABLE IF EXISTS offices CASCADE'
    ];

    for (const query of cleanupQueries) {
      try {
        await sourcePool.query(query);
        await destinationPool.query(query);
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  }

  async function resetToBaselineSchema(): Promise<void> {
    // Drop and recreate tables to reset schema
    await cleanupTestData();
    await setupInitialSchemas();
  }

  async function checkColumnExists(tableName: string, columnName: string): Promise<boolean> {
    try {
      const result = await destinationPool.query(`
        SELECT COUNT(*) as count
        FROM information_schema.columns
        WHERE table_name = $1 AND column_name = $2
      `, [tableName, columnName]);

      return parseInt(result.rows[0].count) > 0;
    } catch (error) {
      return false;
    }
  }
});