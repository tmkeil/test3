#!/usr/bin/env python3
"""
Import KMAT References from JSON

Importiert KMAT Referenzen aus einem JSON-File in die Database.
Matcht die path_codes mit den entsprechenden Node IDs.

Usage:
    python import_kmat_references.py [--db variantenbaum.db] [--json kmat_references.json] [--user-id 1]
"""

import sqlite3
import json
import argparse
from pathlib import Path
from typing import List, Dict, Any, Optional


def import_kmat_references(
    db_path: str = "variantenbaum.db",
    json_path: str = "kmat_references.json",
    admin_user_id: int = 1
):
    """
    Importiert KMAT Referenzen aus JSON.
    
    Matcht path_codes mit Node IDs über die Codes und den Pfad durch den Baum.
    
    Args:
        db_path: Pfad zur Database
        json_path: Pfad zum KMAT JSON File
        admin_user_id: User ID des Admins für created_by (default: 1)
    """
    print(f"📦 Lade KMAT Referenzen aus: {json_path}")
    
    if not Path(json_path).exists():
        raise FileNotFoundError(f"JSON file nicht gefunden: {json_path}")
    
    with open(json_path, 'r', encoding='utf-8') as f:
        kmat_data = json.load(f)
    
    if not kmat_data:
        print("ℹ️  Keine KMAT Referenzen zum Importieren")
        return
    
    print(f"   Gefunden: {len(kmat_data)} KMAT Referenzen")
    
    # Verbinde mit Database
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    try:
        # Prüfe ob kmat_references Tabelle existiert
        cursor.execute("""
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='kmat_references'
        """)
        
        if not cursor.fetchone():
            print("❌ Fehler: Tabelle 'kmat_references' existiert nicht in der Database")
            print("   Führe erst die Migration aus: database/migrations/003_add_kmat_references.sql")
            return
        
        imported_count = 0
        skipped_count = 0
        error_count = 0
        
        for entry in kmat_data:
            try:
                family_code = entry['family_code']
                path_codes = entry['path_codes']
                full_typecode = entry['full_typecode']
                kmat_reference = entry['kmat_reference']
                
                # 1. Finde Family Node
                cursor.execute("""
                    SELECT id FROM nodes 
                    WHERE code = ? AND parent_id IS NULL
                """, (family_code,))
                
                family_row = cursor.fetchone()
                if not family_row:
                    print(f"⚠️  Überspringe: Familie '{family_code}' nicht gefunden")
                    skipped_count += 1
                    continue
                
                family_id = family_row['id']
                
                # 2. Finde alle Nodes im Pfad
                path_node_ids = [family_id]  # Start mit Family
                current_parent_id = family_id
                
                # Gehe durch path_codes (ohne Family, die haben wir schon)
                for code in path_codes[1:]:  # Skip ersten Code (Family)
                    cursor.execute("""
                        SELECT id FROM nodes
                        WHERE code = ? AND parent_id = ?
                    """, (code, current_parent_id))
                    
                    node = cursor.fetchone()
                    if not node:
                        print(f"⚠️  Überspringe: Node '{code}' nicht gefunden (Parent: {current_parent_id})")
                        skipped_count += 1
                        break
                    
                    path_node_ids.append(node['id'])
                    current_parent_id = node['id']
                else:
                    # Alle Nodes gefunden!
                    path_json = json.dumps(path_node_ids)
                    
                    # 3. Prüfe ob bereits vorhanden
                    cursor.execute("""
                        SELECT id FROM kmat_references
                        WHERE family_id = ? AND path_node_ids = ?
                    """, (family_id, path_json))
                    
                    existing = cursor.fetchone()
                    
                    if existing:
                        # Update existing
                        cursor.execute("""
                            UPDATE kmat_references
                            SET kmat_reference = ?,
                                full_typecode = ?,
                                updated_at = CURRENT_TIMESTAMP
                            WHERE id = ?
                        """, (kmat_reference, full_typecode, existing['id']))
                        print(f"   ✏️  Aktualisiert: {full_typecode} → {kmat_reference}")
                    else:
                        # Insert new
                        cursor.execute("""
                            INSERT INTO kmat_references (
                                family_id, path_node_ids, full_typecode,
                                kmat_reference, created_by
                            ) VALUES (?, ?, ?, ?, ?)
                        """, (family_id, path_json, full_typecode, kmat_reference, admin_user_id))
                        print(f"   ➕ Importiert: {full_typecode} → {kmat_reference}")
                    
                    imported_count += 1
                    
            except Exception as e:
                print(f"❌ Fehler bei Entry: {entry.get('full_typecode', 'unknown')}")
                print(f"   {str(e)}")
                error_count += 1
        
        # Commit
        conn.commit()
        
        print(f"\n✅ Import abgeschlossen!")
        print(f"   Importiert/Aktualisiert: {imported_count}")
        print(f"   Übersprungen: {skipped_count}")
        print(f"   Fehler: {error_count}")
        
    finally:
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Import KMAT References from JSON')
    parser.add_argument('--db', default='variantenbaum.db', help='Database file path')
    parser.add_argument('--json', default='kmat_references.json', help='Input JSON file path')
    parser.add_argument('--user-id', type=int, default=1, help='Admin user ID for created_by field')
    
    args = parser.parse_args()
    
    import_kmat_references(db_path=args.db, json_path=args.json, admin_user_id=args.user_id)
