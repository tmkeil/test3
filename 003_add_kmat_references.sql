-- Migration: Add KMAT References Table
-- Date: 2025-12-15
-- Description: Adds kmat_references table for storing KMAT references per configured product path

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
