#!/usr/bin/env python3
"""
Safe Database Merge Tool
========================

Sicheres Mergen neuer Produktdaten in bestehende Datenbank.

Problem:
- Neue Produktschlüssel müssen eingefügt werden
- Können unter bestehenden Produktfamilien oder Varianten anknüpfen
- Closure Table muss neu aufgebaut werden
- Bestehende Daten (Bilder, Links, Labels) dürfen NICHT verloren gehen

Lösung:
1. Export der aktuellen DB zu JSON (mit allen Daten)
2. Merge mit neuen Produktschlüsseln aus neuem JSON
3. Backup der alten DB
4. Neu-Import in saubere DB (mit Closure Table Rebuild)

Usage:
    # Basic merge
    python merge_data.py --current-db variantenbaum.db --new-json neue_produkte.json
    
    # Mit custom output
    python merge_data.py --current-db variantenbaum.db --new-json neue_produkte.json --output merged.db
    
    # Dry-run (nur zeigen, keine Änderungen)
    python merge_data.py --current-db variantenbaum.db --new-json neue_produkte.json --dry-run
"""

import sqlite3
import json
import argparse
import shutil
from pathlib import Path
from typing import Dict, List, Any, Optional, Set, Tuple
from datetime import datetime
from collections import OrderedDict

# Import existing scripts
from export_to_json import export_database_to_json
from import_data import VariantTreeImporter


class SafeDatabaseMerger:
    """Safely merges new product data into existing database."""
    
    def __init__(self, current_db: str, new_json: str, output_db: Optional[str] = None, new_kmat_json: Optional[str] = None):
        self.current_db = Path(current_db)
        self.new_json = Path(new_json)
        self.new_kmat_json = Path(new_kmat_json) if new_kmat_json else None
        self.output_db = Path(output_db) if output_db else self.current_db.with_name(
            self.current_db.stem + "_merged.db"
        )
        
        self.temp_export = Path("temp_export.json")
        self.merged_json = Path("merged.json")
        self.backup_db = None
        
        # Statistics
        self.stats = {
            'existing_nodes': 0,
            'new_nodes': 0,
            'merged_nodes': 0,
            'conflicts': 0,
            'preserved_data': {
                'pictures': 0,
                'links': 0,
                'labels': 0
            }
        }
    
    def merge(self, dry_run: bool = False):
        """
        Main merge workflow.
        
        Steps:
        1. Export current DB to JSON
        2. Load new JSON
        3. Merge JSONs (preserve existing data)
        4. Backup current DB
        5. Import merged JSON to new DB
        6. Rebuild Closure Table
        """
        print("=" * 80)
        print("🔧 SAFE DATABASE MERGE TOOL")
        print("=" * 80)
        print(f"Current DB:  {self.current_db}")
        print(f"New JSON:    {self.new_json}")
        print(f"Output DB:   {self.output_db}")
        print(f"Mode:        {'DRY-RUN (no changes)' if dry_run else 'LIVE'}")
        print("=" * 80)
        
        # Step 1: Export current database
        print("\n📤 Step 1: Exporting current database...")
        self._export_current_db()
        
        # Step 2: Load JSONs
        print("\n📥 Step 2: Loading JSON files...")
        existing_data = self._load_json(self.temp_export)
        new_data = self._load_json(self.new_json)
        
        # Step 3: Merge
        print("\n🔀 Step 3: Merging data...")
        merged_data = self._merge_json_trees(existing_data, new_data)
        
        # Step 4: Save merged JSON
        print(f"\n💾 Step 4: Saving merged JSON to {self.merged_json}...")
        self._save_merged_json(merged_data)
        
        if dry_run:
            print("\n⚠️  DRY-RUN MODE - No database changes made")
            print(f"\n✅ Merged JSON saved to: {self.merged_json}")
            print("   Review the merged data, then run without --dry-run to apply changes")
            self._print_statistics()
            return
        
        # Step 5: Backup current DB
        print("\n💾 Step 5: Creating backup of current database...")
        self._backup_database()
        
        # Step 6: Import merged data
        print("\n📥 Step 6: Importing merged data to new database...")
        self._import_merged_data()
        
        # Step 7: Cleanup
        print("\n🧹 Step 7: Cleaning up temporary files...")
        self._cleanup()
        
        print("\n" + "=" * 80)
        print("✅ MERGE COMPLETED SUCCESSFULLY!")
        print("=" * 80)
        self._print_statistics()
        print(f"\n📁 New database: {self.output_db}")
        print(f"📁 Backup of old database: {self.backup_db}")
        print(f"📁 Merged JSON: {self.merged_json}")
        print("\n⚠️  IMPORTANT: Test the new database before deleting the backup!")
    
    def _export_current_db(self):
        """Export current database to JSON."""
        if not self.current_db.exists():
            raise FileNotFoundError(f"Database not found: {self.current_db}")
        
        # Use existing export_to_json.py
        export_database_to_json(str(self.current_db), str(self.temp_export))
        
        # Count existing nodes
        with open(self.temp_export, 'r', encoding='utf-8') as f:
            data = json.load(f)
            self.stats['existing_nodes'] = self._count_nodes(data)
        
        # Export KMAT references (if table exists)
        try:
            from export_kmat_references import export_kmat_references
            kmat_file = self.temp_export.parent / "temp_kmat_export.json"
            export_kmat_references(str(self.current_db), str(kmat_file))
            self.temp_kmat_export = kmat_file
        except Exception as e:
            print(f"   ℹ️  No KMAT references to export (or table doesn't exist)")
            self.temp_kmat_export = None
        
        print(f"✅ Exported {self.stats['existing_nodes']} nodes from current database")
    
    def _load_json(self, path: Path) -> Dict:
        """Load JSON file."""
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    
    def _count_nodes(self, data: Any) -> int:
        """Recursively count nodes in JSON tree."""
        count = 0
        
        if isinstance(data, dict):
            if 'children' in data:
                count += 1
                for child in data.get('children', []):
                    count += self._count_nodes(child)
        elif isinstance(data, list):
            for item in data:
                count += self._count_nodes(item)
        
        return count
    
    def _merge_json_trees(self, existing: Dict, new: Dict) -> Dict:
        """
        Merge two JSON trees intelligently.
        
        Strategy:
        - Match nodes by 'code' (for code nodes) or 'pattern' (for pattern containers)
        - If node exists in both: Keep existing data (pictures, links, labels), merge children
        - If node only in new: Add it
        - If node only in existing: Keep it
        
        Returns:
            Merged tree
        """
        # Normalize input (handle both {"children": [...]} and [...] formats)
        existing_families = self._normalize_input(existing)
        new_families = self._normalize_input(new)
        
        # Merge product families
        merged_families = self._merge_node_lists(existing_families, new_families)
        
        # Return in standard format with root code
        from collections import OrderedDict
        result = OrderedDict()
        result['children'] = merged_families
        result['code'] = 'root'
        return result
    
    def _normalize_input(self, data: Any) -> List[Dict]:
        """Normalize JSON input to list of product families."""
        if isinstance(data, dict) and 'children' in data:
            return data['children']
        elif isinstance(data, list):
            return data
        else:
            raise ValueError("Unexpected JSON format")
    
    def _merge_node_lists(self, existing: List[Dict], new: List[Dict]) -> List[Dict]:
        """
        Merge two lists of nodes.
        
        Returns:
            Merged list
        """
        # Build lookup by identifier (code or pattern)
        existing_map = {}
        for node in existing:
            identifier = self._get_node_identifier(node)
            existing_map[identifier] = node
        
        new_map = {}
        for node in new:
            identifier = self._get_node_identifier(node)
            new_map[identifier] = node
        
        # Merge
        merged = []
        all_identifiers = set(existing_map.keys()) | set(new_map.keys())
        
        for identifier in sorted(all_identifiers):
            if identifier in existing_map and identifier in new_map:
                # Node exists in both -> merge
                merged_node = self._merge_single_node(
                    existing_map[identifier],
                    new_map[identifier]
                )
                merged.append(merged_node)
                self.stats['merged_nodes'] += 1
            elif identifier in existing_map:
                # Only in existing -> keep
                merged.append(existing_map[identifier])
            else:
                # Only in new -> add
                merged.append(new_map[identifier])
                self.stats['new_nodes'] += 1
        
        return merged
    
    def _get_node_identifier(self, node: Dict) -> str:
        """
        Get unique identifier for a node.
        
        - For code nodes: use 'code'
        - For pattern containers: use 'pattern:position'
        """
        if 'code' in node and node['code']:
            return f"code:{node['code']}"
        elif 'pattern' in node:
            position = node.get('position', 0)
            return f"pattern:{node['pattern']}:{position}"
        else:
            # Fallback: use name or generate unique ID
            return f"unnamed:{node.get('name', 'unknown')}:{id(node)}"
    
    def _merge_single_node(self, existing: Dict, new: Dict) -> Dict:
        """
        Merge a single node (existing + new).
        
        Strategy:
        - Preserve ALL data from existing (pictures, links, labels, etc.)
        - Only add NEW children from new node
        - Warn about conflicts
        """
        from collections import OrderedDict
        
        merged = OrderedDict()
        
        # Children first (recursively merge)
        existing_children = existing.get('children', [])
        new_children = new.get('children', [])
        merged['children'] = self._merge_node_lists(existing_children, new_children)
        
        # Copy ALL fields from existing (priority!)
        for key, value in existing.items():
            if key != 'children':  # Already handled
                merged[key] = value
        
        # Add fields from new that don't exist in existing
        for key, value in new.items():
            if key not in merged and key != 'children':
                merged[key] = value
        
        # Track preserved data
        if 'pictures' in existing and existing['pictures']:
            self.stats['preserved_data']['pictures'] += 1
        if 'links' in existing and existing['links']:
            self.stats['preserved_data']['links'] += 1
        if 'label' in existing and existing['label']:
            self.stats['preserved_data']['labels'] += 1
        
        # Detect conflicts (different values for same field)
        conflicts = []
        for key in set(existing.keys()) & set(new.keys()):
            if key in ['children', 'pictures', 'links']:
                continue  # Skip these
            if existing[key] != new[key]:
                conflicts.append(key)
        
        if conflicts:
            identifier = self._get_node_identifier(existing)
            print(f"  ⚠️  Conflict in node '{identifier}': {conflicts}")
            print(f"      Using existing value (new value ignored)")
            self.stats['conflicts'] += 1
        
        return merged
    
    def _save_merged_json(self, data: Dict):
        """Save merged JSON to file."""
        with open(self.merged_json, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        
        print(f"✅ Merged JSON saved to: {self.merged_json}")
    
    def _backup_database(self):
        """Create backup of current database."""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.backup_db = self.current_db.with_name(
            f"{self.current_db.stem}_backup_{timestamp}.db"
        )
        
        shutil.copy2(self.current_db, self.backup_db)
        print(f"✅ Backup created: {self.backup_db}")
    
    def _import_merged_data(self):
        """Import merged JSON into new database."""
        # Delete output DB if exists
        if self.output_db.exists():
            self.output_db.unlink()
        
        # Use existing import_data.py
        importer = VariantTreeImporter(
            db_path=str(self.output_db),
            schema_path="schema.sql"
        )
        
        importer.connect()
        importer.create_schema()
        importer.import_json(str(self.merged_json), include_dates=False)
        importer.build_closure_table()
        importer.close()
        
        print(f"✅ Imported merged data to: {self.output_db}")
        
        # Import KMAT references (merge old + new if provided)
        kmat_files_to_import = []
        
        # Old KMAT from current DB
        if hasattr(self, 'temp_kmat_export') and self.temp_kmat_export and self.temp_kmat_export.exists():
            kmat_files_to_import.append(('existing', self.temp_kmat_export))
        
        # New KMAT from user input
        if self.new_kmat_json and self.new_kmat_json.exists():
            kmat_files_to_import.append(('new', self.new_kmat_json))
        
        if kmat_files_to_import:
            print("   📋 Importing KMAT references...")
            try:
                from import_kmat_references import import_kmat_references
                for source, kmat_file in kmat_files_to_import:
                    print(f"      • From {source} data: {kmat_file.name}")
                    import_kmat_references(
                        db_path=str(self.output_db),
                        json_path=str(kmat_file),
                        admin_user_id=1
                    )
            except Exception as e:
                print(f"   ⚠️  KMAT import failed: {e}")
    
    def _cleanup(self):
        """Clean up temporary files."""
        if self.temp_export.exists():
            self.temp_export.unlink()
        
        # Clean up KMAT export if exists
        if hasattr(self, 'temp_kmat_export') and self.temp_kmat_export and self.temp_kmat_export.exists():
            self.temp_kmat_export.unlink()
        
        print("✅ Temporary files cleaned up")
    
    def _print_statistics(self):
        """Print merge statistics."""
        print("\n📊 MERGE STATISTICS:")
        print(f"   Existing nodes:     {self.stats['existing_nodes']}")
        print(f"   New nodes added:    {self.stats['new_nodes']}")
        print(f"   Merged nodes:       {self.stats['merged_nodes']}")
        print(f"   Conflicts resolved: {self.stats['conflicts']}")
        print(f"\n   Preserved data:")
        print(f"      Pictures:  {self.stats['preserved_data']['pictures']} nodes")
        print(f"      Links:     {self.stats['preserved_data']['links']} nodes")
        print(f"      Labels:    {self.stats['preserved_data']['labels']} nodes")


def main():
    parser = argparse.ArgumentParser(
        description="Safely merge new product data into existing database",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Basic merge (KMAT from current DB preserved)
  python merge_data.py --current-db variantenbaum.db --new-json neue_produkte.json
  
  # Merge with new KMAT references
  python merge_data.py --current-db variantenbaum.db --new-json neue_produkte.json --new-kmat-json neue_kmat.json
  
  # With custom output
  python merge_data.py --current-db variantenbaum.db --new-json neue_produkte.json --output merged.db
  
  # Dry-run (preview changes)
  python merge_data.py --current-db variantenbaum.db --new-json neue_produkte.json --dry-run
        """
    )
    
    parser.add_argument(
        '--current-db',
        required=True,
        help='Path to current SQLite database'
    )
    
    parser.add_argument(
        '--new-json',
        required=True,
        help='Path to JSON file with new product data'
    )
    
    parser.add_argument(
        '--output',
        help='Path for output database (default: <current>_merged.db)'
    )
    
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Preview changes without modifying database'
    )
    
    parser.add_argument(
        '--new-kmat-json',
        help='Optional: Path to JSON file with new KMAT references to merge'
    )
    
    args = parser.parse_args()
    
    # Run merge
    merger = SafeDatabaseMerger(
        current_db=args.current_db,
        new_json=args.new_json,
        output_db=args.output,
        new_kmat_json=args.new_kmat_json
    )
    
    merger.merge(dry_run=args.dry_run)


if __name__ == '__main__':
    main()
