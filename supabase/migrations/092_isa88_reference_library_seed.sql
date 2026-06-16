-- Migration 092: Seed ISA-88 Part 1 reference into reference_library
-- Inserts the document record and ~30 section index entries with topic tags.
-- Content fields contain original summaries for FTS — not copyrighted text.
-- Users can enrich sections via the Reference Library upload UI.

-- Insert the document record
INSERT INTO reference_library_docs (
  id, title, source_filename, file_type,
  total_chars, section_count,
  plc_brand, compatible_cpus, programming_language
)
VALUES (
  'a0000000-0000-0000-0000-000000880001',
  'ISA-88.00.01-2010 Batch Control Part 1: Models and Terminology',
  '606117434-ISA-88-00-01-Batch-Control-Part-1-Models-and-Terminology.pdf',
  'pdf',
  0, -- will be updated after sections are inserted
  30,
  'GENERAL',
  '{}',
  'GENERAL'
)
ON CONFLICT (id) DO NOTHING;

-- Insert sections indexed by clause number
INSERT INTO reference_library_sections (
  doc_id, section_index, heading, content, char_count, topic_tags
)
VALUES
-- Section 1: Scope
(
  'a0000000-0000-0000-0000-000000880001', 1,
  '1 Scope',
  'Defines the scope of the ISA-88 Part 1 standard covering models and terminology for batch manufacturing control. Applies to batch processes in process industries where materials are produced in finite quantities by subjecting them to an ordered set of processing activities using one or more pieces of equipment.',
  320,
  ARRAY['scope', 'batch_control', 'isa88']
),

-- Section 2: Terms and definitions
(
  'a0000000-0000-0000-0000-000000880001', 2,
  '3 Terms, definitions and abbreviations',
  'Comprehensive glossary of ISA-88 terminology including: batch, campaign, control module, equipment module, unit, process cell, area, enterprise, site, procedure, unit procedure, operation, phase, recipe, master recipe, control recipe, general recipe, site recipe, formula, header, equipment requirements, process action, process operation, process stage, allocation, arbitration, process variable, setpoint, mode, state, exception handling.',
  460,
  ARRAY['terminology', 'definitions', 'glossary', 'isa88']
),

-- Section 3: Types of manufacturing
(
  'a0000000-0000-0000-0000-000000880001', 3,
  '4.2 Types of manufacturing',
  'Distinguishes between continuous, discrete, and batch manufacturing. Batch manufacturing produces material in finite quantities (batches) by subjecting quantities of input materials to an ordered set of processing activities over a finite period of time using one or more pieces of equipment. Batch processes may incorporate elements of both continuous and discrete manufacturing.',
  400,
  ARRAY['batch_control', 'manufacturing_types', 'isa88']
),

-- Section 4: Process model
(
  'a0000000-0000-0000-0000-000000880001', 4,
  '4.3 Process model',
  'Defines the ISA-88 Process Model hierarchy: Process, Process Stage, Process Operation, Process Action. The process model is product-centric — it describes what happens to the product/material, not how equipment does it. A Process is the complete sequence of chemical, physical, or biological activities for creating a batch. Process Stages are ordered parts of a process carried out independently of other stages. Process Operations are major processing activities within a stage. Process Actions are minor processing activities within an operation.',
  560,
  ARRAY['process_model', 'process_stage', 'process_operation', 'process_action', 'isa88']
),

-- Section 5: Physical model overview
(
  'a0000000-0000-0000-0000-000000880001', 5,
  '4.4 Equipment and equipment control',
  'Introduces the ISA-88 Physical Model hierarchy for batch manufacturing equipment: Enterprise, Site, Area, Process Cell, Unit, Equipment Module, Control Module. The physical model defines levels of equipment aggregation that participate in batch manufacturing. Each level has defined roles, capabilities, and containment relationships.',
  380,
  ARRAY['physical_model', 'equipment', 'hierarchy', 'isa88']
),

-- Section 6: Process Cell
(
  'a0000000-0000-0000-0000-000000880001', 6,
  '4.4.3.4 Process cell',
  'A process cell contains all the equipment, utilities, and controls needed to make a batch. It is the lowest level of the physical model concerned with scheduling and resource allocation. A process cell contains units, equipment modules, and control modules. Multiple process cells may exist within an area. The process cell boundary typically defines the scope of one batch control system.',
  400,
  ARRAY['physical_model', 'process_cell', 'isa88']
),

-- Section 7: Unit
(
  'a0000000-0000-0000-0000-000000880001', 7,
  '4.4.3.5 Unit',
  'A unit is a collection of associated control modules and/or equipment modules and other process equipment that can carry out one or more major processing activities such as reaction, crystallization, mixing. A unit operates on only one batch at a time. Units are where batch process actions take place. A unit may acquire and release equipment modules and control modules during batch execution. The unit is the central concept linking the physical and procedural models.',
  490,
  ARRAY['physical_model', 'unit', 'isa88']
),

-- Section 8: Equipment Module
(
  'a0000000-0000-0000-0000-000000880001', 8,
  '4.4.3.6 Equipment module',
  'An equipment module is a functional group of equipment that can carry out a finite number of specific minor processing activities. Equipment modules combine with other equipment modules and control modules to form a unit. An equipment module may be part of a unit or stand-alone. Equipment modules may be exclusive-use (dedicated to one unit) or shared (acquired by different units). An equipment module is made up of control modules and possibly other equipment modules. It can execute phases and provides the interface between procedural control and basic control.',
  570,
  ARRAY['physical_model', 'equipment_module', 'isa88']
),

-- Section 9: Control Module
(
  'a0000000-0000-0000-0000-000000880001', 9,
  '4.4.3.7 Control module',
  'A control module is typically a collection of sensors, actuators, and other control equipment that from the process control perspective operates as a single entity. A control module can be manipulated by equipment modules or directly by units. Control modules execute basic control — regulatory control, interlocking, and monitoring. The lowest level of the physical model. Control modules may be nested within other control modules. Examples include a valve with position feedback, a motor with run/fault signals, or a simple sensor.',
  520,
  ARRAY['physical_model', 'control_module', 'isa88']
),

-- Section 10: Collapsible hierarchy
(
  'a0000000-0000-0000-0000-000000880001', 10,
  '4.4.3.7 Physical model — collapsible hierarchy',
  'ISA-88 section 4.4.3.7 states that levels of the physical model may be collapsed when the full hierarchy is unnecessary for a given application. For example, a simple machine may collapse the equipment module level so that control modules are direct children of a unit. A process cell with only one unit may collapse the process cell level. The hierarchy is flexible — intermediate levels can be omitted when they add no organizational value. This allows the model to scale from simple single-unit systems to complex multi-unit facilities.',
  530,
  ARRAY['physical_model', 'collapsible', 'hierarchy', 'flexibility', 'isa88']
),

-- Section 11: Process cell classification
(
  'a0000000-0000-0000-0000-000000880001', 11,
  '4.5 Process cell classification',
  'Classifies process cells based on how equipment is used: single-path (each batch follows the same path through equipment), multi-path (batches can take different paths), and no-path (equipment usage is completely flexible). Also covers equipment trains — fixed sequences of units that process batches together. Process cell classification affects scheduling, resource allocation, and recipe design.',
  400,
  ARRAY['process_cell', 'classification', 'equipment_train', 'scheduling', 'isa88']
),

-- Section 12: Basic control
(
  'a0000000-0000-0000-0000-000000880001', 12,
  '5.2 Basic control',
  'Basic control establishes and maintains a specific state of equipment and process. It includes regulatory control (PID loops, setpoint tracking), discrete control (on/off, open/close), and sequential control for equipment states. Basic control resides in control modules. It responds to commands from procedural control or operator input. Basic control provides the foundation that procedural control builds upon — it manages individual equipment elements independently of the batch recipe.',
  470,
  ARRAY['basic_control', 'regulatory_control', 'control_module', 'isa88']
),

-- Section 13: Procedural control model
(
  'a0000000-0000-0000-0000-000000880001', 13,
  '5.3 Procedural control',
  'Defines the Procedural Control Model hierarchy: Procedure, Unit Procedure, Operation, Phase. Procedural control directs equipment-oriented actions in an ordered sequence to carry out a process-oriented task. A Procedure is the highest level — the strategy for carrying out a process (makes one batch). A Unit Procedure executes within a single unit. An Operation represents a major processing step within a unit procedure. A Phase is the smallest element of procedural control that accomplishes a process-oriented task — it directly commands equipment actions.',
  560,
  ARRAY['procedural_control', 'procedure', 'unit_procedure', 'operation', 'phase', 'isa88']
),

-- Section 14: Phases
(
  'a0000000-0000-0000-0000-000000880001', 14,
  '5.3.4 Phase',
  'A phase is the smallest element of procedural control that can accomplish a process-oriented task. Phases issue commands to basic control (control modules) to cause process-oriented actions. A phase may involve multiple equipment commands, monitoring, and exception handling. Phases are equipment-dependent — they know about specific control modules and their capabilities. An equipment phase is a phase designed to run in a specific equipment module. Phases are the bridge between recipe logic and equipment control.',
  490,
  ARRAY['procedural_control', 'phase', 'equipment_phase', 'isa88']
),

-- Section 15: Coordination control
(
  'a0000000-0000-0000-0000-000000880001', 15,
  '5.4 Coordination control',
  'Coordination control manages and coordinates the execution of procedural and basic control. It handles resource allocation (assigning shared equipment to batches), batch scheduling (sequencing batches through equipment), process state management, and propagation of modes and states between procedural elements. Coordination control ensures that units, equipment modules, and control modules work together as intended by the recipe. It manages contention when multiple batches compete for shared resources.',
  490,
  ARRAY['coordination_control', 'scheduling', 'resource_allocation', 'isa88']
),

-- Section 16: Recipe types
(
  'a0000000-0000-0000-0000-000000880001', 16,
  '6.1 Recipe overview and types',
  'Defines four recipe types forming a hierarchy: General Recipe (site-independent, product-focused), Site Recipe (site-specific adaptation), Master Recipe (equipment-specific for a process cell), Control Recipe (specific batch instance with parameters). Recipes transform from product-oriented (general) to equipment-oriented (control) as they move through the hierarchy. Each recipe contains: header, formula, equipment requirements, procedure, and other information.',
  470,
  ARRAY['recipes', 'general_recipe', 'master_recipe', 'control_recipe', 'site_recipe', 'isa88']
),

-- Section 17: Recipe structure
(
  'a0000000-0000-0000-0000-000000880001', 17,
  '6.2 Recipe contents',
  'Recipe contents include: Header (administrative information — name, version, originator, dates), Formula (process inputs, process parameters, process outputs — the what and how much), Equipment Requirements (equipment needed — types and quantities), Procedure (the ordered set of procedural elements that define how to make the batch). The recipe procedure mirrors the procedural control model hierarchy and is the executable part of the recipe.',
  440,
  ARRAY['recipes', 'formula', 'procedure', 'equipment_requirements', 'isa88']
),

-- Section 18: Recipe procedure
(
  'a0000000-0000-0000-0000-000000880001', 18,
  '6.3 Recipe procedure',
  'The recipe procedure defines the strategy for carrying out a process. It mirrors the procedural control model: the recipe procedure contains unit procedures, which contain operations, which contain phases. Each level adds equipment-specific detail as recipes move from general to control. Recipe procedures use standard constructs: sequence (serial execution), selection (conditional branching), and simultaneous (parallel execution) to organize procedural elements.',
  440,
  ARRAY['recipes', 'recipe_procedure', 'sequence', 'branching', 'parallel', 'isa88']
),

-- Section 19: Modes and states
(
  'a0000000-0000-0000-0000-000000880001', 19,
  '7.1 Modes and states of procedural elements',
  'Defines the state machine for procedural elements: Running, Paused, Held, Stopped, Aborted, Complete, Idle, Restarting. Also defines modes: Automatic, Semi-Automatic, Manual. State transitions follow defined rules — not all transitions are valid. Procedural elements inherit states from their child elements. Mode changes propagate through the hierarchy. The state model ensures orderly startup, shutdown, and exception handling of batch processes.',
  450,
  ARRAY['modes', 'states', 'state_machine', 'procedural_control', 'packml', 'isa88']
),

-- Section 20: State transitions
(
  'a0000000-0000-0000-0000-000000880001', 20,
  '7.2 State transition diagrams',
  'Defines valid state transitions for procedural elements and equipment entities. Key transitional states: Starting (idle to running), Holding (running to held), Restarting (held to running), Stopping (any to stopped), Aborting (any to aborted), Completing (running to complete), Resetting (complete/stopped/aborted to idle). State transitions are triggered by commands from operators, coordination control, or exception conditions. Invalid transitions must be rejected.',
  460,
  ARRAY['states', 'state_transitions', 'state_machine', 'isa88']
),

-- Section 21: Exception handling
(
  'a0000000-0000-0000-0000-000000880001', 21,
  '7.3-7.4 Exception handling',
  'Exception handling covers responses to abnormal conditions during batch execution. Exceptions may originate from equipment failures, process deviations, operator actions, or external events. The standard defines exception handling at each procedural level. Responses include holding (pausing with intent to resume), stopping (orderly shutdown), and aborting (emergency shutdown). Exception propagation rules define how exceptions at one level affect parent and child procedural elements.',
  440,
  ARRAY['exception_handling', 'fault_handling', 'safety', 'isa88']
),

-- Section 22: Batch scheduling
(
  'a0000000-0000-0000-0000-000000880001', 22,
  '8.2 Recipe management',
  'Recipe management covers the creation, modification, storage, retrieval, and versioning of recipes. Includes transforming general recipes to site recipes to master recipes to control recipes. Recipe versioning ensures traceability. Recipe approval workflows ensure quality control. Recipe storage must maintain integrity and prevent unauthorized modification.',
  380,
  ARRAY['recipes', 'recipe_management', 'versioning', 'isa88']
),

-- Section 23: Production planning and scheduling
(
  'a0000000-0000-0000-0000-000000880001', 23,
  '8.3 Production planning and scheduling',
  'Production planning determines what to make, how much, and when. Scheduling determines which equipment to use and when. The batch scheduler assigns equipment (units, equipment modules) to batches based on availability, capability, and recipe requirements. Scheduling must account for shared equipment, cleaning requirements, equipment availability, and production priorities.',
  380,
  ARRAY['scheduling', 'production_planning', 'resource_allocation', 'isa88']
),

-- Section 24: Batch production
(
  'a0000000-0000-0000-0000-000000880001', 24,
  '8.4 Batch production',
  'Batch production covers the execution of control recipes on actual equipment. Includes batch initialization (creating a control recipe from a master recipe with specific parameters), batch execution (running the procedural control), batch monitoring (tracking progress, collecting data), and batch completion (final data collection, equipment release, reporting). Batch history records all significant events during production.',
  430,
  ARRAY['batch_production', 'batch_execution', 'batch_history', 'isa88']
),

-- Section 25: Process model to procedural model linkage
(
  'a0000000-0000-0000-0000-000000880001', 25,
  '4.3-5.3 Process model and procedural model linkage',
  'The process model and procedural control model describe the same manufacturing activity from different perspectives. Process (product) maps to Procedure (equipment). Process Stage maps to Unit Procedure. Process Operation maps to Operation. Process Action maps to Phase. The process model drives what needs to happen from a product perspective. The procedural model implements how it happens using equipment. This separation allows the same process to be executed on different equipment configurations.',
  500,
  ARRAY['process_model', 'procedural_control', 'linkage', 'physical_model', 'isa88']
),

-- Section 26: Equipment module role in procedural control
(
  'a0000000-0000-0000-0000-000000880001', 26,
  '4.4.3.6-5.3.4 Equipment module and phase relationship',
  'Equipment modules are the execution targets for phases. An equipment phase runs within an equipment module and commands the control modules that make up that equipment module. The equipment module provides the boundary between procedural control and basic control. When a phase executes, it sends commands to control modules within its equipment module to perform process actions. Equipment modules may support multiple phases simultaneously or sequentially depending on their capability.',
  480,
  ARRAY['equipment_module', 'phase', 'procedural_control', 'basic_control', 'isa88']
),

-- Section 27: Shared and exclusive equipment
(
  'a0000000-0000-0000-0000-000000880001', 27,
  '4.4.3 Shared and exclusive-use equipment',
  'Equipment at any level may be exclusive-use (dedicated to one unit/batch) or shared (acquired and released by different units/batches). Shared equipment requires arbitration — determining which requestor gets access. Equipment modules are commonly shared between units. Control modules within shared equipment modules are allocated along with their parent. Proper management of shared equipment prevents contention, deadlocks, and resource conflicts during multi-batch operation.',
  460,
  ARRAY['shared_equipment', 'exclusive_use', 'arbitration', 'resource_allocation', 'equipment_module', 'isa88']
),

-- Section 28: Equipment entities and modes
(
  'a0000000-0000-0000-0000-000000880001', 28,
  '7.5-7.7 Equipment entity modes and states',
  'Equipment entities (units, equipment modules, control modules) have their own modes and states independent of procedural elements. Equipment modes include: Automatic (responds to procedural commands), Semi-Automatic (requires operator confirmation), Manual (direct operator control). Equipment states reflect physical conditions. Mode and state of equipment entities constrain what procedural commands can execute. Mode propagation rules define how mode changes at one level affect nested equipment.',
  470,
  ARRAY['modes', 'states', 'equipment_module', 'unit', 'control_module', 'isa88']
),

-- Section 29: Naming conventions
(
  'a0000000-0000-0000-0000-000000880001', 29,
  '5.3-6.3 Naming and identification',
  'ISA-88 establishes naming conventions for equipment entities and procedural elements. Equipment is identified by tag or name at each level of the physical model. Procedural elements are named within their recipe context. Equipment-independent recipe elements use generic names that are bound to specific equipment at runtime. Equipment requirements in recipes specify equipment by type and capability rather than specific tag to allow flexibility in equipment assignment.',
  430,
  ARRAY['naming_conventions', 'identification', 'equipment', 'recipes', 'isa88']
),

-- Section 30: Compliance
(
  'a0000000-0000-0000-0000-000000880001', 30,
  '9 Completeness, compliance and conformance',
  'Defines criteria for claiming compliance with the ISA-88 standard. Systems may claim compliance at different levels: complete implementation of all models and terminology, partial implementation with documented deviations, or conformance to specific sections. Implementations should document which aspects of the standard are supported and any extensions or deviations. The standard does not mandate specific implementation technologies — it defines models and terminology that implementations should follow.',
  460,
  ARRAY['compliance', 'conformance', 'implementation', 'isa88']
)
ON CONFLICT DO NOTHING;

-- Update the total_chars count on the document
UPDATE reference_library_docs
SET total_chars = (
  SELECT COALESCE(SUM(char_count), 0)
  FROM reference_library_sections
  WHERE doc_id = 'a0000000-0000-0000-0000-000000880001'
)
WHERE id = 'a0000000-0000-0000-0000-000000880001';
