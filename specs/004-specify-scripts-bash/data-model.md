# Data Model: Final Database Migration Phase - Remaining Tables

**Date**: 2025-10-18 | **Phase**: 1 - Data Model Design

## Overview

This document defines the data models, relationships, and schema mappings for the final 9 tables in the database migration project. Each table mapping preserves legacy relationships while establishing proper UUID-based foreign keys in the target system.

## Table Schemas & Relationships

### 1. Message Attachments

**Purpose**: Links file attachments to messages for complete communication context

```sql
-- Target Schema
CREATE TABLE message_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,

  -- Attachment metadata
  attachment_type VARCHAR(50), -- 'image', 'document', 'scan', etc.
  display_name VARCHAR(255),
  file_size BIGINT,
  mime_type VARCHAR(100),

  -- Timestamps
  attached_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Legacy tracking
  legacy_file_id INTEGER,
  legacy_message_id INTEGER,
  legacy_dispatch_record_id INTEGER,

  -- Metadata
  metadata JSONB DEFAULT '{}',

  UNIQUE(message_id, file_id)
);
```

**Source Mapping**:
- `dispatch_file` → `message_attachments`
- Join via `dispatch_record.id` → `messages.legacy_record_id`
- Link via `dispatch_file.id` → `files.legacy_file_id`

### 2. Technicians

**Purpose**: Staff member profiles for system access and role management

```sql
-- Target Schema
CREATE TABLE technicians (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Technician details
  employee_id VARCHAR(50) UNIQUE,
  department VARCHAR(100),
  position VARCHAR(100),
  hire_date DATE,
  status VARCHAR(20) DEFAULT 'active', -- active, inactive, terminated

  -- Contact information
  phone VARCHAR(20),
  email VARCHAR(255),
  emergency_contact JSONB,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Legacy tracking
  legacy_technician_id INTEGER UNIQUE NOT NULL,
  legacy_user_id INTEGER,

  -- Metadata
  metadata JSONB DEFAULT '{}'
);
```

**Source Mapping**:
- `dispatch_technician` → `technicians`
- Link via `dispatch_user.id` → `profiles.legacy_user_id`

### 3. Technician Roles

**Purpose**: Role assignments and permissions for technicians

```sql
-- Target Schema
CREATE TABLE technician_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id UUID NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,

  -- Role definition
  role_name VARCHAR(100) NOT NULL,
  role_type VARCHAR(50), -- 'system', 'clinical', 'administrative'
  permissions JSONB DEFAULT '[]', -- Array of permission strings

  -- Role scope
  scope_type VARCHAR(50), -- 'global', 'office', 'department'
  scope_id UUID, -- Reference to office, department, etc.

  -- Validity
  effective_date DATE NOT NULL,
  expiry_date DATE,
  is_active BOOLEAN DEFAULT true,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Legacy tracking
  legacy_role_id INTEGER UNIQUE NOT NULL,
  legacy_technician_id INTEGER,

  -- Metadata
  metadata JSONB DEFAULT '{}'
);
```

**Source Mapping**:
- `dispatch_technician_role` → `technician_roles`
- Link via `legacy_technician_id` → `technicians.legacy_technician_id`

### 4. Brackets

**Purpose**: Orthodontic bracket specifications and product information

```sql
-- Target Schema
CREATE TABLE brackets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Bracket identification
  bracket_code VARCHAR(50) UNIQUE NOT NULL,
  bracket_name VARCHAR(255) NOT NULL,
  manufacturer VARCHAR(100),
  model VARCHAR(100),

  -- Specifications
  material VARCHAR(50), -- 'metal', 'ceramic', 'plastic'
  arch_type VARCHAR(20), -- 'upper', 'lower', 'both'
  tooth_position VARCHAR(10), -- '11', '12', etc.
  bracket_type VARCHAR(50), -- 'standard', 'self-ligating', 'lingual'

  -- Dimensions
  slot_size DECIMAL(4,2), -- 0.018, 0.022, etc.
  base_dimensions JSONB, -- {width, height, thickness}

  -- Pricing and availability
  unit_cost DECIMAL(10,2),
  is_active BOOLEAN DEFAULT true,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Legacy tracking
  legacy_bracket_id INTEGER UNIQUE NOT NULL,

  -- Metadata
  metadata JSONB DEFAULT '{}'
);
```

**Source Mapping**:
- `dispatch_bracket` → `brackets`
- Direct mapping with specification preservation

### 5. Order Cases

**Purpose**: Junction table linking orders to cases for workflow management

```sql
-- Target Schema
CREATE TABLE order_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,

  -- Relationship details
  relationship_type VARCHAR(50), -- 'primary', 'secondary', 'revision'
  stage_number INTEGER,

  -- Status tracking
  status VARCHAR(50) DEFAULT 'active', -- active, completed, cancelled
  priority VARCHAR(20) DEFAULT 'normal', -- low, normal, high, urgent

  -- Workflow timestamps
  linked_at TIMESTAMP WITH TIME ZONE NOT NULL,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Legacy tracking
  legacy_order_case_id INTEGER UNIQUE,
  legacy_order_id INTEGER,
  legacy_case_id INTEGER,

  -- Metadata
  metadata JSONB DEFAULT '{}',

  UNIQUE(order_id, case_id, relationship_type)
);
```

**Source Mapping**:
- Junction table or derived from order/case relationships
- Map via `orders.legacy_instruction_id` and `cases.legacy_patient_id`

### 6. Purchases

**Purpose**: Financial transaction records with audit trails

```sql
-- Target Schema
CREATE TABLE purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Purchase identification
  purchase_number VARCHAR(100) UNIQUE NOT NULL,
  purchase_type VARCHAR(50), -- 'material', 'service', 'equipment'

  -- Financial details
  subtotal DECIMAL(12,2) NOT NULL,
  tax_amount DECIMAL(12,2) DEFAULT 0,
  discount_amount DECIMAL(12,2) DEFAULT 0,
  total_amount DECIMAL(12,2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',

  -- Parties
  vendor_name VARCHAR(255),
  vendor_contact JSONB,
  purchased_by UUID REFERENCES profiles(id),
  approved_by UUID REFERENCES profiles(id),

  -- References
  order_id UUID REFERENCES orders(id),
  case_id UUID REFERENCES cases(id),
  patient_id UUID REFERENCES patients(id),

  -- Status and dates
  status VARCHAR(50) DEFAULT 'pending', -- pending, approved, paid, cancelled
  purchase_date DATE NOT NULL,
  payment_date DATE,
  due_date DATE,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Legacy tracking
  legacy_purchase_id INTEGER UNIQUE NOT NULL,
  legacy_order_id INTEGER,
  legacy_patient_id INTEGER,

  -- Metadata and audit
  metadata JSONB DEFAULT '{}',
  audit_trail JSONB DEFAULT '[]'
);
```

**Source Mapping**:
- `dispatch_purchase` → `purchases`
- Financial data with complete audit preservation

### 7. Treatment Discussions

**Purpose**: Clinical discussion threads linked to cases

```sql
-- Target Schema
CREATE TABLE treatment_discussions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,

  -- Discussion details
  subject VARCHAR(255) NOT NULL,
  discussion_type VARCHAR(50), -- 'treatment_plan', 'review', 'consultation'
  priority VARCHAR(20) DEFAULT 'normal',

  -- Participants
  started_by UUID NOT NULL REFERENCES profiles(id),
  participants JSONB DEFAULT '[]', -- Array of profile UUIDs

  -- Status
  status VARCHAR(50) DEFAULT 'active', -- active, resolved, archived

  -- Content
  initial_message TEXT NOT NULL,
  tags JSONB DEFAULT '[]',

  -- Timestamps
  started_at TIMESTAMP WITH TIME ZONE NOT NULL,
  last_activity_at TIMESTAMP WITH TIME ZONE,
  resolved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Legacy tracking
  legacy_discussion_id INTEGER UNIQUE NOT NULL,
  legacy_case_id INTEGER,
  legacy_author_id INTEGER,

  -- Metadata
  metadata JSONB DEFAULT '{}'
);
```

**Source Mapping**:
- Treatment discussion table → `treatment_discussions`
- Link via case and profile relationships

### 8. Template View Groups

**Purpose**: Template access group definitions

```sql
-- Target Schema
CREATE TABLE template_view_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Group details
  group_name VARCHAR(100) UNIQUE NOT NULL,
  group_description TEXT,
  group_type VARCHAR(50), -- 'role_based', 'department', 'custom'

  -- Access control
  permissions JSONB DEFAULT '[]', -- Array of permission strings
  template_categories JSONB DEFAULT '[]', -- Categories this group can access

  -- Status
  is_active BOOLEAN DEFAULT true,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Legacy tracking
  legacy_group_id INTEGER UNIQUE NOT NULL,

  -- Metadata
  metadata JSONB DEFAULT '{}'
);
```

**Source Mapping**:
- Template group table → `template_view_groups`
- Simple entity migration

### 9. Template View Roles

**Purpose**: Role-based template access permissions

```sql
-- Target Schema
CREATE TABLE template_view_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES template_view_groups(id) ON DELETE CASCADE,

  -- Role details
  role_name VARCHAR(100) NOT NULL,
  role_level INTEGER DEFAULT 1, -- 1=view, 2=edit, 3=admin

  -- Permissions
  can_view BOOLEAN DEFAULT true,
  can_edit BOOLEAN DEFAULT false,
  can_create BOOLEAN DEFAULT false,
  can_delete BOOLEAN DEFAULT false,
  can_share BOOLEAN DEFAULT false,

  -- Scope
  template_types JSONB DEFAULT '[]', -- Specific template types
  restrictions JSONB DEFAULT '{}', -- Additional restrictions

  -- Status
  is_active BOOLEAN DEFAULT true,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Legacy tracking
  legacy_role_id INTEGER UNIQUE NOT NULL,
  legacy_group_id INTEGER,

  -- Metadata
  metadata JSONB DEFAULT '{}',

  UNIQUE(group_id, role_name)
);
```

**Source Mapping**:
- Template role table → `template_view_roles`
- Link via `template_view_groups` relationships

## Relationship Matrix

| Table | Dependencies | Foreign Keys | Complexity |
|-------|-------------|--------------|------------|
| message_attachments | messages, files | message_id, file_id | Medium |
| technicians | profiles | profile_id | Medium |
| technician_roles | technicians | technician_id | Low |
| brackets | none | none | Low |
| order_cases | orders, cases | order_id, case_id | Medium |
| purchases | orders, cases, patients, profiles | multiple optional | High |
| treatment_discussions | cases, profiles | case_id, started_by | Medium |
| template_view_groups | none | none | Low |
| template_view_roles | template_view_groups | group_id | Low |

## Migration Dependencies

**Sequential Order Required**:
1. `template_view_groups` (no dependencies)
2. `template_view_roles` (depends on groups)
3. `technicians` (depends on profiles)
4. `technician_roles` (depends on technicians)
5. `brackets` (no dependencies)
6. `treatment_discussions` (depends on cases, profiles)
7. `order_cases` (depends on orders, cases)
8. `message_attachments` (depends on messages, files)
9. `purchases` (depends on multiple entities)

## Data Integrity Constraints

### Critical Validations
1. **Financial Data**: All purchase amounts must be validated for accuracy
2. **Foreign Key Integrity**: All UUID references must exist in target tables
3. **Legacy ID Preservation**: All legacy IDs must be unique and preserved
4. **Timestamp Consistency**: All timestamps must be preserved from source
5. **Enum Values**: All status and type fields must use valid enumeration values

### Performance Considerations
- **Batch Size**: 500-1000 records per batch for optimal performance
- **Indexing**: Create indexes on foreign keys and frequently queried fields
- **Memory Usage**: Monitor memory during large table migrations
- **Transaction Safety**: Use appropriate transaction boundaries for rollback capability