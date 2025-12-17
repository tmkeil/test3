#!/usr/bin/env python3
"""
Import Sub-Segment Definitions from JSON

Importiert Sub-Segment-Definitionen aus einem JSON-File in die Datenbank.

Usage:
    python import_subsegments.py [--db variantenbaum.db] [--json subsegments.json]
"""

import sqlite3
import json
import argparse
from pathlib import Path
from typing import List, Dict, Any


def import_subsegments(db_path: str = "variantenbaum.db", json_path: str = "subsegments.json"):
    """
    Importiert Sub-Segment-Definitionen aus JSON.
    
    Erwartet Format:
    [
        {
            "family_code": "BCC",
            "group_name": "Cordset",
            "level": 3,
            "pattern_string": "3-5-4-2",  // Optional, kann null sein
            "subsegments": [
                {"start": 0, "end": 1, "name": "range"},
                {"start": 1, "end": 3, "name": "connector size"}
            ],
            "created_by": 1,
            "created_at": "2025-12-17 10:30:00"
        },
        ...
    ]
    """
    print(f"📖 Lese Sub-Segment-Definitionen aus: {json_path}")
    
    if not Path(json_path).exists():
        raise FileNotFoundError(f"JSON File nicht gefunden: {json_path}")
    
    with open(json_path, 'r', encoding='utf-8') as f:
        subsegments_list = json.load(f)
    
    if not subsegments_list:
        print("ℹ️  Keine Sub-Segment-Definitionen im JSON File")
        return
    
    print(f"📦 {len(subsegments_list)} Sub-Segment-Definitionen gefunden")
    
    # Connect to database
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    try:
        # Prüfe ob Tabelle existiert
        cursor.execute("""
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='segment_subsegments'
        """)
        
        if not cursor.fetchone():
            raise Exception("Tabelle 'segment_subsegments' existiert nicht! Führe erst das Schema-Update aus.")
        
        # Lösche existierende Einträge (kompletter Reimport)
        cursor.execute("DELETE FROM segment_subsegments")
        deleted_count = cursor.rowcount
        if deleted_count > 0:
            print(f"🗑️  {deleted_count} alte Einträge gelöscht")
        
        # Importiere neue Einträge
        imported = 0
        skipped = 0
        
        for entry in subsegments_list:
            try:
                # Subsegments ist bereits ein Dictionary/Array, muss zu JSON String konvertiert werden
                subsegments_json = json.dumps(entry['subsegments'])
                
                cursor.execute("""
                    INSERT INTO segment_subsegments 
                    (family_code, group_name, level, pattern_string, subsegments, created_by, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    entry['family_code'],
                    entry['group_name'],
                    entry['level'],
                    entry.get('pattern_string'),  # Kann NULL sein
                    subsegments_json,
                    entry.get('created_by', 1),  # Default: Admin User ID 1
                    entry.get('created_at', 'CURRENT_TIMESTAMP'),
                    entry.get('updated_at', 'CURRENT_TIMESTAMP')
                ))
                imported += 1
                
            except sqlite3.IntegrityError as e:
                print(f"⚠️  Übersprungen (Duplikat): {entry['family_code']}/{entry['group_name']}/Level {entry['level']}")
                skipped += 1
            except Exception as e:
                print(f"❌ Fehler bei Eintrag: {entry}")
                print(f"   Error: {e}")
                skipped += 1
        
        conn.commit()
        
        print(f"✅ Import abgeschlossen!")
        print(f"   Importiert: {imported}")
        if skipped > 0:
            print(f"   Übersprungen: {skipped}")
        
        # Statistik
        cursor.execute("SELECT COUNT(*) as total FROM segment_subsegments")
        total = cursor.fetchone()['total']
        print(f"   Gesamt in DB: {total}")
        
    except Exception as e:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description='Import Sub-Segment Definitions from JSON'
    )
    
    parser.add_argument(
        '--db',
        type=str,
        default='variantenbaum.db',
        help='Path to SQLite database (default: variantenbaum.db)'
    )
    
    parser.add_argument(
        '--json',
        type=str,
        default='subsegments.json',
        help='Input JSON file (default: subsegments.json)'
    )
    
    args = parser.parse_args()
    
    try:
        import_subsegments(args.db, args.json)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        raise
