#!/usr/bin/env python3
"""
Label Parser Module
Parses structured labels from baum.json format and extracts code segments.

Supports various label formats:
- "Title: CODE = Description"
- "Title: Description without code"
- "CODE = Description" (no title)
- Multi-line blocks separated by double newlines
"""

import re
from typing import List, Dict, Optional


def parse_structured_label(label_text: str, full_code: Optional[str] = None) -> List[Dict]:
    """
    Parse labels with various formats into structured data.
    
    Args:
        label_text: The label string from baum.json
        full_code: The complete node code (e.g., "PSIC20B") for position calculation
    
    Returns:
        List of dicts with keys: title, code_segment, label, position_start, position_end, display_order
    
    Examples:
        >>> parse_structured_label("Spannung: P = 10-30V DC\\nS = Schließer", "PSIC20B")
        [
            {'title': 'Spannung', 'code_segment': 'P', 'label': '10-30V DC', 
             'position_start': 1, 'position_end': 1, 'display_order': 0},
            {'title': 'Spannung', 'code_segment': 'S', 'label': 'Schließer',
             'position_start': 2, 'position_end': 2, 'display_order': 1}
        ]
        
        >>> parse_structured_label("Hinweis: Nur für Industrieanwendungen")
        [
            {'title': 'Hinweis', 'code_segment': None, 'label': 'Nur für Industrieanwendungen',
             'position_start': None, 'position_end': None, 'display_order': 0}
        ]
    """
    if not label_text:
        return []
    
    results = []
    display_order = 0
    current_title = None
    
    # Split by double newlines (separates title blocks)
    blocks = label_text.split('\n\n')
    
    for block in blocks:
        lines = [line.strip() for line in block.split('\n') if line.strip()]
        if not lines:
            continue
        
        # Track whether we've already found a code_segment in this block
        found_code_segment_in_block = False
        
        # Analyze first line
        first_line = lines[0]
        
        # Check for "Title: ..." format
        title_match = re.match(r'^([^:]+):\s*(.*)$', first_line)
        
        if title_match:
            # It's a title
            current_title = title_match.group(1).strip()
            first_content = title_match.group(2).strip()
            
            # Parse first content (if present)
            if first_content:
                segment = parse_content_line(first_content, full_code, allow_code_segment=True)
                segment['title'] = current_title
                segment['display_order'] = display_order
                results.append(segment)
                display_order += 1
                
                # Mark if this line had a code_segment
                if segment.get('code_segment'):
                    found_code_segment_in_block = True
            
            # Parse remaining lines in this block
            remaining_lines = lines[1:]
        else:
            # No title, all lines are content
            remaining_lines = lines
        
        # Parse all content lines (without code_segment extraction if already found)
        for line in remaining_lines:
            if line:
                # Only allow code_segment on first occurrence in block
                allow_code = not found_code_segment_in_block
                segment = parse_content_line(line, full_code, allow_code_segment=allow_code)
                segment['title'] = current_title
                segment['display_order'] = display_order
                results.append(segment)
                display_order += 1
                
                # Mark if we found a code_segment
                if segment.get('code_segment'):
                    found_code_segment_in_block = True
    
    return results


def parse_content_line(line: str, full_code: Optional[str] = None, allow_code_segment: bool = True) -> Dict:
    """
    Parse a single content line.
    
    Recognizes:
    - "CODE = TEXT" → extracts code_segment + label (only if allow_code_segment=True)
    - "just text"  → only label
    
    Also calculates position_start/position_end if full_code is provided.
    
    Args:
        line: Single line of text
        full_code: Complete node code for position calculation
        allow_code_segment: Whether to extract code_segment (False for subsequent lines in same block)
    
    Returns:
        Dict with keys: code_segment, label, position_start, position_end
    """
    # Pattern: "CODE = TEXT"
    # CODE can be letters, numbers (case-insensitive)
    code_match = re.match(r'^([A-Z0-9]+)\s*=\s*(.+)$', line, re.IGNORECASE)
    
    if code_match and allow_code_segment:
        code_seg = code_match.group(1)
        label_text = code_match.group(2).strip()
        
        # Calculate position in full code
        pos_start, pos_end = None, None
        if full_code:
            # Find first occurrence of code_segment in full_code
            pos_start = full_code.find(code_seg)
            if pos_start != -1:
                pos_start += 1  # Convert to 1-based index
                pos_end = pos_start + len(code_seg) - 1
        
        return {
            'code_segment': code_seg,
            'label': label_text,
            'position_start': pos_start,
            'position_end': pos_end
        }
    else:
        # No code segment extraction (either no match or not allowed), just text
        # If there's a "X = Y" pattern but code extraction is disabled, keep whole line as label
        return {
            'code_segment': None,
            'label': line,
            'position_start': None,
            'position_end': None
        }


def reconstruct_label(labels: List[Dict]) -> str:
    """
    Reconstruct original label format from parsed label data.
    
    Used by export_to_json.py to convert back from node_labels table.
    
    Args:
        labels: List of label dicts (from node_labels table)
                Must have keys: title, code_segment, label_de (or label_en)
                Sorted by display_order
    
    Returns:
        Reconstructed label string in original format
    
    Example:
        >>> labels = [
        ...     {'title': 'Spannung', 'code_segment': 'P', 'label_de': '10-30V'},
        ...     {'title': 'Spannung', 'code_segment': 'S', 'label_de': 'Schließer'},
        ...     {'title': 'Hinweis', 'code_segment': None, 'label_de': 'Nur Industrie'}
        ... ]
        >>> reconstruct_label(labels)
        'Spannung: P = 10-30V\\nS = Schließer\\n\\nHinweis: Nur Industrie'
    """
    if not labels:
        return ""
    
    # Group by title
    from itertools import groupby
    
    blocks = []
    for title, group_iter in groupby(labels, key=lambda x: x.get('title')):
        items = list(group_iter)
        lines = []
        
        for i, item in enumerate(items):
            label_text = item.get('label_de') or item.get('label_en') or item.get('label', '')
            code_seg = item.get('code_segment')
            
            if code_seg:
                # Format: "CODE = Label"
                line = f"{code_seg} = {label_text}"
            else:
                # Format: "Label" (no code)
                line = label_text
            
            # First line: include title
            if i == 0 and title:
                lines.append(f"{title}: {line}")
            else:
                lines.append(line)
        
        blocks.append('\n'.join(lines))
    
    # Join blocks with double newline
    return '\n\n'.join(blocks)


if __name__ == '__main__':
    # Test cases
    print("Test 1: Standard format with codes")
    text1 = """Spannung: P = 10-30V DC
S = Schließer

Schaltabstand: 20 = 20mm

Hinweis: Nur für Industrieanwendungen"""
    
    result = parse_structured_label(text1, full_code="PSIC20B")
    for r in result:
        print(f"  {r}")
    
    print("\nTest 2: Reconstruct")
    reconstructed = reconstruct_label(result)
    print(f"  Original:\n{text1}")
    print(f"  Reconstructed:\n{reconstructed}")
    print(f"  Match: {text1 == reconstructed}")
