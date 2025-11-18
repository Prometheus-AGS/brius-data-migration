/**
 * SchemaAnalyzer Library Tests
 * Tests schema introspection, difference detection, and mapping recommendations
 */

import { Pool, PoolClient } from 'pg';
import { SchemaAnalyzer, type SchemaAnalysisConfig, type TableSchema, type ColumnSchema, type SchemaDifference, type MappingRecommendation, type SchemaEvolution, type CompatibilityAssessment } from '../../../src/differential-migration/lib/schema-analyzer';

// Mock pg module
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    query: jest.fn(),
    end: jest.fn()
  }))
}));

describe('SchemaAnalyzer', () => {
  let analyzer: SchemaAnalyzer;
  let mockPool: jest.Mocked<Pool>;
  let mockClient: jest.Mocked<PoolClient>;

  const config: SchemaAnalysisConfig = {
    sourcePool: null as any, // Will be mocked
    destinationPool: null as any, // Will be mocked
    ignoreTables: ['pg_*', 'information_schema.*'],
    includeViews: false,
    includeIndexes: true,
    includeConstraints: true,
    enableCompatibilityCheck: true
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockClient = {
      query: jest.fn(),
      release: jest.fn()
    } as any;

    mockPool = {
      connect: jest.fn().mockResolvedValue(mockClient),
      query: jest.fn(),
      end: jest.fn()
    } as any;

    config.sourcePool = mockPool;
    config.destinationPool = mockPool;

    analyzer = new SchemaAnalyzer(config);
  });

  describe('Schema Introspection', () => {
    test('should analyze table schema comprehensively', async () => {
      const columnsResult = {
        rows: [
          {
            column_name: 'id',
            data_type: 'integer',
            is_nullable: 'NO',
            column_default: 'nextval(\'users_id_seq\'::regclass)',
            character_maximum_length: null,
            numeric_precision: 32,
            numeric_scale: 0
          },
          {
            column_name: 'email',
            data_type: 'character varying',
            is_nullable: 'NO',
            column_default: null,
            character_maximum_length: 255,
            numeric_precision: null,
            numeric_scale: null
          },
          {
            column_name: 'created_at',
            data_type: 'timestamp without time zone',
            is_nullable: 'NO',
            column_default: 'CURRENT_TIMESTAMP',
            character_maximum_length: null,
            numeric_precision: null,
            numeric_scale: null
          }
        ]
      };

      const constraintsResult = {
        rows: [
          {
            constraint_name: 'users_pkey',
            constraint_type: 'PRIMARY KEY',
            column_name: 'id'
          },
          {
            constraint_name: 'users_email_unique',
            constraint_type: 'UNIQUE',
            column_name: 'email'
          }
        ]
      };

      const indexesResult = {
        rows: [
          {
            indexname: 'users_pkey',
            indexdef: 'CREATE UNIQUE INDEX users_pkey ON users USING btree (id)',
            column_names: ['id']
          },
          {
            indexname: 'users_email_idx',
            indexdef: 'CREATE UNIQUE INDEX users_email_idx ON users USING btree (email)',
            column_names: ['email']
          }
        ]
      };

      mockClient.query
        .mockResolvedValueOnce(columnsResult)
        .mockResolvedValueOnce(constraintsResult)
        .mockResolvedValueOnce(indexesResult);

      const schema = await analyzer.analyzeTableSchema('users', 'source');

      expect(schema.tableName).toBe('users');
      expect(schema.columns).toHaveLength(3);
      expect(schema.primaryKey).toEqual(['id']);
      expect(schema.uniqueConstraints).toHaveLength(1);
      expect(schema.indexes).toHaveLength(2);

      const idColumn = schema.columns.find(c => c.name === 'id');
      expect(idColumn?.dataType).toBe('integer');
      expect(idColumn?.isNullable).toBe(false);
      expect(idColumn?.isPrimaryKey).toBe(true);
      expect(idColumn?.hasDefault).toBe(true);
    });

    test('should discover all tables in database', async () => {
      const tablesResult = {
        rows: [
          { table_name: 'dispatch_users', table_type: 'BASE TABLE' },
          { table_name: 'dispatch_orders', table_type: 'BASE TABLE' },
          { table_name: 'users_view', table_type: 'VIEW' },
          { table_name: 'pg_stat_activity', table_type: 'VIEW' }
        ]
      };

      mockClient.query.mockResolvedValue(tablesResult);

      const tables = await analyzer.discoverTables('source');

      expect(tables).toHaveLength(2); // Should exclude views and pg_ tables
      expect(tables).toContain('dispatch_users');
      expect(tables).toContain('dispatch_orders');
      expect(tables).not.toContain('users_view');
      expect(tables).not.toContain('pg_stat_activity');
    });

    test('should analyze foreign key relationships', async () => {
      const fkResult = {
        rows: [
          {
            table_name: 'dispatch_orders',
            column_name: 'user_id',
            foreign_table_name: 'dispatch_users',
            foreign_column_name: 'id',
            constraint_name: 'dispatch_orders_user_id_fkey'
          },
          {
            table_name: 'dispatch_profiles',
            column_name: 'user_id',
            foreign_table_name: 'dispatch_users',
            foreign_column_name: 'id',
            constraint_name: 'dispatch_profiles_user_id_fkey'
          }
        ]
      };

      mockClient.query.mockResolvedValue(fkResult);

      const relationships = await analyzer.analyzeForeignKeyRelationships('source');

      expect(relationships).toHaveLength(2);
      expect(relationships[0].sourceTable).toBe('dispatch_orders');
      expect(relationships[0].sourceColumn).toBe('user_id');
      expect(relationships[0].targetTable).toBe('dispatch_users');
      expect(relationships[0].targetColumn).toBe('id');
    });

    test('should detect enum types and values', async () => {
      const enumsResult = {
        rows: [
          { type_name: 'user_status', enum_value: 'active' },
          { type_name: 'user_status', enum_value: 'inactive' },
          { type_name: 'user_status', enum_value: 'pending' },
          { type_name: 'order_status', enum_value: 'draft' },
          { type_name: 'order_status', enum_value: 'submitted' }
        ]
      };

      mockClient.query.mockResolvedValue(enumsResult);

      const enums = await analyzer.discoverEnumTypes('source');

      expect(enums).toHaveLength(2);
      expect(enums[0].typeName).toBe('user_status');
      expect(enums[0].values).toEqual(['active', 'inactive', 'pending']);
      expect(enums[1].typeName).toBe('order_status');
      expect(enums[1].values).toEqual(['draft', 'submitted']);
    });
  });

  describe('Schema Comparison', () => {
    test('should detect schema differences between source and destination', async () => {
      const sourceSchema: TableSchema = {
        tableName: 'dispatch_users',
        columns: [
          { name: 'id', dataType: 'integer', isNullable: false, isPrimaryKey: true, hasDefault: true },
          { name: 'email', dataType: 'character varying', isNullable: false, maxLength: 255 },
          { name: 'status', dataType: 'user_status', isNullable: true },
          { name: 'legacy_field', dataType: 'text', isNullable: true }
        ],
        primaryKey: ['id'],
        uniqueConstraints: [{ name: 'users_email_unique', columns: ['email'] }],
        indexes: [],
        foreignKeys: []
      };

      const destSchema: TableSchema = {
        tableName: 'users',
        columns: [
          { name: 'id', dataType: 'uuid', isNullable: false, isPrimaryKey: true, hasDefault: true },
          { name: 'email', dataType: 'character varying', isNullable: false, maxLength: 255 },
          { name: 'status', dataType: 'text', isNullable: true },
          { name: 'legacy_id', dataType: 'integer', isNullable: true },
          { name: 'created_at', dataType: 'timestamp with time zone', isNullable: false, hasDefault: true }
        ],
        primaryKey: ['id'],
        uniqueConstraints: [{ name: 'users_email_unique', columns: ['email'] }],
        indexes: [],
        foreignKeys: []
      };

      const differences = await analyzer.compareSchemas(sourceSchema, destSchema);

      expect(differences.sourceTable).toBe('dispatch_users');
      expect(differences.destinationTable).toBe('users');

      const columnDiffs = differences.differences.filter(d => d.type === 'column');
      expect(columnDiffs).toHaveLength(4);

      // Should detect ID type change
      const idDiff = columnDiffs.find(d => d.name === 'id');
      expect(idDiff?.action).toBe('modified');
      expect(idDiff?.details).toContain('integer → uuid');

      // Should detect status enum → text change
      const statusDiff = columnDiffs.find(d => d.name === 'status');
      expect(statusDiff?.action).toBe('modified');

      // Should detect removed field
      const removedField = columnDiffs.find(d => d.name === 'legacy_field');
      expect(removedField?.action).toBe('removed');

      // Should detect added field
      const addedField = columnDiffs.find(d => d.name === 'created_at');
      expect(addedField?.action).toBe('added');
    });

    test('should assess migration compatibility', async () => {
      const sourceSchema: TableSchema = {
        tableName: 'dispatch_orders',
        columns: [
          { name: 'id', dataType: 'integer', isNullable: false, isPrimaryKey: true },
          { name: 'total', dataType: 'numeric', precision: 10, scale: 2, isNullable: false },
          { name: 'notes', dataType: 'text', isNullable: true }
        ],
        primaryKey: ['id'],
        uniqueConstraints: [],
        indexes: [],
        foreignKeys: []
      };

      const destSchema: TableSchema = {
        tableName: 'orders',
        columns: [
          { name: 'id', dataType: 'uuid', isNullable: false, isPrimaryKey: true },
          { name: 'total', dataType: 'numeric', precision: 12, scale: 2, isNullable: false },
          { name: 'notes', dataType: 'text', isNullable: true },
          { name: 'legacy_id', dataType: 'integer', isNullable: true }
        ],
        primaryKey: ['id'],
        uniqueConstraints: [],
        indexes: [],
        foreignKeys: []
      };

      const assessment = await analyzer.assessMigrationCompatibility(sourceSchema, destSchema);

      expect(assessment.isCompatible).toBe(true);
      expect(assessment.compatibilityScore).toBeGreaterThan(0.8);
      expect(assessment.issues).toHaveLength(1); // ID type change
      expect(assessment.recommendations).toContain('Map integer ID to UUID with legacy_id preservation');

      const idIssue = assessment.issues[0];
      expect(idIssue.severity).toBe('medium');
      expect(idIssue.field).toBe('id');
      expect(idIssue.description).toContain('Primary key type change');
    });

    test('should identify breaking changes', async () => {
      const sourceSchema: TableSchema = {
        tableName: 'dispatch_products',
        columns: [
          { name: 'id', dataType: 'integer', isNullable: false, isPrimaryKey: true },
          { name: 'name', dataType: 'character varying', maxLength: 100, isNullable: false },
          { name: 'price', dataType: 'numeric', precision: 8, scale: 2, isNullable: false }
        ],
        primaryKey: ['id'],
        uniqueConstraints: [],
        indexes: [],
        foreignKeys: []
      };

      const destSchema: TableSchema = {
        tableName: 'products',
        columns: [
          { name: 'id', dataType: 'uuid', isNullable: false, isPrimaryKey: true },
          { name: 'name', dataType: 'character varying', maxLength: 50, isNullable: false }, // Length reduced
          { name: 'legacy_id', dataType: 'integer', isNullable: true }
          // price field removed - breaking change
        ],
        primaryKey: ['id'],
        uniqueConstraints: [],
        indexes: [],
        foreignKeys: []
      };

      const assessment = await analyzer.assessMigrationCompatibility(sourceSchema, destSchema);

      expect(assessment.isCompatible).toBe(false);
      expect(assessment.compatibilityScore).toBeLessThan(0.7);

      const breakingIssues = assessment.issues.filter(i => i.severity === 'high');
      expect(breakingIssues).toHaveLength(2);

      // Should detect removed required field
      const missingPrice = breakingIssues.find(i => i.field === 'price');
      expect(missingPrice?.description).toContain('Required field removed');

      // Should detect length reduction
      const nameLength = assessment.issues.find(i => i.field === 'name');
      expect(nameLength?.description).toContain('maximum length reduced');
    });
  });

  describe('Mapping Recommendations', () => {
    test('should generate field mapping recommendations', async () => {
      const sourceSchema: TableSchema = {
        tableName: 'dispatch_doctors',
        columns: [
          { name: 'id', dataType: 'integer', isNullable: false, isPrimaryKey: true },
          { name: 'first_name', dataType: 'character varying', isNullable: false },
          { name: 'last_name', dataType: 'character varying', isNullable: false },
          { name: 'email_address', dataType: 'character varying', isNullable: true },
          { name: 'phone_number', dataType: 'character varying', isNullable: true },
          { name: 'office_id', dataType: 'integer', isNullable: false }
        ],
        primaryKey: ['id'],
        uniqueConstraints: [],
        indexes: [],
        foreignKeys: [
          { name: 'doctors_office_fk', sourceColumn: 'office_id', targetTable: 'dispatch_offices', targetColumn: 'id' }
        ]
      };

      const destSchema: TableSchema = {
        tableName: 'doctors',
        columns: [
          { name: 'id', dataType: 'uuid', isNullable: false, isPrimaryKey: true },
          { name: 'full_name', dataType: 'character varying', isNullable: false },
          { name: 'email', dataType: 'character varying', isNullable: true },
          { name: 'phone', dataType: 'character varying', isNullable: true },
          { name: 'office_id', dataType: 'uuid', isNullable: false },
          { name: 'legacy_id', dataType: 'integer', isNullable: true }
        ],
        primaryKey: ['id'],
        uniqueConstraints: [],
        indexes: [],
        foreignKeys: [
          { name: 'doctors_office_fk', sourceColumn: 'office_id', targetTable: 'offices', targetColumn: 'id' }
        ]
      };

      const recommendations = await analyzer.generateMappingRecommendations(sourceSchema, destSchema);

      expect(recommendations.sourceTable).toBe('dispatch_doctors');
      expect(recommendations.destinationTable).toBe('doctors');
      expect(recommendations.fieldMappings).toHaveLength(6);

      // Check specific mappings
      const idMapping = recommendations.fieldMappings.find(m => m.sourceField === 'id');
      expect(idMapping?.destinationField).toBe('legacy_id');
      expect(idMapping?.transformationType).toBe('preserve_as_legacy');
      expect(idMapping?.confidence).toBeGreaterThan(0.9);

      const nameMapping = recommendations.fieldMappings.find(m => m.sourceField === 'first_name');
      expect(nameMapping?.destinationField).toBe('full_name');
      expect(nameMapping?.transformationType).toBe('concatenation');
      expect(nameMapping?.transformationLogic).toContain('CONCAT');

      const emailMapping = recommendations.fieldMappings.find(m => m.sourceField === 'email_address');
      expect(emailMapping?.destinationField).toBe('email');
      expect(emailMapping?.transformationType).toBe('direct_mapping');
      expect(emailMapping?.confidence).toBeGreaterThan(0.8);
    });

    test('should recommend foreign key transformations', async () => {
      const sourceSchema: TableSchema = {
        tableName: 'dispatch_orders',
        columns: [
          { name: 'id', dataType: 'integer', isNullable: false, isPrimaryKey: true },
          { name: 'patient_id', dataType: 'integer', isNullable: false },
          { name: 'doctor_id', dataType: 'integer', isNullable: false }
        ],
        primaryKey: ['id'],
        uniqueConstraints: [],
        indexes: [],
        foreignKeys: [
          { name: 'orders_patient_fk', sourceColumn: 'patient_id', targetTable: 'dispatch_patients', targetColumn: 'id' },
          { name: 'orders_doctor_fk', sourceColumn: 'doctor_id', targetTable: 'dispatch_doctors', targetColumn: 'id' }
        ]
      };

      const destSchema: TableSchema = {
        tableName: 'orders',
        columns: [
          { name: 'id', dataType: 'uuid', isNullable: false, isPrimaryKey: true },
          { name: 'patient_id', dataType: 'uuid', isNullable: false },
          { name: 'doctor_id', dataType: 'uuid', isNullable: false },
          { name: 'legacy_id', dataType: 'integer', isNullable: true }
        ],
        primaryKey: ['id'],
        uniqueConstraints: [],
        indexes: [],
        foreignKeys: [
          { name: 'orders_patient_fk', sourceColumn: 'patient_id', targetTable: 'patients', targetColumn: 'id' },
          { name: 'orders_doctor_fk', sourceColumn: 'doctor_id', targetTable: 'doctors', targetColumn: 'id' }
        ]
      };

      const recommendations = await analyzer.generateMappingRecommendations(sourceSchema, destSchema);

      const patientMapping = recommendations.fieldMappings.find(m => m.sourceField === 'patient_id');
      expect(patientMapping?.transformationType).toBe('foreign_key_lookup');
      expect(patientMapping?.transformationLogic).toContain('migration_mappings');
      expect(patientMapping?.dependencies).toContain('patients');

      const doctorMapping = recommendations.fieldMappings.find(m => m.sourceField === 'doctor_id');
      expect(doctorMapping?.transformationType).toBe('foreign_key_lookup');
      expect(doctorMapping?.dependencies).toContain('doctors');
    });

    test('should detect and recommend enum transformations', async () => {
      // Mock enum discovery
      const sourceEnums = [
        { typeName: 'order_status', values: ['draft', 'submitted', 'completed', 'cancelled'] }
      ];

      const destEnums = [
        { typeName: 'order_status_enum', values: ['pending', 'active', 'completed', 'cancelled'] }
      ];

      jest.spyOn(analyzer, 'discoverEnumTypes')
        .mockResolvedValueOnce(sourceEnums)
        .mockResolvedValueOnce(destEnums);

      const enumMappings = await analyzer.generateEnumMappings('source', 'destination');

      expect(enumMappings).toHaveLength(1);
      expect(enumMappings[0].sourceEnum).toBe('order_status');
      expect(enumMappings[0].destinationEnum).toBe('order_status_enum');
      expect(enumMappings[0].valueMappings).toEqual({
        'draft': 'pending',
        'submitted': 'active',
        'completed': 'completed',
        'cancelled': 'cancelled'
      });
      expect(enumMappings[0].unmappedValues).toEqual([]);
    });
  });

  describe('Schema Evolution', () => {
    test('should track schema changes over time', async () => {
      const baseSchema: TableSchema = {
        tableName: 'users',
        columns: [
          { name: 'id', dataType: 'uuid', isNullable: false, isPrimaryKey: true },
          { name: 'email', dataType: 'character varying', isNullable: false },
          { name: 'created_at', dataType: 'timestamp with time zone', isNullable: false }
        ],
        primaryKey: ['id'],
        uniqueConstraints: [],
        indexes: [],
        foreignKeys: []
      };

      const evolvedSchema: TableSchema = {
        tableName: 'users',
        columns: [
          { name: 'id', dataType: 'uuid', isNullable: false, isPrimaryKey: true },
          { name: 'email', dataType: 'character varying', isNullable: false },
          { name: 'phone', dataType: 'character varying', isNullable: true }, // Added
          { name: 'created_at', dataType: 'timestamp with time zone', isNullable: false },
          { name: 'updated_at', dataType: 'timestamp with time zone', isNullable: false } // Added
        ],
        primaryKey: ['id'],
        uniqueConstraints: [],
        indexes: [],
        foreignKeys: []
      };

      const evolution = await analyzer.trackSchemaEvolution(baseSchema, evolvedSchema, 'v1.0.0', 'v1.1.0');

      expect(evolution.fromVersion).toBe('v1.0.0');
      expect(evolution.toVersion).toBe('v1.1.0');
      expect(evolution.changes).toHaveLength(2);

      const phoneChange = evolution.changes.find(c => c.columnName === 'phone');
      expect(phoneChange?.changeType).toBe('column_added');
      expect(phoneChange?.isBreaking).toBe(false);

      const updatedAtChange = evolution.changes.find(c => c.columnName === 'updated_at');
      expect(updatedAtChange?.changeType).toBe('column_added');
      expect(updatedAtChange?.isBreaking).toBe(false);

      expect(evolution.isBackwardCompatible).toBe(true);
    });

    test('should generate migration scripts for schema evolution', async () => {
      const evolution: SchemaEvolution = {
        tableName: 'products',
        fromVersion: 'v1.0.0',
        toVersion: 'v1.1.0',
        changes: [
          {
            columnName: 'description',
            changeType: 'column_added',
            newDefinition: 'description TEXT',
            isBreaking: false
          },
          {
            columnName: 'price',
            changeType: 'column_modified',
            oldDefinition: 'price DECIMAL(8,2)',
            newDefinition: 'price DECIMAL(10,2)',
            isBreaking: false
          }
        ],
        isBackwardCompatible: true,
        migrationComplexity: 'low'
      };

      const migrationScript = await analyzer.generateEvolutionMigrationScript(evolution);

      expect(migrationScript.upScript).toContain('ALTER TABLE products');
      expect(migrationScript.upScript).toContain('ADD COLUMN description TEXT');
      expect(migrationScript.upScript).toContain('ALTER COLUMN price TYPE DECIMAL(10,2)');

      expect(migrationScript.downScript).toContain('ALTER TABLE products');
      expect(migrationScript.downScript).toContain('DROP COLUMN description');
      expect(migrationScript.downScript).toContain('ALTER COLUMN price TYPE DECIMAL(8,2)');

      expect(migrationScript.version).toBe('v1.1.0');
      expect(migrationScript.isReversible).toBe(true);
    });
  });

  describe('Configuration and Validation', () => {
    test('should validate schema analysis configuration', () => {
      const validConfig: SchemaAnalysisConfig = {
        sourcePool: mockPool,
        destinationPool: mockPool,
        ignoreTables: ['temp_*'],
        includeViews: true,
        includeIndexes: true,
        includeConstraints: true,
        enableCompatibilityCheck: true
      };

      const validation = SchemaAnalyzer.validateConfig(validConfig);
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    test('should reject invalid configuration', () => {
      const invalidConfig: SchemaAnalysisConfig = {
        sourcePool: null as any,
        destinationPool: null as any,
        ignoreTables: [''],
        includeViews: false,
        includeIndexes: false,
        includeConstraints: false,
        enableCompatibilityCheck: false
      };

      const validation = SchemaAnalyzer.validateConfig(invalidConfig);
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('sourcePool is required');
      expect(validation.errors).toContain('destinationPool is required');
    });
  });

  describe('Performance and Optimization', () => {
    test('should cache schema analysis results', async () => {
      const columnsResult = {
        rows: [
          { column_name: 'id', data_type: 'integer', is_nullable: 'NO' }
        ]
      };

      mockClient.query.mockResolvedValue(columnsResult);

      // First call should execute query
      await analyzer.analyzeTableSchema('users', 'source');
      expect(mockClient.query).toHaveBeenCalledTimes(3); // columns, constraints, indexes

      // Second call should use cache
      mockClient.query.mockClear();
      await analyzer.analyzeTableSchema('users', 'source');
      expect(mockClient.query).toHaveBeenCalledTimes(0);
    });

    test('should handle large schemas efficiently', async () => {
      // Mock large table with many columns
      const largeTableColumns = Array.from({ length: 100 }, (_, i) => ({
        column_name: `column_${i}`,
        data_type: 'character varying',
        is_nullable: 'YES'
      }));

      mockClient.query.mockResolvedValue({ rows: largeTableColumns });

      const startTime = Date.now();
      const schema = await analyzer.analyzeTableSchema('large_table', 'source');
      const duration = Date.now() - startTime;

      expect(schema.columns).toHaveLength(100);
      expect(duration).toBeLessThan(1000); // Should complete within 1 second
    });
  });

  describe('Error Handling', () => {
    test('should handle database connection errors gracefully', async () => {
      mockPool.connect.mockRejectedValue(new Error('Connection failed'));

      await expect(
        analyzer.analyzeTableSchema('users', 'source')
      ).rejects.toThrow('Failed to analyze table schema: Connection failed');
    });

    test('should handle invalid table names', async () => {
      mockClient.query.mockResolvedValue({ rows: [] });

      const schema = await analyzer.analyzeTableSchema('nonexistent_table', 'source');

      expect(schema.tableName).toBe('nonexistent_table');
      expect(schema.columns).toHaveLength(0);
      expect(schema.exists).toBe(false);
    });
  });
});