#!/usr/bin/env python3
"""
Product Variant Tree - JSON to Database Importer
=================================================

Imports hierarchical product data from JSON into SQLite or PostgreSQL database.

Features:
- Supports SQLite and PostgreSQL
- Calculates node levels (skips Pattern Containers)
- Handles Pattern Containers vs. Code Nodes
- Optional: Builds Closure Table for performance
- Optional: Imports date_info

Usage:
    # SQLite (local file):
    python import_data.py --json variantenbaum.json --db products.db --closure
    
    # PostgreSQL (connection string):
    python import_data.py --json variantenbaum.json --db "postgresql://user:pass@host/dbname" --closure
"""

import sqlite3
import json
import argparse
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from datetime import datetime
from urllib.parse import urlparse

# Import label parser
from label_parser import parse_structured_label


class VariantTreeImporter:
    """Imports product variant tree from JSON to SQLite or PostgreSQL."""
    
    def __init__(self, db_path: str, schema_path: str = None):
        """Initialize importer with database connection."""
        self.db_path = db_path
        
        # Auto-detect schema path if provided path doesn't exist
        if schema_path is None:
            schema_path = "schema.sql"  # Default
        
        # Check if the provided path exists, if not, search for it
        if not Path(schema_path).exists():
            # Try to find schema.sql in common locations
            script_dir = Path(__file__).parent.resolve()
            possible_paths = [
                script_dir / "schema.sql",  # Same directory as import_data.py
                Path("database") / "schema.sql",  # database/ subdirectory relative to cwd
                Path(schema_path),  # Original path (might be relative)
            ]
            
            found_path = None
            for path in possible_paths:
                if path.exists():
                    found_path = str(path)
                    break
            
            if found_path:
                schema_path = found_path
            # If still not found, keep original schema_path (will error later with clear message)
        
        self.schema_path = schema_path
        self.conn = None
        self.cursor = None
        
        # Detect database type
        self.is_postgres = db_path.startswith('postgresql://') or db_path.startswith('postgres://')
        
        # Statistics
        self.stats = {
            'nodes_imported': 0,
            'dates_imported': 0,
            'paths_created': 0,
            'product_families': 0,
            'pattern_containers': 0,
            'code_nodes': 0,
            'leaf_products': 0,
            'intermediate_products': 0
        }
    
    def connect(self):
        """Connect to database (SQLite or PostgreSQL)."""
        print(f"📁 Connecting to database: {self.db_path if not self.is_postgres else 'PostgreSQL'}")
        
        if self.is_postgres:
            try:
                import psycopg2
            except ImportError:
                raise ImportError("psycopg2 required for PostgreSQL. Install: pip install psycopg2-binary")
            
            self.conn = psycopg2.connect(self.db_path)
            self.conn.autocommit = False
        else:
            self.conn = sqlite3.connect(self.db_path)
        
        self.cursor = self.conn.cursor()
        print("✅ Connected!")
    
    def create_schema(self):
        """Create database schema from SQL file."""
        print(f"📄 Creating schema from: {self.schema_path}")
        
        if not Path(self.schema_path).exists():
            raise FileNotFoundError(f"Schema file not found: {self.schema_path}")
        
        with open(self.schema_path, 'r', encoding='utf-8') as f:
            schema_sql = f.read()
        
        # Execute schema
        if self.is_postgres:
            # PostgreSQL: execute each statement separately
            statements = [s.strip() for s in schema_sql.split(';') if s.strip()]
            for stmt in statements:
                self.cursor.execute(stmt)
            self.conn.commit()
        else:
            # SQLite: use executescript
            self.cursor.executescript(schema_sql)
            self.conn.commit()
        
        print("✅ Schema created!")
        
        # Create constraints schema if exists
        constraints_schema_path = Path(self.schema_path).parent / "constraints_schema.sql"
        if constraints_schema_path.exists():
            print(f"📄 Creating constraints schema from: {constraints_schema_path}")
            with open(constraints_schema_path, 'r', encoding='utf-8') as f:
                constraints_sql = f.read()
            
            if self.is_postgres:
                statements = [s.strip() for s in constraints_sql.split(';') if s.strip()]
                for stmt in statements:
                    self.cursor.execute(stmt)
                self.conn.commit()
            else:
                self.cursor.executescript(constraints_sql)
                self.conn.commit()
            
            print("✅ Constraints schema created!")
        else:
            print("⚠️  Constraints schema not found, skipping...")
        
        # Seed initial admin user
        self._seed_admin_user()
    
    def _seed_admin_user(self):
        """Create initial admin user if no admins exist."""
        import os
        try:
            import bcrypt
        except ImportError:
            print("⚠️  bcrypt not installed, skipping admin seeding")
            return
        
        # Check if admin exists
        self.cursor.execute("SELECT COUNT(*) FROM users WHERE role = 'admin'")
        admin_count = self.cursor.fetchone()[0]
        
        if admin_count > 0:
            print(f"✅ {admin_count} admin(s) already exist")
            return
        
        # Get credentials from environment
        username = os.getenv("INITIAL_ADMIN_USERNAME", "admin")
        email = os.getenv("INITIAL_ADMIN_EMAIL", "admin@firma.com")
        password = os.getenv("INITIAL_ADMIN_PASSWORD", "ChangeMe123!")
        
        # Hash password
        password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt())
        
        try:
            self.cursor.execute("""
                INSERT INTO users (username, email, password_hash, role, is_active, must_change_password)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (username, email, password_hash, "admin", 1, 1))
            
            self.conn.commit()
            print(f"""
================================================================================
✅ Initial admin created!
   Username: {username}
   Email:    {email}
   
   ⚠️  WICHTIG: Admin-Credentials persönlich übergeben!
================================================================================
""")
        except Exception as e:
            print(f"⚠️  Could not create admin: {e}")
    
    def import_json(self, json_path: str, include_dates: bool = False):
        """Import data from JSON file."""
        print(f"📦 Loading JSON: {json_path}")
        
        if not Path(json_path).exists():
            raise FileNotFoundError(f"JSON file not found: {json_path}")
        
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Handle different JSON formats
        if isinstance(data, dict) and 'children' in data:
            # Format: {"children": [...product families...]}
            product_families = data['children']
        elif isinstance(data, list):
            # Format: [...product families...]
            product_families = data
        else:
            raise ValueError("Unexpected JSON format. Expected array or object with 'children'")
        
        print(f"✅ Loaded {len(product_families)} product families")
        
        # Import each product family
        for product_family in product_families:
            self._import_node(
                node=product_family,
                parent_id=None,
                parent_level=-1,  # Root is level 0
                include_dates=include_dates
            )
        
        self.conn.commit()
        print(f"✅ Imported {self.stats['nodes_imported']} nodes")
        if include_dates:
            print(f"✅ Imported {self.stats['dates_imported']} date records")
    
    def _import_node(
        self,
        node: Dict,
        parent_id: Optional[int],
        parent_level: int,
        include_dates: bool = False
    ) -> int:
        """
        Recursively import a node and its children.
        
        Returns:
            node_id of the imported node
        """
        # Determine if this is a Pattern Container
        is_pattern_container = ('pattern' in node and 
                               node.get('code') is None)
        
        # Calculate level
        if is_pattern_container:
            # Pattern Container doesn't increase level
            level = parent_level
        else:
            # Normal node increases level
            level = parent_level + 1
        
        # Extract node data
        code = node.get('code')
        name = node.get('name', '')
        label = node.get('label', '')
        label_en = node.get('label-en') or node.get('label_en')  # Support both formats
        position = node.get('position')
        pattern = node.get('pattern')
        full_typecode = node.get('full_typecode')
        is_intermediate = node.get('is_intermediate_code', False)
        group_name = node.get('group')
        
        # Bilder extrahieren (aus label_mapper.py generiert)
        pictures = node.get('pictures', [])
        pictures_json = json.dumps(pictures) if pictures else '[]'
        
        # Links extrahieren (aus label_mapper.py generiert)
        links = node.get('links', [])
        links_json = json.dumps(links) if links else '[]'
        
        # Insert node
        self.cursor.execute('''
            INSERT INTO nodes (
                parent_id, level, code, name, label, label_en,
                position, pattern, full_typecode, is_intermediate_code, group_name, pictures, links
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            parent_id, level, code, name, label, label_en,
            position, pattern, full_typecode, is_intermediate, group_name, pictures_json, links_json
        ))
        
        node_id = self.cursor.lastrowid
        self.stats['nodes_imported'] += 1
        
        # NEW: Parse and import structured labels
        if label or label_en:
            self._import_node_labels(node_id, code, label, label_en)
        
        # Update statistics
        if parent_id is None:
            self.stats['product_families'] += 1
        elif is_pattern_container:
            self.stats['pattern_containers'] += 1
        elif code is not None:
            self.stats['code_nodes'] += 1
            if full_typecode is not None:
                if is_intermediate:
                    self.stats['intermediate_products'] += 1
                else:
                    self.stats['leaf_products'] += 1
        
        # Import date_info if present
        if include_dates and 'date_info' in node:
            self._import_date_info(node_id, node['date_info'])
        
        # Recursively import children
        if 'children' in node and node['children']:
            for child in node['children']:
                self._import_node(
                    node=child,
                    parent_id=node_id,
                    parent_level=level,  # Pass current level, not parent_level!
                    include_dates=include_dates
                )
        
        return node_id
    
    def _import_date_info(self, node_id: int, date_info: Dict):
        """Import date_info for a node."""
        typecode_count = date_info.get('typecode_count')
        
        creation = date_info.get('creation_date', {})
        creation_earliest = creation.get('earliest')
        creation_latest = creation.get('latest')
        
        modification = date_info.get('modification_date', {})
        modification_earliest = modification.get('earliest')
        modification_latest = modification.get('latest')
        
        self.cursor.execute('''
            INSERT INTO node_dates (
                node_id, typecode_count,
                creation_earliest, creation_latest,
                modification_earliest, modification_latest
            ) VALUES (?, ?, ?, ?, ?, ?)
        ''', (
            node_id, typecode_count,
            creation_earliest, creation_latest,
            modification_earliest, modification_latest
        ))
        
        self.stats['dates_imported'] += 1
    
    def _import_node_labels(
        self, 
        node_id: int, 
        node_code: Optional[str], 
        label_de: Optional[str], 
        label_en: Optional[str]
    ):
        """
        Parse and import structured labels into node_labels table.
        
        Args:
            node_id: ID of the parent node
            node_code: Full code of the node (for position calculation)
            label_de: German label text
            label_en: English label text
        """
        # Parse German labels
        if label_de:
            segments_de = parse_structured_label(label_de, full_code=node_code)
            
            for seg in segments_de:
                self.cursor.execute('''
                    INSERT INTO node_labels (
                        node_id, title, code_segment, position_start, position_end,
                        label_de, display_order
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ''', (
                    node_id,
                    seg.get('title'),
                    seg.get('code_segment'),
                    seg.get('position_start'),
                    seg.get('position_end'),
                    seg.get('label'),
                    seg.get('display_order')
                ))
        
        # Parse English labels and merge with German
        if label_en:
            segments_en = parse_structured_label(label_en, full_code=node_code)
            
            for seg in segments_en:
                # Try to find matching German row by code_segment and position
                # (title may differ in different languages)
                self.cursor.execute('''
                    SELECT id FROM node_labels
                    WHERE node_id = ?
                      AND code_segment IS ?
                      AND position_start IS ?
                      AND position_end IS ?
                    LIMIT 1
                ''', (node_id, seg.get('code_segment'), seg.get('position_start'), seg.get('position_end')))
                
                existing = self.cursor.fetchone()
                
                if existing:
                    # Update existing row with English label and title
                    self.cursor.execute('''
                        UPDATE node_labels
                        SET label_en = ?
                        WHERE id = ?
                    ''', (seg.get('label'), existing[0]))
                else:
                    # Insert new row (English has different structure than German)
                    self.cursor.execute('''
                        INSERT INTO node_labels (
                            node_id, title, code_segment, position_start, position_end,
                            label_en, display_order
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    ''', (
                        node_id,
                        seg.get('title'),
                        seg.get('code_segment'),
                        seg.get('position_start'),
                        seg.get('position_end'),
                        seg.get('label'),
                        seg.get('display_order')
                    ))

    
    def build_closure_table(self):
        """Build closure table (node_paths) for all nodes."""
        print("🔗 Building closure table...")
        
        # Clear existing paths
        self.cursor.execute('DELETE FROM node_paths')
        
        # Get all nodes
        self.cursor.execute('SELECT id, parent_id FROM nodes ORDER BY level')
        nodes = self.cursor.fetchall()
        
        total_nodes = len(nodes)
        paths_created = 0
        
        for idx, (node_id, parent_id) in enumerate(nodes):
            if idx % 100 == 0:
                print(f"  Processing node {idx}/{total_nodes}...", end='\r')
            
            # Insert self-reference (depth=0)
            self.cursor.execute('''
                INSERT INTO node_paths (ancestor_id, descendant_id, depth)
                VALUES (?, ?, 0)
            ''', (node_id, node_id))
            paths_created += 1
            
            # Insert paths through parent
            if parent_id is not None:
                self.cursor.execute('''
                    INSERT INTO node_paths (ancestor_id, descendant_id, depth)
                    SELECT ancestor_id, ?, depth + 1
                    FROM node_paths
                    WHERE descendant_id = ?
                ''', (node_id, parent_id))
                paths_created += self.cursor.rowcount
        
        self.conn.commit()
        self.stats['paths_created'] = paths_created
        
        print(f"\n✅ Created {paths_created:,} paths for {total_nodes:,} nodes")
        print(f"   Average: {paths_created/total_nodes:.1f} paths per node")
    
    def print_statistics(self):
        """Print import statistics."""
        print("\n" + "="*60)
        print("📊 IMPORT STATISTICS")
        print("="*60)
        print(f"Total nodes imported:       {self.stats['nodes_imported']:,}")
        print(f"  - Product families:       {self.stats['product_families']:,}")
        print(f"  - Pattern containers:     {self.stats['pattern_containers']:,}")
        print(f"  - Code nodes:             {self.stats['code_nodes']:,}")
        print(f"  - Leaf products:          {self.stats['leaf_products']:,}")
        print(f"  - Intermediate products:  {self.stats['intermediate_products']:,}")
        
        if self.stats['dates_imported'] > 0:
            print(f"Date records imported:      {self.stats['dates_imported']:,}")
        
        if self.stats['paths_created'] > 0:
            print(f"Closure paths created:      {self.stats['paths_created']:,}")
        
        print("="*60)
    
    def verify_import(self):
        """Verify the import with some basic checks."""
        print("\n🔍 Verifying import...")
        
        # Check 1: Count nodes
        self.cursor.execute('SELECT COUNT(*) FROM nodes')
        node_count = self.cursor.fetchone()[0]
        print(f"✅ Nodes in database: {node_count:,}")
        
        # Check 2: Check levels
        self.cursor.execute('SELECT MIN(level), MAX(level) FROM nodes')
        min_level, max_level = self.cursor.fetchone()
        print(f"✅ Level range: {min_level} to {max_level}")
        
        # Check 3: Check product families
        self.cursor.execute('SELECT COUNT(*) FROM nodes WHERE parent_id IS NULL')
        family_count = self.cursor.fetchone()[0]
        print(f"✅ Product families: {family_count}")
        
        # Check 4: Check pattern containers
        self.cursor.execute('SELECT COUNT(*) FROM nodes WHERE pattern IS NOT NULL')
        pattern_count = self.cursor.fetchone()[0]
        print(f"✅ Pattern containers: {pattern_count}")
        
        # Check 5: Check products
        self.cursor.execute('SELECT COUNT(*) FROM nodes WHERE full_typecode IS NOT NULL')
        product_count = self.cursor.fetchone()[0]
        print(f"✅ Final products: {product_count}")
        
        # Check 6: Sample product family
        self.cursor.execute('''
            SELECT code, label, level
            FROM nodes
            WHERE parent_id IS NULL
            LIMIT 1
        ''')
        sample = self.cursor.fetchone()
        if sample:
            print(f"✅ Sample product family: {sample[0]} - {sample[1]} (level {sample[2]})")
        
        # Check 7: Closure table (if exists)
        try:
            self.cursor.execute('SELECT COUNT(*) FROM node_paths')
            path_count = self.cursor.fetchone()[0]
            if path_count > 0:
                print(f"✅ Closure table paths: {path_count:,}")
        except Exception:
            print("ℹ️  Closure table not built")
        
        print("✅ Import verification complete!")
    
    def close(self):
        """Close database connection."""
        if self.conn:
            self.conn.close()
            print("\n✅ Database connection closed")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description='Import product variant tree from JSON to SQLite or PostgreSQL'
    )
    parser.add_argument(
        '--json',
        required=True,
        help='Path to JSON file (e.g., variantenbaum.json)'
    )
    parser.add_argument(
        '--db',
        default='products.db',
        help='Database path (SQLite file) or connection string (PostgreSQL: postgresql://user:pass@host/db)'
    )
    parser.add_argument(
        '--schema',
        default='schema.sql',
        help='Path to schema SQL file (default: schema.sql)'
    )
    parser.add_argument(
        '--closure',
        action='store_true',
        help='Build closure table for performance (recommended for 2M+ records)'
    )
    parser.add_argument(
        '--dates',
        action='store_true',
        help='Import date_info data'
    )
    parser.add_argument(
        '--recreate',
        action='store_true',
        help='Clear product data tables (preserves users table!)'
    )
    parser.add_argument(
        '--kmat-json',
        help='Optional: Path to KMAT references JSON file (e.g., kmat_references.json)'
    )
    parser.add_argument(
        '--kmat-user-id',
        type=int,
        default=1,
        help='Admin user ID for KMAT references created_by field (default: 1)'
    )
    parser.add_argument(
        '--subsegments-json',
        help='Optional: Path to sub-segment definitions JSON file (e.g., subsegments.json)'
    )
    
    args = parser.parse_args()
    
    # Create importer
    importer = VariantTreeImporter(args.db, args.schema)
    
    try:
        # Connect to database
        importer.connect()
        
        # If --recreate: Clear product tables but keep users
        if args.recreate:
            print("⚠️  Clearing product data (users table preserved)...")
            importer.cursor.execute("DROP TABLE IF EXISTS node_labels")
            importer.cursor.execute("DROP TABLE IF EXISTS nodes")
            importer.cursor.execute("DROP TABLE IF EXISTS node_paths")
            importer.cursor.execute("DROP TABLE IF EXISTS date_info")
            importer.cursor.execute("DROP TABLE IF EXISTS constraints")
            importer.cursor.execute("DROP TABLE IF EXISTS constraint_conditions")
            importer.cursor.execute("DROP TABLE IF EXISTS constraint_codes")
            # sqlite_sequence only exists if there are autoincrement tables, so check first
            result = importer.cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'").fetchone()
            if result:
                importer.cursor.execute("DELETE FROM sqlite_sequence WHERE name IN ('nodes', 'node_paths', 'date_info', 'constraints', 'constraint_conditions', 'constraint_codes', 'node_labels')")
            importer.conn.commit()
            print("✅ Product tables cleared, users preserved!")
        
        # Create schema (will skip users table if exists)
        db_is_new = not Path(args.db).exists()
        if db_is_new or args.recreate:
            importer.create_schema()
        
        # Import JSON data
        importer.import_json(args.json, include_dates=args.dates)
        
        # Build closure table if requested
        if args.closure:
            importer.build_closure_table()
        
        # Verify import
        importer.verify_import()
        
        # Print statistics
        importer.print_statistics()
        
        # Optional: Import KMAT References
        if hasattr(args, 'kmat_json') and args.kmat_json:
            print("\n" + "="*60)
            print("📋 Importiere KMAT Referenzen...")
            print("="*60)
            from import_kmat_references import import_kmat_references
            import_kmat_references(
                db_path=args.db, 
                json_path=args.kmat_json,
                admin_user_id=getattr(args, 'kmat_user_id', 1)
            )
        
        # Optional: Import Sub-Segment Definitions
        if hasattr(args, 'subsegments_json') and args.subsegments_json:
            print("\n" + "="*60)
            print("⚡ Importiere Sub-Segment-Definitionen...")
            print("="*60)
            from import_subsegments import import_subsegments
            import_subsegments(
                db_path=args.db,
                json_path=args.subsegments_json
            )
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        raise
    
    finally:
        # Close connection
        importer.close()
    
    print(f"\n🎉 Import complete! Database: {args.db}")


if __name__ == '__main__':
    main()
