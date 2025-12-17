#!/usr/bin/env python3
"""
Export Sub-Segment Definitions to JSON

Exportiert alle Sub-Segment-Definitionen aus der Datenbank in ein separates JSON-File.
Kann dann mit import_subsegments.py wieder importiert werden.

Usage:
    python export_subsegments.py [--db variantenbaum.db] [--output subsegments.json]
"""

import sqlite3
import json
import argparse
from pathlib import Path
from typing import List, Dict, Any


def export_subsegments(db_path: str = "variantenbaum.db", output_file: str = "subsegments.json"):
    """
    Exportiert alle Sub-Segment-Definitionen aus der Database.
    
    Format:
    [
        {
            "family_code": "BCC",
            "group_name": "Cordset",
            "level": 3,
            "pattern_string": "3-5-4-2",
            "subsegments": [
                {"start": 0, "end": 1, "name": "range"},
                {"start": 1, "end": 3, "name": "connector size"},
                {"start": 3, "end": 4, "name": "poles"}
            ],
            "created_by": 1,
            "created_at": "2025-12-17 10:30:00"
        },
        ...
    ]
    """
    print(f"📖 Lese Sub-Segment-Definitionen aus: {db_path}")
    
    if not Path(db_path).exists():
        raise FileNotFoundError(f"Database nicht gefunden: {db_path}")
    
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    try:
        # Prüfe ob segment_subsegments Tabelle existiert
        cursor.execute("""
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='segment_subsegments'
        """)
        
        if not cursor.fetchone():
            print("⚠️  Tabelle 'segment_subsegments' existiert nicht in der Database!")
            print("   Erstelle leeres JSON File...")
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump([], f, indent=2, ensure_ascii=False)
            print(f"✅ Leeres File erstellt: {output_file}")
            return
        
        # Hole alle Sub-Segment-Definitionen
        cursor.execute("""
            SELECT 
                family_code,
                group_name,
                level,
                pattern_string,
                subsegments,
                created_by,
                created_at,
                updated_at
            FROM segment_subsegments
            ORDER BY family_code, group_name, level, pattern_string
        """)
        
        rows = cursor.fetchall()
        
        if not rows:
            print("ℹ️  Keine Sub-Segment-Definitionen gefunden")
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump([], f, indent=2, ensure_ascii=False)
            print(f"✅ Leeres File erstellt: {output_file}")
            return
        
        # Konvertiere zu JSON-Format
        subsegments_list = []
        for row in rows:
            # subsegments ist bereits JSON, muss geparst werden
            subsegments_data = json.loads(row['subsegments'])
            
            subsegments_list.append({
                'family_code': row['family_code'],
                'group_name': row['group_name'],
                'level': row['level'],
                'pattern_string': row['pattern_string'],  # Kann NULL sein
                'subsegments': subsegments_data,
                'created_by': row['created_by'],
                'created_at': row['created_at'],
                'updated_at': row['updated_at']
            })
        
        # Schreibe JSON File
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(subsegments_list, f, indent=2, ensure_ascii=False)
        
        print(f"✅ {len(subsegments_list)} Sub-Segment-Definitionen exportiert nach: {output_file}")
        
        # Statistik
        families = set(s['family_code'] for s in subsegments_list)
        groups = set((s['family_code'], s['group_name']) for s in subsegments_list)
        
        print(f"   Produktfamilien: {len(families)}")
        print(f"   Gruppen: {len(groups)}")
        
    finally:
        conn.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description='Export Sub-Segment Definitions to JSON'
    )
    
    parser.add_argument(
        '--db',
        type=str,
        default='variantenbaum.db',
        help='Path to SQLite database (default: variantenbaum.db)'
    )
    
    parser.add_argument(
        '--output',
        type=str,
        default='subsegments.json',
        help='Output JSON file (default: subsegments.json)'
    )
    
    args = parser.parse_args()
    
    try:
        export_subsegments(args.db, args.output)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        raise
