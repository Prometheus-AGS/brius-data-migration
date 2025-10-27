/**
 * Unit Tests: SchemaMappingDefinition Model
 * Tests field mappings, validation rules, transformation functions
 */

import { diffMigrationTestUtils } from '../../setup';

// Import the model interfaces (will be implemented after tests)
interface FieldMapping {
  source_field: string;
  destination_field: string;
  data_type: string;
  is_required: boolean;
  default_value?: any;
  transformation?: string;
}

interface ValidationRule {
  field_name: string;
  rule_type: 'required' | 'unique' | 'format' | 'range';
  rule_parameters: object;
}

interface TransformationFunction {
  name: string;
  description: string;
  function_body: string;
}

interface SchemaMappingDefinition {
  id: string;
  entity_type: string;
  source_table: string;
  destination_table: string;
  field_mappings: FieldMapping[];
  validation_rules: ValidationRule[];
  transformation_functions: TransformationFunction[];
  version: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

interface SchemaMappingCreateInput {
  entity_type: string;
  source_table: string;
  destination_table: string;
  field_mappings?: FieldMapping[];
  validation_rules?: ValidationRule[];
  transformation_functions?: TransformationFunction[];
  version?: string;
  is_active?: boolean;
}

// Mock implementation for testing (will be replaced with actual implementation)
class MockSchemaMappingDefinition {
  static create(input: SchemaMappingCreateInput): SchemaMappingDefinition {
    // Basic validation
    if (!input.entity_type || !input.source_table || !input.destination_table) {
      throw new Error('entity_type, source_table, and destination_table are required');
    }

    return {
      id: diffMigrationTestUtils.generateTestUUID(),
      entity_type: input.entity_type,
      source_table: input.source_table,
      destination_table: input.destination_table,
      field_mappings: input.field_mappings || [],
      validation_rules: input.validation_rules || [],
      transformation_functions: input.transformation_functions || [],
      version: input.version || '1.0.0',
      is_active: input.is_active !== undefined ? input.is_active : true,
      created_at: new Date(),
      updated_at: new Date()
    };
  }

  static validate(mapping: SchemaMappingDefinition): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate entity_type
    const validEntityTypes = [
      'offices', 'doctors', 'doctor_offices', 'patients', 'orders',
      'cases', 'files', 'case_files', 'messages', 'message_files',
      'jaw', 'dispatch_records', 'system_messages', 'message_attachments'
    ];

    if (!validEntityTypes.includes(mapping.entity_type)) {
      errors.push('Invalid entity_type');
    }

    // Validate version format (semantic versioning)
    const versionRegex = /^[0-9]+\.[0-9]+\.[0-9]+$/;
    if (!versionRegex.test(mapping.version)) {
      errors.push('Version must follow semantic versioning format (e.g., 1.0.0)');
    }

    // Validate field mappings
    mapping.field_mappings.forEach((fieldMapping, index) => {
      if (!fieldMapping.source_field || !fieldMapping.destination_field) {
        errors.push(`Field mapping ${index}: source_field and destination_field are required`);
      }

      if (!fieldMapping.data_type) {
        errors.push(`Field mapping ${index}: data_type is required`);
      }

      // Validate transformation function exists if specified
      if (fieldMapping.transformation) {
        const transformationExists = mapping.transformation_functions.some(
          tf => tf.name === fieldMapping.transformation
        );
        if (!transformationExists) {
          errors.push(`Field mapping ${index}: transformation function '${fieldMapping.transformation}' not found`);
        }
      }
    });

    // Validate validation rules
    mapping.validation_rules.forEach((rule, index) => {
      if (!rule.field_name) {
        errors.push(`Validation rule ${index}: field_name is required`);
      }

      const validRuleTypes = ['required', 'unique', 'format', 'range'];
      if (!validRuleTypes.includes(rule.rule_type)) {
        errors.push(`Validation rule ${index}: invalid rule_type '${rule.rule_type}'`);
      }

      // Check if field exists in field mappings
      const fieldExists = mapping.field_mappings.some(
        fm => fm.destination_field === rule.field_name || fm.source_field === rule.field_name
      );
      if (!fieldExists) {
        errors.push(`Validation rule ${index}: field '${rule.field_name}' not found in field mappings`);
      }
    });

    // Validate transformation functions
    mapping.transformation_functions.forEach((func, index) => {
      if (!func.name || !func.function_body) {
        errors.push(`Transformation function ${index}: name and function_body are required`);
      }

      // Basic TypeScript function validation
      if (func.function_body && !func.function_body.includes('function') && !func.function_body.includes('=>')) {
        errors.push(`Transformation function ${index}: function_body must contain valid TypeScript function syntax`);
      }
    });

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static createFieldMapping(
    sourceField: string,
    destinationField: string,
    dataType: string,
    isRequired: boolean = false,
    options: {
      defaultValue?: any;
      transformation?: string;
    } = {}
  ): FieldMapping {
    return {
      source_field: sourceField,
      destination_field: destinationField,
      data_type: dataType,
      is_required: isRequired,
      default_value: options.defaultValue,
      transformation: options.transformation
    };
  }

  static createValidationRule(
    fieldName: string,
    ruleType: 'required' | 'unique' | 'format' | 'range',
    ruleParameters: object = {}
  ): ValidationRule {
    return {
      field_name: fieldName,
      rule_type: ruleType,
      rule_parameters: ruleParameters
    };
  }

  static createTransformationFunction(
    name: string,
    description: string,
    functionBody: string
  ): TransformationFunction {
    return {
      name,
      description,
      function_body: functionBody
    };
  }

  static getFieldMappingBySource(mapping: SchemaMappingDefinition, sourceField: string): FieldMapping | null {
    return mapping.field_mappings.find(fm => fm.source_field === sourceField) || null;
  }

  static getFieldMappingByDestination(mapping: SchemaMappingDefinition, destinationField: string): FieldMapping | null {
    return mapping.field_mappings.find(fm => fm.destination_field === destinationField) || null;
  }

  static getValidationRulesForField(mapping: SchemaMappingDefinition, fieldName: string): ValidationRule[] {
    return mapping.validation_rules.filter(vr => vr.field_name === fieldName);
  }
}

describe('SchemaMappingDefinition Model', () => {
  describe('Creation and Basic Validation', () => {
    test('should create valid schema mapping with required fields', () => {
      const input: SchemaMappingCreateInput = {
        entity_type: 'offices',
        source_table: 'dispatch_office',
        destination_table: 'offices'
      };

      const mapping = MockSchemaMappingDefinition.create(input);

      expect(mapping).toBeDefined();
      expect(mapping.id).toBeDefined();
      expect(mapping.entity_type).toBe('offices');
      expect(mapping.source_table).toBe('dispatch_office');
      expect(mapping.destination_table).toBe('offices');
      expect(mapping.field_mappings).toEqual([]);
      expect(mapping.validation_rules).toEqual([]);
      expect(mapping.transformation_functions).toEqual([]);
      expect(mapping.version).toBe('1.0.0');
      expect(mapping.is_active).toBe(true);
      expect(mapping.created_at).toBeInstanceOf(Date);
      expect(mapping.updated_at).toBeInstanceOf(Date);
    });

    test('should create schema mapping with all optional fields', () => {
      const fieldMappings: FieldMapping[] = [
        {
          source_field: 'id',
          destination_field: 'legacy_office_id',
          data_type: 'integer',
          is_required: true
        }
      ];

      const validationRules: ValidationRule[] = [
        {
          field_name: 'legacy_office_id',
          rule_type: 'required',
          rule_parameters: {}
        }
      ];

      const input: SchemaMappingCreateInput = {
        entity_type: 'doctors',
        source_table: 'dispatch_doctor',
        destination_table: 'doctors',
        field_mappings: fieldMappings,
        validation_rules: validationRules,
        version: '2.1.0',
        is_active: false
      };

      const mapping = MockSchemaMappingDefinition.create(input);

      expect(mapping.field_mappings).toEqual(fieldMappings);
      expect(mapping.validation_rules).toEqual(validationRules);
      expect(mapping.version).toBe('2.1.0');
      expect(mapping.is_active).toBe(false);
    });

    test('should throw error when required fields are missing', () => {
      expect(() => {
        MockSchemaMappingDefinition.create({} as SchemaMappingCreateInput);
      }).toThrow('entity_type, source_table, and destination_table are required');

      expect(() => {
        MockSchemaMappingDefinition.create({
          entity_type: 'offices'
        } as SchemaMappingCreateInput);
      }).toThrow('entity_type, source_table, and destination_table are required');
    });
  });

  describe('Field Mapping Validation', () => {
    test('should pass validation for valid field mappings', () => {
      const mapping = MockSchemaMappingDefinition.create({
        entity_type: 'offices',
        source_table: 'dispatch_office',
        destination_table: 'offices',
        field_mappings: [
          {
            source_field: 'id',
            destination_field: 'legacy_office_id',
            data_type: 'integer',
            is_required: true
          },
          {
            source_field: 'name',
            destination_field: 'name',
            data_type: 'string',
            is_required: true
          }
        ]
      });

      const validation = MockSchemaMappingDefinition.validate(mapping);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    test('should fail validation for incomplete field mappings', () => {
      const mapping = MockSchemaMappingDefinition.create({
        entity_type: 'offices',
        source_table: 'dispatch_office',
        destination_table: 'offices',
        field_mappings: [
          {
            source_field: '',
            destination_field: 'legacy_office_id',
            data_type: 'integer',
            is_required: true
          },
          {
            source_field: 'name',
            destination_field: '',
            data_type: '',
            is_required: false
          }
        ]
      });

      const validation = MockSchemaMappingDefinition.validate(mapping);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Field mapping 0: source_field and destination_field are required');
      expect(validation.errors).toContain('Field mapping 1: source_field and destination_field are required');
      expect(validation.errors).toContain('Field mapping 1: data_type is required');
    });

    test('should fail validation for missing transformation function', () => {
      const mapping = MockSchemaMappingDefinition.create({
        entity_type: 'offices',
        source_table: 'dispatch_office',
        destination_table: 'offices',
        field_mappings: [
          {
            source_field: 'created_at',
            destination_field: 'created_at',
            data_type: 'timestamp',
            is_required: false,
            transformation: 'formatTimestamp'
          }
        ],
        transformation_functions: [] // Empty - missing the referenced function
      });

      const validation = MockSchemaMappingDefinition.validate(mapping);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Field mapping 0: transformation function \'formatTimestamp\' not found');
    });
  });

  describe('Validation Rules', () => {
    test('should pass validation for valid validation rules', () => {
      const mapping = MockSchemaMappingDefinition.create({
        entity_type: 'offices',
        source_table: 'dispatch_office',
        destination_table: 'offices',
        field_mappings: [
          {
            source_field: 'name',
            destination_field: 'name',
            data_type: 'string',
            is_required: true
          }
        ],
        validation_rules: [
          {
            field_name: 'name',
            rule_type: 'required',
            rule_parameters: {}
          },
          {
            field_name: 'name',
            rule_type: 'format',
            rule_parameters: { max_length: 255 }
          }
        ]
      });

      const validation = MockSchemaMappingDefinition.validate(mapping);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    test('should fail validation for invalid rule types', () => {
      const mapping = MockSchemaMappingDefinition.create({
        entity_type: 'offices',
        source_table: 'dispatch_office',
        destination_table: 'offices',
        field_mappings: [
          {
            source_field: 'name',
            destination_field: 'name',
            data_type: 'string',
            is_required: true
          }
        ],
        validation_rules: [
          {
            field_name: 'name',
            rule_type: 'invalid_rule' as any,
            rule_parameters: {}
          }
        ]
      });

      const validation = MockSchemaMappingDefinition.validate(mapping);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Validation rule 0: invalid rule_type \'invalid_rule\'');
    });

    test('should fail validation for rules referencing non-existent fields', () => {
      const mapping = MockSchemaMappingDefinition.create({
        entity_type: 'offices',
        source_table: 'dispatch_office',
        destination_table: 'offices',
        field_mappings: [
          {
            source_field: 'name',
            destination_field: 'name',
            data_type: 'string',
            is_required: true
          }
        ],
        validation_rules: [
          {
            field_name: 'non_existent_field',
            rule_type: 'required',
            rule_parameters: {}
          }
        ]
      });

      const validation = MockSchemaMappingDefinition.validate(mapping);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Validation rule 0: field \'non_existent_field\' not found in field mappings');
    });
  });

  describe('Transformation Functions', () => {
    test('should pass validation for valid transformation functions', () => {
      const mapping = MockSchemaMappingDefinition.create({
        entity_type: 'offices',
        source_table: 'dispatch_office',
        destination_table: 'offices',
        transformation_functions: [
          {
            name: 'formatTimestamp',
            description: 'Formats timestamp to ISO string',
            function_body: 'function formatTimestamp(value: Date): string { return value.toISOString(); }'
          },
          {
            name: 'trimString',
            description: 'Trims whitespace from string',
            function_body: '(value: string) => value.trim()'
          }
        ]
      });

      const validation = MockSchemaMappingDefinition.validate(mapping);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    test('should fail validation for incomplete transformation functions', () => {
      const mapping = MockSchemaMappingDefinition.create({
        entity_type: 'offices',
        source_table: 'dispatch_office',
        destination_table: 'offices',
        transformation_functions: [
          {
            name: '',
            description: 'Missing name',
            function_body: 'function() {}'
          },
          {
            name: 'noBody',
            description: 'Missing function body',
            function_body: ''
          }
        ]
      });

      const validation = MockSchemaMappingDefinition.validate(mapping);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Transformation function 0: name and function_body are required');
      expect(validation.errors).toContain('Transformation function 1: name and function_body are required');
    });

    test('should fail validation for invalid function syntax', () => {
      const mapping = MockSchemaMappingDefinition.create({
        entity_type: 'offices',
        source_table: 'dispatch_office',
        destination_table: 'offices',
        transformation_functions: [
          {
            name: 'invalidFunction',
            description: 'Invalid syntax',
            function_body: 'not a valid function'
          }
        ]
      });

      const validation = MockSchemaMappingDefinition.validate(mapping);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Transformation function 0: function_body must contain valid TypeScript function syntax');
    });
  });

  describe('Version and Entity Type Validation', () => {
    test('should fail validation for invalid version format', () => {
      const mapping = MockSchemaMappingDefinition.create({
        entity_type: 'offices',
        source_table: 'dispatch_office',
        destination_table: 'offices',
        version: '1.0'
      });

      const validation = MockSchemaMappingDefinition.validate(mapping);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Version must follow semantic versioning format (e.g., 1.0.0)');
    });

    test('should fail validation for invalid entity type', () => {
      const mapping = MockSchemaMappingDefinition.create({
        entity_type: 'invalid_entity',
        source_table: 'some_table',
        destination_table: 'other_table'
      });

      const validation = MockSchemaMappingDefinition.validate(mapping);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Invalid entity_type');
    });
  });

  describe('Helper Methods', () => {
    let testMapping: SchemaMappingDefinition;

    beforeEach(() => {
      testMapping = MockSchemaMappingDefinition.create({
        entity_type: 'offices',
        source_table: 'dispatch_office',
        destination_table: 'offices',
        field_mappings: [
          {
            source_field: 'id',
            destination_field: 'legacy_office_id',
            data_type: 'integer',
            is_required: true
          },
          {
            source_field: 'name',
            destination_field: 'name',
            data_type: 'string',
            is_required: true
          }
        ],
        validation_rules: [
          {
            field_name: 'name',
            rule_type: 'required',
            rule_parameters: {}
          },
          {
            field_name: 'name',
            rule_type: 'format',
            rule_parameters: { max_length: 255 }
          },
          {
            field_name: 'legacy_office_id',
            rule_type: 'unique',
            rule_parameters: {}
          }
        ]
      });
    });

    test('should create field mapping correctly', () => {
      const fieldMapping = MockSchemaMappingDefinition.createFieldMapping(
        'email',
        'email',
        'string',
        false,
        { defaultValue: null, transformation: 'toLowerCase' }
      );

      expect(fieldMapping.source_field).toBe('email');
      expect(fieldMapping.destination_field).toBe('email');
      expect(fieldMapping.data_type).toBe('string');
      expect(fieldMapping.is_required).toBe(false);
      expect(fieldMapping.default_value).toBeNull();
      expect(fieldMapping.transformation).toBe('toLowerCase');
    });

    test('should create validation rule correctly', () => {
      const validationRule = MockSchemaMappingDefinition.createValidationRule(
        'email',
        'format',
        { pattern: '^[\\w-\\.]+@([\\w-]+\\.)+[\\w-]{2,4}$' }
      );

      expect(validationRule.field_name).toBe('email');
      expect(validationRule.rule_type).toBe('format');
      expect(validationRule.rule_parameters).toEqual({ pattern: '^[\\w-\\.]+@([\\w-]+\\.)+[\\w-]{2,4}$' });
    });

    test('should create transformation function correctly', () => {
      const transformationFunction = MockSchemaMappingDefinition.createTransformationFunction(
        'toLowerCase',
        'Converts string to lowercase',
        '(value: string) => value.toLowerCase()'
      );

      expect(transformationFunction.name).toBe('toLowerCase');
      expect(transformationFunction.description).toBe('Converts string to lowercase');
      expect(transformationFunction.function_body).toBe('(value: string) => value.toLowerCase()');
    });

    test('should find field mapping by source field', () => {
      const fieldMapping = MockSchemaMappingDefinition.getFieldMappingBySource(testMapping, 'id');

      expect(fieldMapping).toBeDefined();
      expect(fieldMapping!.source_field).toBe('id');
      expect(fieldMapping!.destination_field).toBe('legacy_office_id');
    });

    test('should find field mapping by destination field', () => {
      const fieldMapping = MockSchemaMappingDefinition.getFieldMappingByDestination(testMapping, 'name');

      expect(fieldMapping).toBeDefined();
      expect(fieldMapping!.source_field).toBe('name');
      expect(fieldMapping!.destination_field).toBe('name');
    });

    test('should return null for non-existent field mappings', () => {
      const fieldMapping = MockSchemaMappingDefinition.getFieldMappingBySource(testMapping, 'non_existent');

      expect(fieldMapping).toBeNull();
    });

    test('should get validation rules for specific field', () => {
      const nameRules = MockSchemaMappingDefinition.getValidationRulesForField(testMapping, 'name');

      expect(nameRules).toHaveLength(2);
      expect(nameRules[0].rule_type).toBe('required');
      expect(nameRules[1].rule_type).toBe('format');

      const idRules = MockSchemaMappingDefinition.getValidationRulesForField(testMapping, 'legacy_office_id');

      expect(idRules).toHaveLength(1);
      expect(idRules[0].rule_type).toBe('unique');
    });

    test('should return empty array for field with no validation rules', () => {
      const noRules = MockSchemaMappingDefinition.getValidationRulesForField(testMapping, 'non_existent_field');

      expect(noRules).toEqual([]);
    });
  });

  describe('Real-world Schema Mapping Examples', () => {
    test('should handle complex office mapping scenario', () => {
      const officeMapping = MockSchemaMappingDefinition.create({
        entity_type: 'offices',
        source_table: 'dispatch_office',
        destination_table: 'offices',
        field_mappings: [
          MockSchemaMappingDefinition.createFieldMapping('id', 'legacy_office_id', 'integer', true),
          MockSchemaMappingDefinition.createFieldMapping('name', 'name', 'string', true),
          MockSchemaMappingDefinition.createFieldMapping('address', 'address', 'string', false),
          MockSchemaMappingDefinition.createFieldMapping('phone', 'phone', 'string', false, { transformation: 'formatPhone' }),
          MockSchemaMappingDefinition.createFieldMapping('email', 'email', 'string', false, { transformation: 'toLowerCase' })
        ],
        validation_rules: [
          MockSchemaMappingDefinition.createValidationRule('name', 'required'),
          MockSchemaMappingDefinition.createValidationRule('name', 'format', { max_length: 255 }),
          MockSchemaMappingDefinition.createValidationRule('legacy_office_id', 'unique'),
          MockSchemaMappingDefinition.createValidationRule('email', 'format', { pattern: '^[\\w-\\.]+@([\\w-]+\\.)+[\\w-]{2,4}$' })
        ],
        transformation_functions: [
          MockSchemaMappingDefinition.createTransformationFunction(
            'formatPhone',
            'Formats phone number to standard format',
            'function formatPhone(phone: string): string { return phone.replace(/[^\\d]/g, "").replace(/(\\d{3})(\\d{3})(\\d{4})/, "($1) $2-$3"); }'
          ),
          MockSchemaMappingDefinition.createTransformationFunction(
            'toLowerCase',
            'Converts email to lowercase',
            '(email: string) => email.toLowerCase()'
          )
        ],
        version: '2.1.0'
      });

      const validation = MockSchemaMappingDefinition.validate(officeMapping);

      expect(validation.isValid).toBe(true);
      expect(officeMapping.field_mappings).toHaveLength(5);
      expect(officeMapping.validation_rules).toHaveLength(4);
      expect(officeMapping.transformation_functions).toHaveLength(2);
    });
  });
});