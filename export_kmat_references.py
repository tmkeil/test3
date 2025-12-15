#!/usr/bin/env python3
"""
Export KMAT References to JSON

Exportiert alle KMAT Referenzen aus der Datenbank in ein separates JSON-File.
Kann dann mit import_kmat_references.py wieder importiert werden.

Usage:
    python export_kmat_references.py [--db variantenbaum.db] [--output kmat_references.json]
"""

import sqlite3
import json
import argparse
from pathlib import Path
from typing import List, Dict, Any


def export_kmat_references(db_path: str = "variantenbaum.db", output_file: str = "kmat_references.json"):
    """
    Exportiert alle KMAT Referenzen aus der Database.
    
    Format:
    [
        {
            "family_code": "A",
            "path_codes": ["A", "01", "ABC"],
            "full_typecode": "A-01-ABC",
            "kmat_reference": "KMAT-12345",
            "created_at": "2025-12-15 10:30:00"
        },
        ...
    ]
    """
    print(f"📖 Lese KMAT Referenzen aus: {db_path}")
    
    if not Path(db_path).exists():
        raise FileNotFoundError(f"Database nicht gefunden: {db_path}")
    
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
            print("⚠️  Tabelle 'kmat_references' existiert nicht in der Database")
            print("   Erstelle leere KMAT Datei...")
            kmat_data = []
        else:
            # Hole alle KMAT Referenzen mit Node Codes
            cursor.execute("""
                SELECT 
                    k.id,
                    k.family_id,
                    k.path_node_ids,
                    k.full_typecode,
                    k.kmat_reference,
                    k.created_at,
                    k.updated_at,
                    f.code as family_code
                FROM kmat_references k
                JOIN nodes f ON k.family_id = f.id
                ORDER BY k.family_id, k.full_typecode
            """)
            
            rows = cursor.fetchall()
            
            if not rows:
                print("ℹ️  Keine KMAT Referenzen in der Database gefunden")
                kmat_data = []
            else:
                print(f"   Gefunden: {len(rows)} KMAT Referenzen")
                
                kmat_data = []
                for row in rows:
                    # Parse path_node_ids JSON
                    try:
                        path_node_ids = json.loads(row['path_node_ids'])
                    except (json.JSONDecodeError, TypeError):
                        print(f"⚠️  Warnung: Ungültige path_node_ids für ID {row['id']}")
                        continue
                    
                    # Hole Codes für alle Nodes im Pfad
                    path_codes = []
                    for node_id in path_node_ids:
                        cursor.execute("SELECT code FROM nodes WHERE id = ?", (node_id,))
                        node = cursor.fetchone()
                        if node and node['code']:
                            path_codes.append(node['code'])
                    
                    # Erstelle KMAT Entry
                    entry = {
                        'family_code': row['family_code'],
                        'path_codes': path_codes,
                        'full_typecode': row['full_typecode'],
                        'kmat_reference': row['kmat_reference'],
                        'created_at': row['created_at'],
                        'updated_at': row['updated_at']
                    }
                    
                    kmat_data.append(entry)
        
        # Schreibe JSON
        print(f"💾 Schreibe KMAT Referenzen: {output_file}")
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(kmat_data, f, indent=2, ensure_ascii=False)
        
        print(f"✅ Erfolgreich! {len(kmat_data)} KMAT Referenzen exportiert")
        print(f"   Output: {output_file}")
        
    finally:
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Export KMAT References to JSON')
    parser.add_argument('--db', default='variantenbaum.db', help='Database file path')
    parser.add_argument('--output', default='kmat_references.json', help='Output JSON file path')
    
    args = parser.parse_args()
    
    export_kmat_references(db_path=args.db, output_file=args.output)
