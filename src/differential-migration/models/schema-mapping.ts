/**
 * SchemaMappingDefinition Model
 * Handles field transformations and relationships between source and destination schemas
 */

import { v4 as uuidv4 } from 'uuid';

// Core interfaces
export interface FieldMapping {
  source_field: string;
  destination_field: string;
  data_type: string;
  is_required: boolean;
  default_value?: any;
  transformation?: string;
}

export interface ValidationRule {
  field_name: string;
  rule_type: 'required' | 'unique' | 'format' | 'range';
  rule_parameters: object;
}

export interface TransformationFunction {
  name: string;
  description: string;
  function_body: string;
}

export interface SchemaMappingDefinition {
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

export interface SchemaMappingCreateInput {
  entity_type: string;
  source_table: string;
  destination_table: string;
  field_mappings?: FieldMapping[];
  validation_rules?: ValidationRule[];
  transformation_functions?: TransformationFunction[];
  version?: string;
  is_active?: boolean;
}

export interface SchemaMappingUpdateInput {
  field_mappings?: FieldMapping[];
  validation_rules?: ValidationRule[];
  transformation_functions?: TransformationFunction[];
  version?: string;
  is_active?: boolean;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

// Valid entity types and rule types
const VALID_ENTITY_TYPES = [
  'offices', 'doctors', 'doctor_offices', 'patients', 'orders',
  'cases', 'files', 'case_files', 'messages', 'message_files',
  'jaw', 'dispatch_records', 'system_messages', 'message_attachments',
  'technician_roles', 'order_cases', 'purchases', 'treatment_discussions',
  'template_view_groups', 'template_view_roles'
] as const;

export type ValidEntityType = typeof VALID_ENTITY_TYPES[number];
export type RuleType = 'required' | 'unique' | 'format' | 'range';

const VALID_RULE_TYPES: RuleType[] = ['required', 'unique', 'format', 'range'];

// Semantic version regex
const SEMANTIC_VERSION_REGEX = /^[0-9]+\.[0-9]+\.[0-9]+$/;

/**
 * SchemaMappingDefinition Model Implementation
 *
 * Provides functionality for managing schema mappings between source and destination
 * databases, including field transformations, validation rules, and data type conversions.
 */
export class SchemaMappingDefinitionModel {
  /**
   * Creates a new schema mapping definition with validation
   */
  static create(input: SchemaMappingCreateInput): SchemaMappingDefinition {
    // Input validation
    if (!input.entity_type || typeof input.entity_type !== 'string') {
      throw new Error('entity_type is required and must be a string');
    }

    if (!input.source_table || typeof input.source_table !== 'string') {
      throw new Error('source_table is required and must be a string');
    }

    if (!input.destination_table || typeof input.destination_table !== 'string') {
      throw new Error('destination_table is required and must be a string');
    }

    // Validate entity type
    if (!VALID_ENTITY_TYPES.includes(input.entity_type as ValidEntityType)) {
      throw new Error(`Invalid entity_type: ${input.entity_type}. Must be one of: ${VALID_ENTITY_TYPES.join(', ')}`);
    }

    // Validate version format if provided
    const version = input.version || '1.0.0';
    if (!SEMANTIC_VERSION_REGEX.test(version)) {
      throw new Error('Version must follow semantic versioning format (e.g., 1.0.0)');
    }

    const now = new Date();

    const mapping: SchemaMappingDefinition = {
      id: uuidv4(),
      entity_type: input.entity_type,
      source_table: input.source_table,
      destination_table: input.destination_table,
      field_mappings: input.field_mappings ? [...input.field_mappings] : [],
      validation_rules: input.validation_rules ? [...input.validation_rules] : [],
      transformation_functions: input.transformation_functions ? [...input.transformation_functions] : [],
      version: version,
      is_active: input.is_active !== undefined ? input.is_active : true,
      created_at: now,
      updated_at: now
    };

    // Final validation
    const validation = this.validate(mapping);
    if (!validation.isValid) {
      throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
    }

    return mapping;
  }

  /**
   * Validates a schema mapping definition against all business rules
   */
  static validate(mapping: SchemaMappingDefinition): ValidationResult {
    const errors: string[] = [];

    // Validate required fields
    if (!mapping.id) {
      errors.push('id is required');
    }

    if (!mapping.entity_type) {
      errors.push('entity_type is required');
    }

    if (!mapping.source_table) {
      errors.push('source_table is required');
    }

    if (!mapping.destination_table) {
      errors.push('destination_table is required');
    }

    // Validate entity_type
    if (mapping.entity_type && !VALID_ENTITY_TYPES.includes(mapping.entity_type as ValidEntityType)) {
      errors.push('Invalid entity_type');
    }

    // Validate version format
    if (!SEMANTIC_VERSION_REGEX.test(mapping.version)) {
      errors.push('Version must follow semantic versioning format (e.g., 1.0.0)');
    }

    // Validate arrays
    if (!Array.isArray(mapping.field_mappings)) {
      errors.push('field_mappings must be an array');
    }

    if (!Array.isArray(mapping.validation_rules)) {
      errors.push('validation_rules must be an array');
    }

    if (!Array.isArray(mapping.transformation_functions)) {
      errors.push('transformation_functions must be an array');
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

      if (!VALID_RULE_TYPES.includes(rule.rule_type)) {
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

    // Validate timestamps
    if (mapping.created_at > mapping.updated_at) {
      errors.push('updated_at must be greater than or equal to created_at');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Updates schema mapping definition with validation
   */
  static updateMapping(
    currentMapping: SchemaMappingDefinition,
    updates: SchemaMappingUpdateInput
  ): SchemaMappingDefinition {
    const now = new Date();

    // Create updated mapping
    const updatedMapping: SchemaMappingDefinition = {
      ...currentMapping,
      ...updates,
      updated_at: now
    };

    // Validate the updated mapping
    const validation = this.validate(updatedMapping);
    if (!validation.isValid) {
      throw new Error(`Update validation failed: ${validation.errors.join(', ')}`);
    }

    return updatedMapping;
  }

  /**
   * Creates a field mapping with validation
   */
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
    if (!sourceField || !destinationField || !dataType) {
      throw new Error('sourceField, destinationField, and dataType are required');
    }

    return {
      source_field: sourceField,
      destination_field: destinationField,
      data_type: dataType,
      is_required: isRequired,
      default_value: options.defaultValue,
      transformation: options.transformation
    };
  }

  /**
   * Creates a validation rule with validation
   */
  static createValidationRule(
    fieldName: string,
    ruleType: RuleType,
    ruleParameters: object = {}
  ): ValidationRule {
    if (!fieldName) {
      throw new Error('fieldName is required');
    }

    if (!VALID_RULE_TYPES.includes(ruleType)) {
      throw new Error(`Invalid ruleType: ${ruleType}. Must be one of: ${VALID_RULE_TYPES.join(', ')}`);
    }

    return {
      field_name: fieldName,
      rule_type: ruleType,
      rule_parameters: ruleParameters
    };
  }

  /**
   * Creates a transformation function with validation
   */
  static createTransformationFunction(
    name: string,
    description: string,
    functionBody: string
  ): TransformationFunction {
    if (!name || !functionBody) {
      throw new Error('name and functionBody are required');
    }

    // Basic function syntax validation
    if (!functionBody.includes('function') && !functionBody.includes('=>')) {
      throw new Error('functionBody must contain valid TypeScript function syntax');
    }

    return {
      name,
      description: description || '',
      function_body: functionBody
    };
  }

  /**
   * Finds field mapping by source field name
   */
  static getFieldMappingBySource(mapping: SchemaMappingDefinition, sourceField: string): FieldMapping | null {
    return mapping.field_mappings.find(fm => fm.source_field === sourceField) || null;
  }

  /**
   * Finds field mapping by destination field name
   */
  static getFieldMappingByDestination(mapping: SchemaMappingDefinition, destinationField: string): FieldMapping | null {
    return mapping.field_mappings.find(fm => fm.destination_field === destinationField) || null;
  }

  /**
   * Gets all validation rules for a specific field
   */
  static getValidationRulesForField(mapping: SchemaMappingDefinition, fieldName: string): ValidationRule[] {
    return mapping.validation_rules.filter(vr => vr.field_name === fieldName);
  }

  /**
   * Gets transformation function by name
   */
  static getTransformationFunction(mapping: SchemaMappingDefinition, functionName: string): TransformationFunction | null {
    return mapping.transformation_functions.find(tf => tf.name === functionName) || null;
  }

  /**
   * Adds a field mapping to the schema definition
   */
  static addFieldMapping(mapping: SchemaMappingDefinition, fieldMapping: FieldMapping): SchemaMappingDefinition {
    // Check for duplicate source or destination fields
    const existingBySource = this.getFieldMappingBySource(mapping, fieldMapping.source_field);
    const existingByDestination = this.getFieldMappingByDestination(mapping, fieldMapping.destination_field);

    if (existingBySource) {
      throw new Error(`Field mapping for source field '${fieldMapping.source_field}' already exists`);
    }

    if (existingByDestination) {
      throw new Error(`Field mapping for destination field '${fieldMapping.destination_field}' already exists`);
    }

    const updatedMapping: SchemaMappingDefinition = {
      ...mapping,
      field_mappings: [...mapping.field_mappings, fieldMapping],
      updated_at: new Date()
    };

    // Validate the updated mapping
    const validation = this.validate(updatedMapping);
    if (!validation.isValid) {
      throw new Error(`Adding field mapping failed validation: ${validation.errors.join(', ')}`);
    }

    return updatedMapping;
  }

  /**
   * Removes a field mapping from the schema definition
   */
  static removeFieldMapping(mapping: SchemaMappingDefinition, sourceField: string): SchemaMappingDefinition {
    const updatedMapping: SchemaMappingDefinition = {
      ...mapping,
      field_mappings: mapping.field_mappings.filter(fm => fm.source_field !== sourceField),
      updated_at: new Date()
    };

    return updatedMapping;
  }

  /**
   * Adds a validation rule to the schema definition
   */
  static addValidationRule(mapping: SchemaMappingDefinition, validationRule: ValidationRule): SchemaMappingDefinition {
    const updatedMapping: SchemaMappingDefinition = {
      ...mapping,
      validation_rules: [...mapping.validation_rules, validationRule],
      updated_at: new Date()
    };

    // Validate the updated mapping
    const validation = this.validate(updatedMapping);
    if (!validation.isValid) {
      throw new Error(`Adding validation rule failed validation: ${validation.errors.join(', ')}`);
    }

    return updatedMapping;
  }

  /**
   * Adds a transformation function to the schema definition
   */
  static addTransformationFunction(mapping: SchemaMappingDefinition, transformationFunction: TransformationFunction): SchemaMappingDefinition {
    // Check for duplicate function name
    const existing = this.getTransformationFunction(mapping, transformationFunction.name);
    if (existing) {
      throw new Error(`Transformation function '${transformationFunction.name}' already exists`);
    }

    const updatedMapping: SchemaMappingDefinition = {
      ...mapping,
      transformation_functions: [...mapping.transformation_functions, transformationFunction],
      updated_at: new Date()
    };

    // Validate the updated mapping
    const validation = this.validate(updatedMapping);
    if (!validation.isValid) {
      throw new Error(`Adding transformation function failed validation: ${validation.errors.join(', ')}`);
    }

    return updatedMapping;
  }

  /**
   * Creates a comprehensive mapping analysis
   */
  static analyzeMapping(mapping: SchemaMappingDefinition): {
    totalFieldMappings: number;
    requiredFields: number;
    optionalFields: number;
    fieldsWithTransformations: number;
    fieldsWithValidation: number;
    transformationFunctions: number;
    validationRules: number;
    complexity: 'low' | 'medium' | 'high';
    issues: string[];
    recommendations: string[];
  } {
    const totalFieldMappings = mapping.field_mappings.length;
    const requiredFields = mapping.field_mappings.filter(fm => fm.is_required).length;
    const optionalFields = totalFieldMappings - requiredFields;
    const fieldsWithTransformations = mapping.field_mappings.filter(fm => fm.transformation).length;

    // Count unique fields with validation rules
    const fieldsWithValidationSet = new Set(mapping.validation_rules.map(vr => vr.field_name));
    const fieldsWithValidation = fieldsWithValidationSet.size;

    const transformationFunctions = mapping.transformation_functions.length;
    const validationRules = mapping.validation_rules.length;

    // Determine complexity
    let complexity: 'low' | 'medium' | 'high';
    const complexityScore = totalFieldMappings + (transformationFunctions * 2) + validationRules;

    if (complexityScore < 10) {
      complexity = 'low';
    } else if (complexityScore < 25) {
      complexity = 'medium';
    } else {
      complexity = 'high';
    }

    // Identify issues
    const issues: string[] = [];
    const recommendations: string[] = [];

    // Check for orphaned transformation functions
    const usedTransformations = new Set(
      mapping.field_mappings
        .filter(fm => fm.transformation)
        .map(fm => fm.transformation!)
    );

    const unusedTransformations = mapping.transformation_functions.filter(
      tf => !usedTransformations.has(tf.name)
    );

    if (unusedTransformations.length > 0) {
      issues.push(`${unusedTransformations.length} unused transformation function(s): ${unusedTransformations.map(tf => tf.name).join(', ')}`);
      recommendations.push('Remove unused transformation functions to reduce complexity');
    }

    // Check for fields without validation
    const fieldsWithoutValidation = mapping.field_mappings.filter(
      fm => !mapping.validation_rules.some(vr => vr.field_name === fm.destination_field || vr.field_name === fm.source_field)
    );

    if (fieldsWithoutValidation.length > 0 && fieldsWithoutValidation.length > totalFieldMappings * 0.5) {
      issues.push(`${fieldsWithoutValidation.length} field(s) have no validation rules`);
      recommendations.push('Consider adding validation rules for critical fields');
    }

    // Check for high complexity
    if (complexity === 'high') {
      recommendations.push('Consider breaking down this mapping into smaller, more focused mappings');
    }

    // Check version
    if (mapping.version === '1.0.0' && (transformationFunctions > 0 || validationRules > 5)) {
      recommendations.push('Consider incrementing version number to reflect mapping complexity');
    }

    return {
      totalFieldMappings,
      requiredFields,
      optionalFields,
      fieldsWithTransformations,
      fieldsWithValidation,
      transformationFunctions,
      validationRules,
      complexity,
      issues,
      recommendations
    };
  }

  /**
   * Generates transformation function execution context
   */
  static generateTransformationContext(mapping: SchemaMappingDefinition): {
    functions: Record<string, string>;
    metadata: {
      totalFunctions: number;
      functionNames: string[];
      safetyChecks: string[];
    };
  } {
    const functions: Record<string, string> = {};
    const functionNames: string[] = [];
    const safetyChecks: string[] = [];

    mapping.transformation_functions.forEach(tf => {
      functions[tf.name] = tf.function_body;
      functionNames.push(tf.name);

      // Add basic safety checks
      if (tf.function_body.includes('eval')) {
        safetyChecks.push(`Warning: Function '${tf.name}' contains 'eval' - potential security risk`);
      }

      if (tf.function_body.includes('require') || tf.function_body.includes('import')) {
        safetyChecks.push(`Warning: Function '${tf.name}' contains module imports - may cause runtime errors`);
      }
    });

    return {
      functions,
      metadata: {
        totalFunctions: mapping.transformation_functions.length,
        functionNames,
        safetyChecks
      }
    };
  }

  /**
   * Creates a schema mapping for a common entity pattern
   */
  static createStandardEntityMapping(
    entityType: ValidEntityType,
    sourceTable: string,
    destinationTable: string,
    customMappings: FieldMapping[] = []
  ): SchemaMappingDefinition {
    // Standard field mappings that are common across entities
    const standardMappings: FieldMapping[] = [
      this.createFieldMapping('id', 'legacy_id', 'integer', true),
      this.createFieldMapping('created_at', 'created_at', 'timestamp', false, { transformation: 'ensureTimestamp' }),
      this.createFieldMapping('updated_at', 'updated_at', 'timestamp', false, { transformation: 'ensureTimestamp' })
    ];

    // Standard transformation functions
    const standardTransformations: TransformationFunction[] = [
      this.createTransformationFunction(
        'ensureTimestamp',
        'Ensures value is a valid timestamp',
        'function ensureTimestamp(value: any): Date | null { return value ? new Date(value) : null; }'
      )
    ];

    // Standard validation rules
    const standardValidations: ValidationRule[] = [
      this.createValidationRule('legacy_id', 'required'),
      this.createValidationRule('legacy_id', 'unique')
    ];

    return this.create({
      entity_type: entityType,
      source_table: sourceTable,
      destination_table: destinationTable,
      field_mappings: [...standardMappings, ...customMappings],
      validation_rules: [...standardValidations],
      transformation_functions: [...standardTransformations],
      version: '1.0.0'
    });
  }

  /**
   * Serializes schema mapping for database storage
   */
  static serialize(mapping: SchemaMappingDefinition): {
    id: string;
    entity_type: string;
    source_table: string;
    destination_table: string;
    field_mappings: string; // JSON string
    validation_rules: string; // JSON string
    transformation_functions: string; // JSON string
    version: string;
    is_active: boolean;
    created_at: string; // ISO string
    updated_at: string; // ISO string
  } {
    return {
      id: mapping.id,
      entity_type: mapping.entity_type,
      source_table: mapping.source_table,
      destination_table: mapping.destination_table,
      field_mappings: JSON.stringify(mapping.field_mappings),
      validation_rules: JSON.stringify(mapping.validation_rules),
      transformation_functions: JSON.stringify(mapping.transformation_functions),
      version: mapping.version,
      is_active: mapping.is_active,
      created_at: mapping.created_at.toISOString(),
      updated_at: mapping.updated_at.toISOString()
    };
  }

  /**
   * Deserializes schema mapping from database storage
   */
  static deserialize(data: any): SchemaMappingDefinition {
    try {
      return {
        id: data.id,
        entity_type: data.entity_type,
        source_table: data.source_table,
        destination_table: data.destination_table,
        field_mappings: typeof data.field_mappings === 'string' ? JSON.parse(data.field_mappings) : data.field_mappings,
        validation_rules: typeof data.validation_rules === 'string' ? JSON.parse(data.validation_rules) : data.validation_rules,
        transformation_functions: typeof data.transformation_functions === 'string' ? JSON.parse(data.transformation_functions) : data.transformation_functions,
        version: data.version,
        is_active: Boolean(data.is_active),
        created_at: typeof data.created_at === 'string' ? new Date(data.created_at) : data.created_at,
        updated_at: typeof data.updated_at === 'string' ? new Date(data.updated_at) : data.updated_at
      };
    } catch (error) {
      throw new Error(`Failed to deserialize schema mapping: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Creates a migration compatibility report between two schema versions
   */
  static createCompatibilityReport(
    oldMapping: SchemaMappingDefinition,
    newMapping: SchemaMappingDefinition
  ): {
    compatible: boolean;
    version: { old: string; new: string };
    changes: {
      addedFields: string[];
      removedFields: string[];
      modifiedFields: string[];
      addedValidations: string[];
      removedValidations: string[];
      addedTransformations: string[];
      removedTransformations: string[];
    };
    breakingChanges: string[];
    recommendations: string[];
  } {
    if (oldMapping.entity_type !== newMapping.entity_type) {
      throw new Error('Cannot compare mappings for different entity types');
    }

    // Compare field mappings
    const oldFields = new Set(oldMapping.field_mappings.map(fm => fm.source_field));
    const newFields = new Set(newMapping.field_mappings.map(fm => fm.source_field));

    const addedFields = Array.from(newFields).filter(field => !oldFields.has(field));
    const removedFields = Array.from(oldFields).filter(field => !newFields.has(field));

    // Check for modified fields
    const modifiedFields: string[] = [];
    oldMapping.field_mappings.forEach(oldField => {
      const newField = newMapping.field_mappings.find(nf => nf.source_field === oldField.source_field);
      if (newField && (
        oldField.destination_field !== newField.destination_field ||
        oldField.data_type !== newField.data_type ||
        oldField.is_required !== newField.is_required ||
        oldField.transformation !== newField.transformation
      )) {
        modifiedFields.push(oldField.source_field);
      }
    });

    // Compare validation rules
    const oldValidations = new Set(oldMapping.validation_rules.map(vr => `${vr.field_name}:${vr.rule_type}`));
    const newValidations = new Set(newMapping.validation_rules.map(vr => `${vr.field_name}:${vr.rule_type}`));

    const addedValidations = Array.from(newValidations).filter(rule => !oldValidations.has(rule));
    const removedValidations = Array.from(oldValidations).filter(rule => !newValidations.has(rule));

    // Compare transformation functions
    const oldTransformations = new Set(oldMapping.transformation_functions.map(tf => tf.name));
    const newTransformations = new Set(newMapping.transformation_functions.map(tf => tf.name));

    const addedTransformations = Array.from(newTransformations).filter(func => !oldTransformations.has(func));
    const removedTransformations = Array.from(oldTransformations).filter(func => !newTransformations.has(func));

    // Identify breaking changes
    const breakingChanges: string[] = [];
    const recommendations: string[] = [];

    if (removedFields.length > 0) {
      breakingChanges.push(`Removed fields: ${removedFields.join(', ')}`);
      recommendations.push('Consider deprecating fields instead of removing them immediately');
    }

    if (modifiedFields.length > 0) {
      const requiredChanges = modifiedFields.filter(field => {
        const oldField = oldMapping.field_mappings.find(fm => fm.source_field === field);
        const newField = newMapping.field_mappings.find(fm => fm.source_field === field);
        return oldField && newField && oldField.is_required !== newField.is_required;
      });

      if (requiredChanges.length > 0) {
        breakingChanges.push(`Changed required status for fields: ${requiredChanges.join(', ')}`);
      }
    }

    if (removedTransformations.length > 0) {
      breakingChanges.push(`Removed transformation functions: ${removedTransformations.join(', ')}`);
    }

    // Determine overall compatibility
    const compatible = breakingChanges.length === 0;

    if (addedFields.length > 0) {
      recommendations.push('Test new field mappings thoroughly before deployment');
    }

    if (addedValidations.length > 0) {
      recommendations.push('Ensure existing data meets new validation requirements');
    }

    return {
      compatible,
      version: { old: oldMapping.version, new: newMapping.version },
      changes: {
        addedFields,
        removedFields,
        modifiedFields,
        addedValidations,
        removedValidations,
        addedTransformations,
        removedTransformations
      },
      breakingChanges,
      recommendations
    };
  }
}