-- ============================================================================
-- PRODUCT VARIANT TREE - DATABASE SCHEMA
-- ============================================================================
-- SQLite Schema (Azure SQL Server compatible)
-- Created for hierarchical product configurator with 2M+ variants
-- ============================================================================

-- ============================================================================
-- TABLE: nodes
-- ============================================================================
-- Stores all nodes in the variant tree (Product Families, Pattern Containers,
-- Code Nodes, Leaf Nodes, Intermediate Nodes)
-- ============================================================================

CREATE TABLE IF NOT EXISTS nodes (
    -- Primary key
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    
    -- Hierarchy
    parent_id INTEGER,
    level INTEGER NOT NULL,  -- Depth from root (0 = Product Family)
    
    -- Node identification
    code TEXT,  -- NULL for Pattern Containers!
    name TEXT NOT NULL,  -- Category name (e.g., "Engine Type", "Color")
    
    -- Display labels
    label TEXT NOT NULL,  -- German description (e.g., "V8 Turbo", "Rot")
    label_en TEXT,  -- English description (optional)
    
    -- Position in final typecode
    position INTEGER NOT NULL,  -- Character position in full typecode
    
    -- Pattern Container attributes
    pattern INTEGER,  -- String length (only for Pattern Containers)
    
    -- Product identification
    full_typecode TEXT,  -- Complete product code (only for Leaves/Intermediates)
    is_intermediate_code BOOLEAN DEFAULT 0,  -- Has both typecode AND children?
    
    -- Grouping
    group_name TEXT,  -- Cross-branch grouping (e.g., "Performance", "Standard")
    
    -- Pictures (JSON array with image metadata)
    pictures TEXT DEFAULT '[]',  -- JSON: [{"url": "...", "description": "...", "uploaded_at": "..."}]
    
    -- Links (JSON array with external links)
    links TEXT DEFAULT '[]',  -- JSON: [{"url": "...", "title": "...", "description": "...", "added_at": "..."}]
    
    -- Metadata
    FOREIGN KEY (parent_id) REFERENCES nodes(id) ON DELETE CASCADE,
    
    -- Ensure either code OR pattern is set (not both)
    CHECK (
        (code IS NOT NULL AND pattern IS NULL) OR
        (code IS NULL AND pattern IS NOT NULL) OR
        (parent_id IS NULL)  -- Root node can have both NULL
    )
);

-- ============================================================================
-- INDEXES for nodes
-- ============================================================================

-- For Query 2: Get children of a node
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);

-- For Query 5: Find node by code
CREATE INDEX IF NOT EXISTS idx_nodes_code ON nodes(code) WHERE code IS NOT NULL;

-- For Query 6: Find product by full_typecode
CREATE INDEX IF NOT EXISTS idx_nodes_typecode ON nodes(full_typecode) WHERE full_typecode IS NOT NULL;

-- For Query 4: Get nodes at specific level
CREATE INDEX IF NOT EXISTS idx_nodes_level ON nodes(level);

-- Composite index for performance
CREATE INDEX IF NOT EXISTS idx_nodes_level_code ON nodes(level, code) WHERE code IS NOT NULL;


-- ============================================================================
-- TABLE: node_dates (OPTIONAL)
-- ============================================================================
-- Stores product lifecycle data (creation/modification dates)
-- Separated for cleaner schema (date_info is optional in JSON)
-- ============================================================================

CREATE TABLE IF NOT EXISTS node_dates (
    node_id INTEGER PRIMARY KEY,
    
    -- Usage statistics
    typecode_count INTEGER,  -- Number of products using this code
    
    -- Creation dates
    creation_earliest TEXT,  -- ISO 8601 format: YYYY-MM-DD
    creation_latest TEXT,
    
    -- Modification dates
    modification_earliest TEXT,
    modification_latest TEXT,
    
    -- Constraints
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
);


-- ============================================================================
-- TABLE: node_labels
-- ============================================================================
-- Stores structured labels with code segment information
-- Enables character-by-character code hints and granular label management
-- ============================================================================

CREATE TABLE IF NOT EXISTS node_labels (
    -- Primary key
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    
    -- Reference to parent node
    node_id INTEGER NOT NULL,
    
    -- Label structure
    title TEXT,                      -- Category name (e.g., "Spannung", "Schaltabstand")
    code_segment TEXT,               -- Extracted code (e.g., "P", "20", "I") - can be NULL
    position_start INTEGER,          -- Start position in node's code (1-based)
    position_end INTEGER,            -- End position in node's code (1-based)
    
    -- Label content
    label_de TEXT,                   -- German description
    label_en TEXT,                   -- English description
    
    -- Display order
    display_order INTEGER DEFAULT 0, -- Preserve original order for export
    
    -- Constraints
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

-- ============================================================================
-- INDEXES for node_labels
-- ============================================================================

-- For retrieving all labels of a node
CREATE INDEX IF NOT EXISTS idx_node_labels_node ON node_labels(node_id);

-- For code hint lookups
CREATE INDEX IF NOT EXISTS idx_node_labels_code ON node_labels(code_segment) WHERE code_segment IS NOT NULL;

-- For ordered retrieval
CREATE INDEX IF NOT EXISTS idx_node_labels_order ON node_labels(node_id, display_order);


-- ============================================================================
-- TABLE: node_paths (CLOSURE TABLE - OPTIONAL)
-- ============================================================================
-- Pre-computed transitive closure for fast hierarchical queries
-- Only needed if using Option A (Closure Table approach)
-- Storage: ~1-2 GB for 2M variants (28M relationships)
-- Performance: Instant lookups for Query 4
-- ============================================================================

CREATE TABLE IF NOT EXISTS node_paths (
    ancestor_id INTEGER NOT NULL,
    descendant_id INTEGER NOT NULL,
    depth INTEGER NOT NULL,  -- Number of levels between ancestor and descendant
    
    -- Composite primary key
    PRIMARY KEY (ancestor_id, descendant_id),
    
    -- Foreign keys
    FOREIGN KEY (ancestor_id) REFERENCES nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (descendant_id) REFERENCES nodes(id) ON DELETE CASCADE
);

-- ============================================================================
-- INDEXES for node_paths
-- ============================================================================

-- For backward compatibility checks (Query 4)
CREATE INDEX IF NOT EXISTS idx_paths_descendant ON node_paths(descendant_id);

-- For depth-based queries
CREATE INDEX IF NOT EXISTS idx_paths_depth ON node_paths(depth);


-- ============================================================================
-- TRIGGERS (For automatic Closure Table maintenance)
-- ============================================================================
-- Only needed if using Closure Table + allowing INSERT/DELETE operations
-- Can be omitted if data is read-only after initial import
-- ============================================================================

-- Trigger: Insert new paths when a node is added
CREATE TRIGGER IF NOT EXISTS trg_node_insert
AFTER INSERT ON nodes
FOR EACH ROW
WHEN NEW.parent_id IS NOT NULL
BEGIN
    -- Insert self-reference
    INSERT INTO node_paths (ancestor_id, descendant_id, depth)
    VALUES (NEW.id, NEW.id, 0);
    
    -- Insert paths through parent
    INSERT INTO node_paths (ancestor_id, descendant_id, depth)
    SELECT ancestor_id, NEW.id, depth + 1
    FROM node_paths
    WHERE descendant_id = NEW.parent_id;
END;

-- Trigger: Delete all paths when a node is deleted
CREATE TRIGGER IF NOT EXISTS trg_node_delete
BEFORE DELETE ON nodes
FOR EACH ROW
BEGIN
    -- Delete all paths involving this node
    DELETE FROM node_paths
    WHERE ancestor_id = OLD.id OR descendant_id = OLD.id;
END;


-- ============================================================================
-- VIEWS (Helper views for common queries)
-- ============================================================================

-- View: All product families (Query 1)
CREATE VIEW IF NOT EXISTS v_product_families AS
SELECT id, code, label, label_en, position, group_name
FROM nodes
WHERE parent_id IS NULL AND code IS NOT NULL
ORDER BY code;

-- View: All leaf products (final products without children)
CREATE VIEW IF NOT EXISTS v_leaf_products AS
SELECT id, code, full_typecode, label, label_en
FROM nodes
WHERE full_typecode IS NOT NULL
  AND is_intermediate_code = 0
ORDER BY full_typecode;

-- View: All intermediate products (products with variants)
CREATE VIEW IF NOT EXISTS v_intermediate_products AS
SELECT id, code, full_typecode, label, label_en
FROM nodes
WHERE full_typecode IS NOT NULL
  AND is_intermediate_code = 1
ORDER BY full_typecode;


-- ============================================================================
-- COMMENTS & DOCUMENTATION
-- ============================================================================

-- Schema Design Notes:
-- 
-- 1. LEVEL CALCULATION:
--    - Level 0 = Product Family (root)
--    - Level 1+ = Selection steps
--    - Pattern Containers DO NOT count as levels (they're organizational)
--    - Level is calculated during import based on tree depth
--
-- 2. PATTERN CONTAINERS:
--    - Have `pattern` set, `code` is NULL
--    - Not selectable by users
--    - Organizational only (group codes by length)
--
-- 3. INTERMEDIATE CODES:
--    - Have both `full_typecode` AND children
--    - Represent products that can be ordered as-is OR customized further
--
-- 4. CLOSURE TABLE (node_paths):
--    - Optional but HIGHLY RECOMMENDED for 2M+ records
--    - Stores ALL ancestor-descendant relationships
--    - Example: If A→B→C→D exists, stores:
--      * A→A (depth=0), A→B (depth=1), A→C (depth=2), A→D (depth=3)
--      * B→B (depth=0), B→C (depth=1), B→D (depth=2)
--      * C→C (depth=0), C→D (depth=1)
--      * D→D (depth=0)
--    - Enables instant path existence checks for Query 4
--
-- 5. PERFORMANCE OPTIMIZATION:
--    - Indexes on parent_id, code, level for fast queries
--    - Closure table for O(1) path lookups (vs O(n) recursive)
--    - Triggers maintain closure table automatically on INSERT/DELETE
--
-- 6. AZURE SQL SERVER COMPATIBILITY:
--    - Change AUTOINCREMENT to IDENTITY(1,1)
--    - Change BOOLEAN to BIT
--    - Change TEXT to NVARCHAR(MAX) or appropriate size
--    - Triggers syntax may need adjustment
--
-- ============================================================================

-- ============================================================================
-- TABLE: product_successors
-- ============================================================================
-- Tracks product lifecycle: successors, replacements, and migrations
-- Enables warnings about deprecated products and recommendations for new ones
-- ============================================================================

CREATE TABLE IF NOT EXISTS product_successors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    
    -- Source (the old/deprecated product or node)
    source_node_id INTEGER NOT NULL,
    source_type TEXT NOT NULL CHECK(source_type IN ('node', 'leaf', 'intermediate')),
    
    -- Target (the new/recommended product or node)
    target_node_id INTEGER,  -- NULL if target is a full code from different family
    target_full_code TEXT,  -- For cross-family migrations
    target_family_code TEXT,  -- Product family of target (for quick lookup)
    
    -- Metadata
    replacement_type TEXT NOT NULL CHECK(replacement_type IN ('successor', 'alternative', 'deprecated')),
    migration_note TEXT,  -- e.g., "Technisch identisch, neue Bezeichnung"
    migration_note_en TEXT,  -- English version
    effective_date DATE,  -- When this recommendation becomes active
    
    -- Display settings
    show_warning BOOLEAN DEFAULT 1,  -- Show warning to users
    allow_old_selection BOOLEAN DEFAULT 1,  -- Can users still select old product?
    warning_severity TEXT DEFAULT 'info' CHECK(warning_severity IN ('info', 'warning', 'critical')),
    
    -- Audit
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT,  -- Username of admin who created this
    
    -- Constraints
    FOREIGN KEY (source_node_id) REFERENCES nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (target_node_id) REFERENCES nodes(id) ON DELETE SET NULL,
    
    -- Either target_node_id OR target_full_code must be set
    CHECK (
        (target_node_id IS NOT NULL AND target_full_code IS NULL) OR
        (target_node_id IS NULL AND target_full_code IS NOT NULL)
    )
);

-- ============================================================================
-- INDEXES for product_successors
-- ============================================================================

-- For finding successors of a specific node
CREATE INDEX IF NOT EXISTS idx_successors_source ON product_successors(source_node_id);

-- For finding what products point to a specific target
CREATE INDEX IF NOT EXISTS idx_successors_target ON product_successors(target_node_id) WHERE target_node_id IS NOT NULL;

-- For filtering by type and active warnings
CREATE INDEX IF NOT EXISTS idx_successors_type ON product_successors(replacement_type, show_warning);

-- For date-based queries (future: auto-activate warnings)
CREATE INDEX IF NOT EXISTS idx_successors_date ON product_successors(effective_date) WHERE effective_date IS NOT NULL;

-- Prevent duplicate successor relationships (same source + target)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_successor 
ON product_successors(source_node_id, target_node_id) 
WHERE target_node_id IS NOT NULL;


-- ============================================================================
-- TABLE: users
-- ============================================================================
-- User accounts für Authentication (Admins & normale Users)
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
    is_active BOOLEAN DEFAULT 1,
    must_change_password BOOLEAN DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes für Users
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);


-- ============================================================================
-- TABLE: kmat_references
-- ============================================================================
-- Stores KMAT references for configured products (full paths)
-- Each configuration (path through tree) can have its own KMAT reference
-- ============================================================================

CREATE TABLE IF NOT EXISTS kmat_references (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    
    -- Product identification via path
    family_id INTEGER NOT NULL,  -- Root node (level 0)
    path_node_ids TEXT NOT NULL,  -- JSON array of node IDs: [1, 5, 12, 45]
    full_typecode TEXT NOT NULL,  -- Complete product code for quick lookup
    
    -- KMAT reference data
    kmat_reference TEXT NOT NULL,  -- The KMAT reference string
    
    -- Metadata
    created_by INTEGER,  -- Admin user who created it
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (family_id) REFERENCES nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    
    -- Ensure unique KMAT reference per path
    UNIQUE(family_id, path_node_ids)
);

-- Indexes für KMAT References
CREATE INDEX IF NOT EXISTS idx_kmat_family ON kmat_references(family_id);
CREATE INDEX IF NOT EXISTS idx_kmat_typecode ON kmat_references(full_typecode);
CREATE INDEX IF NOT EXISTS idx_kmat_created_by ON kmat_references(created_by);
