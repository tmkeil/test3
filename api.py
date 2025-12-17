"""
FastAPI Backend für Variantenbaum Produktkonfigurator

Ersetzt die 730 Zeilen komplexe Tree-Traversal Logik in variantenbaum.ts
mit einfachen SQL Queries gegen die Closure Table.

Keine Rekursion mehr! Closure Table hat alle Pfade vorberechnet.
"""

import sys
import io

# UTF-8 Encoding für Windows Console erzwingen
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import sqlite3
from typing import List, Optional, Dict
from pathlib import Path
import re
import shutil
from datetime import datetime, timedelta
import os
import json
from dotenv import load_dotenv

# Azure Blob Storage (conditional import - funktioniert lokal ohne Installation)
try:
    from azure.storage.blob import BlobServiceClient
    AZURE_AVAILABLE = True
except ImportError:
    AZURE_AVAILABLE = False

# Load Environment Variables
load_dotenv(Path(__file__).parent.parent / ".env")

# Import Auth Module
from auth import (
    User, UserInDB, Token, LoginRequest, ChangePasswordRequest,
    verify_password, get_password_hash, create_access_token,
    get_current_user, get_current_active_user, require_admin,
    TokenData
)

# ============================================================
# Konfiguration
# ============================================================

# Pfade - müssen vor Helper Functions definiert werden
# Nutze Umgebungsvariablen falls gesetzt (für Electron), sonst Default
UPLOADS_DIR = Path(os.getenv("UPLOADS_DIR", Path(__file__).parent / "uploads"))
UPLOADS_DIR.mkdir(exist_ok=True, parents=True)

DB_PATH = Path(os.getenv("DB_PATH", Path(__file__).parent / "variantenbaum.db"))
print(f"[CONFIG] Using DB: {DB_PATH}")

# Azure Blob Storage Initialization (conditional)
blob_service: Optional[BlobServiceClient] = None
if AZURE_AVAILABLE and os.getenv("AZURE_STORAGE_CONNECTION_STRING"):
    try:
        blob_service = BlobServiceClient.from_connection_string(
            os.getenv("AZURE_STORAGE_CONNECTION_STRING")
        )
        print("[OK] Azure Blob Storage aktiviert")
    except Exception as e:
        print(f"[WARN] Azure Blob Storage Fehler: {e}")
        print("[INFO] Fallback zu lokalem File Storage")
else:
    print("[INFO] Lokaler File Storage (uploads/) wird genutzt")

# ============================================================
# Helper Functions
# ============================================================

def filter_existing_pictures(pictures_json: str, uploads_dir: Path) -> List[dict]:
    """
    Filtert Bilder-Liste und entfernt Einträge für nicht existierende Dateien.
    
    Args:
        pictures_json: JSON-String mit Bildern aus DB (kann None oder '[]' sein)
        uploads_dir: Pfad zum Upload-Verzeichnis
        
    Returns:
        List[dict]: Liste mit nur existierenden Bildern
    """
    try:
        # Handle None, empty string, or '[]'
        if not pictures_json or pictures_json == '[]' or pictures_json == 'null':
            return []
            
        pictures = json.loads(pictures_json) if isinstance(pictures_json, str) else pictures_json
        
        # Handle wenn pictures kein Array ist
        if not isinstance(pictures, list):
            return []
        
        valid_pictures = []
        for pic in pictures:
            if not isinstance(pic, dict):
                continue
                
            url = pic.get('url', '')
            if not url:
                continue
            
            # Extrahiere den relativen Pfad nach /uploads/
            # Z.B. "/uploads/btl/sonderstecker_z_.png" -> "btl/sonderstecker_z_.png"
            if url.startswith('/uploads/'):
                relative_path = url[len('/uploads/'):]
            else:
                # Fallback: nur Dateiname
                relative_path = url.split('/')[-1]
            
            file_path = uploads_dir / relative_path
            
            # Nur Bilder behalten, deren Dateien existieren
            if file_path.exists():
                valid_pictures.append(pic)
        
        return valid_pictures
    except Exception as e:
        # Bei jedem Fehler: leere Liste zurück
        print(f"Warning: filter_existing_pictures error: {e}")
        return []

def parse_links(links_json: str) -> List[dict]:
    """
    Parsed Links aus JSON-String.
    
    Args:
        links_json: JSON-String mit Links aus DB (kann None oder '[]' sein)
        
    Returns:
        List[dict]: Liste mit Links
    """
    try:
        # Handle None, empty string, or '[]'
        if not links_json or links_json == '[]' or links_json == 'null':
            return []
            
        links = json.loads(links_json) if isinstance(links_json, str) else links_json
        
        # Handle wenn links kein Array ist
        if not isinstance(links, list):
            return []
        
        return links
    except Exception as e:
        print(f"Warning: parse_links error: {e}")
        return []

# ============================================================
# Typecode Normalisierung (aus createVariantenBaum.py)
# ============================================================

def normalize_token(tok: str) -> str:
    """
    Normalisiert einen Token.
    
    Args:
        tok: Der zu normalisierende Token
        
    Returns:
        str: Der normalisierte Token oder None falls leer
    """
    if tok is None:
        return None
    
    t = str(tok)
    
    # Konvertiere zu Großbuchstaben
    t = t.upper()
    
    # Gebe None zurück wenn Token nach Normalisierung leer ist
    return t if t else None


def split_typecode(code: str):
    """
    Teilt einen Typcode in seine Bestandteile.
    KDC 50-K-25-PNSOK-TSL -> ['KDC', '50', 'K', '25', 'PNSOK', 'TSL']
    Unterstützt: Bindestrich, Leerzeichen, Underscore.
    
    Args:
        code: Typcode
        
    Returns:
        list: Liste der normalisierten Tokens
    """
    if not code:
        return []
    
    code_str = str(code).strip()
    if not code_str:
        return []
    
    # Erweiterte Trennzeichen-Pattern:
    # 1. Mehrere aufeinanderfolgende Underscores
    # 2. Normale Trennzeichen (Bindestrich, Leerzeichen)
    # 3. Einzelne Underscores zwischen alphanumerischen Zeichen
    delimiter_pattern = r'_{2,}|[-\s]+|(?<=\w)_(?=\w)'
    
    # Teile auf Basis der Trennzeichen
    parts = re.split(delimiter_pattern, code_str)
    
    # Normalisiere alle Teile und filtere leere
    normalized_parts = []
    for part in parts:
        normalized = normalize_token(part)
        if normalized:
            normalized_parts.append(normalized)
    
    return normalized_parts


def reconstruct_typecode(parts: list) -> str:
    """
    Rekonstruiert einen Typcode im Standard-Format.
    ['A', 'A12', 'XYZ123'] -> 'A A12-XYZ123'
    
    Erstes Element ist die Produktfamilie (mit Leerzeichen getrennt),
    Rest mit Bindestrichen.
    """
    if not parts or len(parts) < 2:
        return None
    
    first_level = parts[0]
    rest = parts[1:]
    
    if rest:
        return f"{first_level} {'-'.join(rest)}"
    else:
        return first_level


app = FastAPI(
    title="Product Configurator API",
    description="Variantenbaum API mit Closure Table - 100x schneller als rekursive Tree-Logik!",
    version="1.0.0"
)

# CORS Configuration (aus Environment Variable)
cors_origins_str = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://localhost:5174,http://localhost:3000,http://127.0.0.1:5173,http://127.0.0.1:5174,http://127.0.0.1:3000"
)
cors_origins = [origin.strip() for origin in cors_origins_str.split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static files für Bilder servieren
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")

# ============================================================
# Pydantic Models (Type Safety wie TypeScript!)
# ============================================================

class Node(BaseModel):
    """Basis-Node wie im Frontend VTreeNode"""
    id: Optional[int] = None  # Node ID aus Datenbank
    code: Optional[str] = None
    label: Optional[str] = None
    label_en: Optional[str] = None
    name: Optional[str] = None
    level: Optional[int] = None
    position: Optional[int] = None
    group_name: Optional[str] = None
    pattern: Optional[int] = None

class NodeCheckResult(BaseModel):
    """Ergebnis der Code-Prüfung"""
    exists: bool
    code: Optional[str] = None
    label: Optional[str] = None
    label_en: Optional[str] = None
    level: Optional[int] = None
    families: List[str] = []  # In welchen Familien kommt der Code vor
    is_complete_product: bool = False  # Hat full_typecode (vollständiges Produkt)
    product_type: str = "unknown"  # "product_family", "level_code", "complete_product", "partial_code"

class CodePathSegment(BaseModel):
    """Ein Segment im Typcode-Pfad"""
    level: int
    code: str
    name: Optional[str] = None
    label: Optional[str] = None
    label_en: Optional[str] = None
    position_start: Optional[int] = None
    position_end: Optional[int] = None
    group_name: Optional[str] = None
    pictures: List[dict] = []  # Bilder für dieses Segment
    links: List[dict] = []  # Links für dieses Segment

class TypecodeDecodeResult(BaseModel):
    """Ergebnis der Typcode-Entschlüsselung"""
    exists: bool
    original_input: str
    normalized_code: Optional[str] = None
    is_complete_product: bool = False
    product_type: str = "unknown"
    path_segments: List[CodePathSegment] = []
    full_typecode: Optional[str] = None
    families: List[str] = []
    group_name: Optional[str] = None  # Produktattribut (von erster Produktfamilie)

class CodeOccurrence(BaseModel):
    """Ein Vorkommen eines Codes"""
    family: str  # Produktfamilie
    level: int  # Level
    names: List[str] = []  # Deduplizierte Name-Werte
    labels_de: List[str] = []  # Deduplizierte deutsche Labels
    labels_en: List[str] = []  # Deduplizierte englische Labels
    node_count: int = 0  # Anzahl Nodes mit diesem Code auf diesem Level in dieser Familie
    sample_node_id: Optional[int] = None  # Beispiel Node ID

class CodeSearchResult(BaseModel):
    """Ergebnis der erweiterten Code-Suche"""
    exists: bool
    code: str
    occurrences: List[CodeOccurrence] = []  # Gruppiert nach Familie & Level

class AvailableOption(BaseModel):
    """Option mit Kompatibilitäts-Flag und Pattern-Gruppierung"""
    id: Optional[int] = None  # Primäre Node ID (erste gefundene)
    ids: List[int] = []  # ALLE Node IDs mit diesem Code (für Multi-Pfad-Kompatibilität!)
    code: str
    label: Optional[str] = None
    label_en: Optional[str] = None
    name: Optional[str] = None  # Name-Attribut
    group_name: Optional[str] = None  # Group-Name-Attribut
    level: int
    position: int
    is_compatible: bool
    parent_pattern: Optional[int] = None  # Pattern kann Integer oder String sein!
    pictures: List[dict] = []  # Bilder für diese Option
    links: List[dict] = []  # Links für diese Option

class Selection(BaseModel):
    """User-Auswahl auf einem Level"""
    code: str
    level: int
    id: Optional[int] = None  # Primäre Node ID (deprecated - verwende ids!)
    ids: List[int] = []  # ALLE Node IDs mit diesem Code (für Multi-Pfad-Kompatibilität!)

class OptionsRequest(BaseModel):
    """Request für /api/options Endpoint"""
    target_level: int
    previous_selections: List[Selection] = []
    group_filter: Optional[str] = None  # Optionaler Group-Filter

class DerivedGroupNameResponse(BaseModel):
    """Response für abgeleiteten group_name basierend auf bisherigen Auswahlen"""
    group_name: Optional[str] = None  # Der eindeutige group_name (falls vorhanden)
    is_unique: bool  # True wenn alle möglichen Pfade denselben group_name haben
    possible_group_names: List[str] = []  # Liste aller möglichen group_names
    
class SearchOptionsRequest(BaseModel):
    """Request für /api/options/search Endpoint"""
    target_level: int
    previous_selections: List[Selection] = []
    pattern: Optional[int] = None
    code_prefix: Optional[str] = None
    label_search: Optional[str] = None
    group_filter: Optional[str] = None

class PathNode(BaseModel):
    """Node im Pfad mit Depth-Info"""
    code: str
    label: Optional[str] = None
    label_en: Optional[str] = None
    level: int
    depth: int

class HealthResponse(BaseModel):
    """Health Check Response"""
    status: str
    database: str
    total_nodes: int
    total_paths: int

class CreateNodeRequest(BaseModel):
    """Request zum Erstellen eines neuen Knotens"""
    code: Optional[str] = None  # Kann NULL sein für Pattern-Container
    name: str = ""  # NOT NULL in DB
    label: str = ""  # NOT NULL in DB
    label_en: Optional[str] = None
    level: int
    parent_id: Optional[int] = None  # NULL für root nodes
    position: int = 0
    pattern: Optional[int] = None
    group_name: Optional[str] = None

class CreateNodeWithChildrenRequest(BaseModel):
    """Request zum Erstellen eines neuen Knotens mit Deep Copy von Children"""
    code: Optional[str] = None
    name: str = ""
    label: str = ""
    label_en: Optional[str] = None
    level: int
    parent_id: Optional[int] = None
    position: int = 0
    pattern: Optional[int] = None
    group_name: Optional[str] = None
    source_node_id: int  # Node von dem Children kopiert werden

class CreateNodeResponse(BaseModel):
    """Response nach Knoten-Erstellung"""
    success: bool
    node_id: int
    message: str
    nodes_created: Optional[int] = None  # Anzahl erstellter Nodes (bei Deep Copy)

class CreateFamilyRequest(BaseModel):
    """Request zum Erstellen einer neuen Produktfamilie (Level 0)"""
    code: str  # z.B. "XYZ"
    label: Optional[str] = None  # Optional: Falls nicht angegeben = code
    label_en: Optional[str] = None

class UpdateFamilyRequest(BaseModel):
    """Request zum Aktualisieren der Labels einer Produktfamilie"""
    label: str  # z.B. "Aktualisierte Produktlinie"
    label_en: Optional[str] = None

class CreateFamilyResponse(BaseModel):
    """Response nach Produktfamilien-Erstellung"""
    success: bool
    family_id: int
    code: str
    label: str  # Kann leerer String sein
    label_en: Optional[str] = None
    message: str
    
class SubtreeInfo(BaseModel):
    """Info über Subtree eines Nodes (für Preview)"""
    node_id: int
    code: Optional[str] = None
    label: Optional[str] = None
    descendant_count: int
    tree_depth: int

class NodeSearchResult(BaseModel):
    """Node für Autocomplete/Search"""
    id: int
    code: Optional[str] = None
    label: Optional[str] = None
    label_en: Optional[str] = None
    level: int
    parent_id: Optional[int] = None

class UpdateNodeRequest(BaseModel):
    """Request zum Aktualisieren eines Knotens"""
    code: Optional[str] = None
    name: Optional[str] = None
    label: Optional[str] = None
    label_en: Optional[str] = None
    group_name: Optional[str] = None

class UpdateNodeResponse(BaseModel):
    """Response nach Knoten-Update"""
    success: bool
    message: str

class BulkFilterRequest(BaseModel):
    """Request für Bulk-Filter"""
    level: int
    family_code: str
    code: Optional[str] = None
    code_prefix: Optional[str] = None
    code_content: Optional[dict] = None  # {"position": int, "value": str}
    group_name: Optional[str] = None
    name: Optional[str] = None
    pattern: Optional[str] = None  # Codelänge: exakt ("3") oder Range ("2-4")
    # Neue Filter für erweiterte Kompatibilitäts-Splits
    parent_level_patterns: Optional[dict] = None  # {level: {"length": "3" | "2-4", "type": "alphabetic|numeric|alphanumeric|"}} z.B. {2: {"length": "3", "type": "numeric"}}
    parent_level_options: Optional[dict] = None  # {level: [option1, option2, ...]} z.B. {2: ["ABC", "DEF"]} - Nur noch für exakte Codes!
    allowed_pattern: Optional[dict] = None  # {"from": int, "to": int|None, "allowed": "alphabetic|numeric|alphanumeric"}

class BulkFilterResponse(BaseModel):
    """Response mit gefilterten Nodes"""
    nodes: List[AvailableOption]
    count: int

class BulkUpdateFields(BaseModel):
    """Felder für Bulk-Update"""
    name: Optional[str] = None
    label: Optional[str] = None
    label_en: Optional[str] = None
    group_name: Optional[str] = None
    # Append-Felder (fügen Werte hinzu statt zu ersetzen)
    append_name: Optional[str] = None
    append_label: Optional[str] = None
    append_label_en: Optional[str] = None
    append_group_name: Optional[str] = None

class BulkUpdateRequest(BaseModel):
    """Request für Bulk-Update"""
    node_ids: List[int]
    updates: BulkUpdateFields

class BulkUpdateResponse(BaseModel):
    """Response nach Bulk-Update"""
    success: bool
    updated_count: int
    message: str


# ============================================================
# Constraint Models
# ============================================================

class ConstraintCondition(BaseModel):
    """Bedingung für eine Constraint-Regel"""
    id: Optional[int] = None
    condition_type: str  # 'pattern', 'prefix', 'exact_code'
    target_level: int
    value: str

class ConstraintCode(BaseModel):
    """Code-Definition (erlaubt/verboten) für eine Constraint"""
    id: Optional[int] = None
    code_type: str  # 'single', 'range'
    code_value: str

class Constraint(BaseModel):
    """Vollständige Constraint-Definition"""
    id: Optional[int] = None
    level: int
    mode: str  # 'allow', 'deny'
    description: Optional[str] = None
    conditions: List[ConstraintCondition] = []
    codes: List[ConstraintCode] = []
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

class CreateConstraintRequest(BaseModel):
    """Request zum Erstellen einer neuen Constraint"""
    level: int
    mode: str
    description: Optional[str] = None
    conditions: List[ConstraintCondition]
    codes: List[ConstraintCode]

class ConstraintValidationRequest(BaseModel):
    """Request zum Validieren eines Codes gegen Constraints"""
    code: str
    level: int
    previous_selections: Dict[int, str] = {}

class ConstraintValidationResult(BaseModel):
    """Ergebnis der Constraint-Validierung"""
    is_valid: bool
    violated_constraints: List[Constraint] = []
    message: Optional[str] = None


# ============================================================
# Helper Functions
# ============================================================

def get_db():
    """Erstellt DB-Verbindung mit Row Factory"""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


# ============================================================
# Startup Event: Create Users Table & Initial Admin
# ============================================================
@app.on_event("startup")
async def startup_event():
    """Erstellt users Tabelle und Initial-Admin falls nicht vorhanden"""
    conn = get_db()
    cursor = conn.cursor()
    
    # Users Table erstellen
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
            is_active BOOLEAN DEFAULT 1,
            must_change_password BOOLEAN DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)")
    
    # Prüfe ob Admin existiert
    cursor.execute("SELECT COUNT(*) FROM users WHERE role = 'admin'")
    admin_count = cursor.fetchone()[0]
    
    if admin_count == 0:
        # Initial-Admin erstellen
        username = os.getenv("INITIAL_ADMIN_USERNAME", "admin")
        password = os.getenv("INITIAL_ADMIN_PASSWORD", "ChangeMe123!")
        
        password_hash = get_password_hash(password)
        
        try:
            cursor.execute("""
                INSERT INTO users (username, password_hash, role, is_active, must_change_password)
                VALUES (?, ?, ?, ?, ?)
            """, (username, password_hash, "admin", 1, 1))
            
            conn.commit()
            print(f"""
================================================================================
✓ Initial admin created!
  Username: {username}
  Password: {password}
  
  ⚠️  WICHTIG: Admin muss nach erstem Login das Passwort ändern!
================================================================================
""")
        except sqlite3.IntegrityError:
            pass
    
    conn.close()


# ============================================================
# AUTH ENDPOINTS
# ============================================================

@app.post("/api/auth/login", response_model=Token)
def login(request: LoginRequest):
    """
    Login Endpoint
    
    Request:
        username: str
        password: str
        
    Returns:
        access_token: JWT Token
        token_type: "bearer"
    """
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # User aus DB holen
        cursor.execute("""
            SELECT id, username, password_hash, role, is_active, must_change_password, created_at
            FROM users
            WHERE username = ?
        """, (request.username,))
        
        user_row = cursor.fetchone()
        
        if not user_row:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect username or password"
            )
        
        user = dict(user_row)
        
        # Prüfe ob User aktiv ist
        if not user['is_active']:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User account is disabled"
            )
        
        # Verifiziere Passwort
        if not verify_password(request.password, user['password_hash']):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect username or password"
            )
        
        # Erstelle JWT Token
        access_token = create_access_token(
            data={
                "sub": user['username'],
                "user_id": user['id'],
                "role": user['role']
            }
        )
        
        return {
            "access_token": access_token,
            "token_type": "bearer"
        }
        
    finally:
        conn.close()


@app.get("/api/auth/me", response_model=User)
def get_current_user_info(current_user: TokenData = Depends(get_current_user)):
    """
    Holt Infos über aktuell eingeloggten User
    
    Requires: JWT Token
    
    Returns:
        User object (ohne password_hash!)
    """
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            SELECT id, username, role, is_active, must_change_password, created_at
            FROM users
            WHERE id = ?
        """, (current_user.user_id,))
        
        user_row = cursor.fetchone()
        
        if not user_row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )
        
        user = dict(user_row)
        
        return {
            "id": user['id'],
            "username": user['username'],
            "role": user['role'],
            "is_active": user['is_active'],
            "must_change_password": user['must_change_password'],
            "created_at": user['created_at']
        }
        
    finally:
        conn.close()


@app.post("/api/auth/logout")
def logout(current_user: TokenData = Depends(get_current_user)):
    """
    Logout Endpoint
    
    Requires: JWT Token
    
    Note: JWT Tokens sind stateless. Echter "Logout" passiert im Frontend
    durch Löschen des Tokens aus localStorage. Dieser Endpoint dient nur
    zur Konsistenz und könnte für Token-Blacklisting erweitert werden.
    """
    return {"message": "Logged out successfully"}


@app.post("/api/auth/change-password")
def change_password(
    request: ChangePasswordRequest,
    current_user: TokenData = Depends(get_current_user)
):
    """
    Ändert Passwort des eingeloggten Users
    
    Requires: JWT Token
    
    Request:
        old_password: str
        new_password: str
    """
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # Hole aktuellen User
        cursor.execute("""
            SELECT id, password_hash
            FROM users
            WHERE id = ?
        """, (current_user.user_id,))
        
        user_row = cursor.fetchone()
        
        if not user_row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )
        
        user = dict(user_row)
        
        # Verifiziere altes Passwort
        if not verify_password(request.old_password, user['password_hash']):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Incorrect old password"
            )
        
        # Hashe neues Passwort
        new_password_hash = get_password_hash(request.new_password)
        
        # Update Passwort und must_change_password Flag
        cursor.execute("""
            UPDATE users
            SET password_hash = ?, must_change_password = 0, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (new_password_hash, current_user.user_id))
        
        conn.commit()
        
        return {"message": "Password changed successfully"}
        
    finally:
        conn.close()


# ============================================================
# ADMIN ENDPOINTS - User Management
# ============================================================

class CreateUserRequest(BaseModel):
    """Request für neuen User (nur Admin)"""
    username: str
    password: str
    role: str = "user"  # "admin" oder "user"

@app.post("/api/admin/users", dependencies=[Depends(require_admin)])
def create_user(request: CreateUserRequest):
    """
    Erstellt neuen User (nur Admin)
    
    Requires: Admin Role
    
    Request:
        username: str
        password: str
        role: "admin" | "user"
    """
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # Validiere Role
        if request.role not in ["admin", "user"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Role must be 'admin' or 'user'"
            )
        
        # Prüfe ob Username bereits existiert
        cursor.execute("""
            SELECT COUNT(*) FROM users 
            WHERE username = ?
        """, (request.username,))
        
        if cursor.fetchone()[0] > 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username already exists"
            )
        
        # Hashe Passwort
        password_hash = get_password_hash(request.password)
        
        # Erstelle User
        cursor.execute("""
            INSERT INTO users (username, password_hash, role, is_active, must_change_password)
            VALUES (?, ?, ?, ?, ?)
        """, (request.username, password_hash, request.role, 1, 1))
        
        conn.commit()
        
        return {
            "message": "User created successfully",
            "username": request.username,
            "role": request.role
        }
        
    finally:
        conn.close()


@app.get("/api/admin/users", dependencies=[Depends(require_admin)])
def list_users():
    """
    Listet alle Users (nur Admin)
    
    Requires: Admin Role
    """
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            SELECT id, username, role, is_active, must_change_password, created_at
            FROM users
            ORDER BY created_at DESC
        """)
        
        users = []
        for row in cursor.fetchall():
            users.append({
                "id": row['id'],
                "username": row['username'],
                "role": row['role'],
                "is_active": row['is_active'],
                "must_change_password": row['must_change_password'],
                "created_at": row['created_at']
            })
        
        return users
        
    finally:
        conn.close()


@app.delete("/api/admin/users/{user_id}", dependencies=[Depends(require_admin)])
def delete_user(user_id: int, current_user: TokenData = Depends(get_current_user)):
    """
    Löscht einen User (nur Admin)
    
    Security:
    - Requires Admin Role
    - Cannot delete yourself
    - Cannot delete initial admin (id=1)
    - Cannot delete last admin (Race Condition Protection via Transaction Lock)
    
    Returns: {"message": "User deleted successfully"}
    Raises: 400 if constraints violated, 404 if user not found
    """
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # Protection 1: Cannot delete yourself
        if user_id == current_user.user_id:
            raise HTTPException(
                status_code=400,
                detail="Cannot delete your own account"
            )
        
        # Protection 2: Cannot delete initial admin (id=1)
        if user_id == 1:
            raise HTTPException(
                status_code=403,
                detail="Cannot delete initial admin account"
            )
        
        # START EXCLUSIVE TRANSACTION (verhindert Race Condition)
        cursor.execute("BEGIN EXCLUSIVE TRANSACTION")
        
        # Check if user exists
        cursor.execute("SELECT id, username, role FROM users WHERE id = ?", (user_id,))
        user_to_delete = cursor.fetchone()
        
        if not user_to_delete:
            conn.rollback()
            raise HTTPException(status_code=404, detail="User not found")
        
        user_role = user_to_delete['role']
        username = user_to_delete['username']
        
        # Protection 3: Cannot delete last admin (with Lock protection)
        if user_role == 'admin':
            cursor.execute("SELECT COUNT(*) as count FROM users WHERE role = 'admin'")
            admin_count = cursor.fetchone()['count']
            
            if admin_count <= 1:
                conn.rollback()
                raise HTTPException(
                    status_code=400,
                    detail="Cannot delete the last admin account"
                )
        
        # All checks passed - Delete user
        cursor.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.commit()
        
        return {
            "message": "User deleted successfully",
            "username": username
        }
        
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


# ============================================================
# QUERY 1: Get Product Families
# ============================================================
@app.get("/api/product-families", response_model=List[Node])
def get_product_families():
    """
    Holt alle Root Product Families (Level 0, parent_id IS NULL).
    
    Ersetzt: getProductFamilies() in variantenbaum.ts
    """
    try:
        conn = get_db()
        print(f"[DEBUG] DB Connection OK: {conn}")
        
        cursor = conn.execute("""
            SELECT 
                id,
                code, 
                label, 
                label_en, 
                level, 
                position, 
                group_name,
                pattern
            FROM nodes
            WHERE parent_id IS NULL AND code IS NOT NULL
            ORDER BY position, code
        """)
        
        results = [dict(row) for row in cursor.fetchall()]
        print(f"[DEBUG] Found {len(results)} product families")
        return results
    except Exception as e:
        print(f"[ERROR] get_product_families failed: {e}")
        import traceback
        traceback.print_exc()
        raise
    finally:
        if 'conn' in locals():
            conn.close()


@app.get("/api/product-families/{family_code}/groups")
def get_family_groups(family_code: str):
    """
    Holt alle verfügbaren group_names für eine Produktfamilie.
    Gibt nur eindeutige, nicht-NULL group_names zurück.
    """
    conn = get_db()
    
    try:
        cursor = conn.execute("""
            SELECT DISTINCT n.group_name
            FROM nodes n
            INNER JOIN node_paths p ON n.id = p.descendant_id
            INNER JOIN nodes family ON p.ancestor_id = family.id
            WHERE family.code = ?
              AND family.level = 0
              AND n.group_name IS NOT NULL
            ORDER BY n.group_name
        """, (family_code,))
        
        results = [row['group_name'] for row in cursor.fetchall()]
        return results
    finally:
        conn.close()


@app.get("/api/product-families/{family_code}/groups/{group_name}/max-level")
def get_group_max_level(family_code: str, group_name: str):
    """
    Gibt die maximale Level-Tiefe zurück, die für eine bestimmte Group verfügbar ist.
    """
    conn = get_db()
    
    try:
        cursor = conn.execute("""
            SELECT MAX(n.level) as max_level
            FROM nodes n
            INNER JOIN node_paths p ON n.id = p.descendant_id
            INNER JOIN nodes family ON p.ancestor_id = family.id
            WHERE family.code = ?
              AND family.level = 0
              AND n.group_name = ?
        """, (family_code, group_name))
        
        result = cursor.fetchone()
        return {"max_level": result['max_level'] if result['max_level'] is not None else 0}
    finally:
        conn.close()


@app.get("/api/nodes/suggest-codes")
def suggest_codes(
    partial: str,
    family_code: str,
    level: int,
    limit: int = 50
):
    """
    Schlägt Codes vor basierend auf Partial-Match.
    Zeigt ähnliche Codes auf dem gleichen Level in der gleichen Familie.
    Wird für Autovervollständigung im Code-Eingabefeld verwendet.
    """
    conn = get_db()
    
    try:
        cursor = conn.execute("""
            SELECT DISTINCT n.code
            FROM nodes n
            INNER JOIN node_paths p ON n.id = p.descendant_id
            INNER JOIN nodes family ON p.ancestor_id = family.id
            WHERE family.code = ?
              AND family.level = 0
              AND n.level = ?
              AND n.code IS NOT NULL
              AND n.code LIKE ?
            ORDER BY n.code
            LIMIT ?
        """, (family_code, level, f"{partial}%", limit))
        
        suggestions = [row['code'] for row in cursor.fetchall()]
        return {"suggestions": suggestions}
    finally:
        conn.close()


@app.get("/api/nodes/check-code-exists")
def check_code_exists(
    code: str,
    family_code: str,
    level: int,
    parent_id: Optional[int] = None
):
    """
    Prüft ob ein Code bereits auf diesem Level existiert.
    
    LOGIK:
    - Wenn parent_id gegeben: Prüft ob Code auf diesem Level existiert und ob er 
      kompatibel mit dem aktuellen Pfad ist (d.h. denselben Parent hat oder einen 
      Ancestor des Parents im Pfad hat)
    - Der Code darf nur dann neu erstellt werden, wenn er noch nicht existiert ODER
      wenn er in einem inkompatiblen Pfad existiert
    """
    conn = get_db()
    
    try:
        if parent_id is not None:
            # DEBUG: Zeige alle nodes mit diesem Code auf diesem Level
            print(f"\n🔍 DEBUG check_code_exists: code={code}, level={level}, parent_id={parent_id}")
            debug_cursor = conn.execute("""
                SELECT n.id, n.code, n.level, n.parent_id
                FROM nodes n
                WHERE n.code = ? AND n.level = ?
            """, (code, level))
            debug_nodes = debug_cursor.fetchall()
            print(f"   Found {len(debug_nodes)} nodes with code '{code}' on level {level}:")
            for node in debug_nodes:
                print(f"   - Node ID={node['id']}, parent_id={node['parent_id']}")
            
            # DEBUG: Zeige Pfade für parent_id
            path_cursor = conn.execute("""
                SELECT ancestor_id, descendant_id, depth
                FROM node_paths
                WHERE ancestor_id = ?
                ORDER BY depth
            """, (parent_id,))
            paths = path_cursor.fetchall()
            print(f"   Paths from parent_id {parent_id}:")
            for path in paths[:5]:  # Zeige nur erste 5
                print(f"   - ancestor={path['ancestor_id']}, descendant={path['descendant_id']}, depth={path['depth']}")
            
            # Prüfe ob Code bereits als Child dieses Parents existiert
            # ODER ob er auf diesem Level in einem kompatiblen Pfad existiert
            cursor = conn.execute("""
                SELECT 1
                FROM nodes n
                INNER JOIN node_paths p ON n.id = p.descendant_id
                WHERE p.ancestor_id = ?
                  AND n.level = ?
                  AND n.code = ?
                LIMIT 1
            """, (parent_id, level, code))
            
            result = cursor.fetchone()
            exists = result is not None
            print(f"   Result: exists={exists}")
        else:
            # Alte Logik: Prüfe ob Code irgendwo auf diesem Level in dieser Familie existiert
            cursor = conn.execute("""
                SELECT 1
                FROM nodes n
                INNER JOIN node_paths p ON n.id = p.descendant_id
                INNER JOIN nodes family ON p.ancestor_id = family.id
                WHERE family.code = ?
                  AND family.level = 0
                  AND n.level = ?
                  AND n.code = ?
                LIMIT 1
            """, (family_code, level, code))
            exists = cursor.fetchone() is not None
        
        return {"exists": exists}
    finally:
        conn.close()


@app.get("/api/code-hints/{node_id}/{partial_code}")
def get_code_hints(node_id: int, partial_code: str):
    """
    Liefert character-by-character Hints für einen Code basierend auf node_labels.
    
    Args:
        node_id: ID des Nodes dessen Labels abgefragt werden
        partial_code: Teilweise eingegebener Code (z.B. "PSI")
    
    Returns:
        Array von Hints mit Position, Zeichen, Titel und Labels
        
    Beispiel Response:
    [
        {
            "position": 1,
            "character": "P",
            "title": "Technik",
            "label_de": "Drahtschalter",
            "label_en": "Wire switch",
            "matched": true
        },
        {
            "position": 2,
            "character": "S", 
            "title": "Funktion",
            "label_de": "Schließer",
            "label_en": "Normally open",
            "matched": true
        },
        {
            "position": 3,
            "character": "I",
            "title": "Ausstattung",
            "label_de": "IO-Link",
            "label_en": "IO-Link",
            "matched": false
        }
    ]
    """
    conn = get_db()
    
    try:
        # Hole alle label segments für diesen Node
        cursor = conn.execute("""
            SELECT 
                code_segment,
                position_start,
                position_end,
                title,
                label_de,
                label_en
            FROM node_labels
            WHERE node_id = ?
              AND code_segment IS NOT NULL
            ORDER BY position_start
        """, (node_id,))
        
        segments = cursor.fetchall()
        
        # Build hints array
        hints = []
        partial_len = len(partial_code)
        
        for seg in segments:
            code_seg = seg['code_segment']
            pos_start = seg['position_start']
            pos_end = seg['position_end']
            
            # Check if this segment matches the partial code
            # position_start is 1-based, convert to 0-based for string slicing
            matched = False
            if pos_start is not None and pos_end is not None:
                segment_in_partial = partial_code[pos_start-1:pos_end] if pos_start <= partial_len else ""
                matched = (segment_in_partial == code_seg)
            
            hints.append({
                "position": pos_start,
                "character": code_seg,
                "title": seg['title'],
                "label_de": seg['label_de'],
                "label_en": seg['label_en'],
                "matched": matched
            })
        
        return {"hints": hints}
        
    finally:
        conn.close()


# ============================================================
# QUERY 2: Get Children (mit Pattern Container Skip)
# ============================================================
@app.get("/api/nodes/{parent_code}/children", response_model=List[Node])
def get_children(parent_code: str):
    """
    Holt direkte Kinder eines Nodes, überspringt Pattern Containers.
    
    Pattern Container (pattern != NULL, code = NULL) werden durchschaut,
    ihre Kinder werden als direkte Kinder des Parents behandelt.
    """
    conn = get_db()
    
    try:
        cursor = conn.execute("""
            WITH RECURSIVE children_recursive AS (
                -- Direkte Kinder
                SELECT 
                    n.id, 
                    n.code, 
                    n.label, 
                    n.label_en, 
                    n.level, 
                    n.pattern, 
                    n.position, 
                    n.group_name
                FROM nodes n
                WHERE n.parent_id = (SELECT id FROM nodes WHERE code = ?)
                
                UNION ALL
                
                -- Gehe durch Pattern Container (code IS NULL)
                SELECT 
                    n.id, 
                    n.code, 
                    n.label, 
                    n.label_en, 
                    n.level, 
                    n.pattern, 
                    n.position, 
                    n.group_name
                FROM nodes n
                INNER JOIN children_recursive cr ON n.parent_id = cr.id
                WHERE cr.pattern IS NOT NULL AND cr.code IS NULL
            )
            SELECT 
                code, 
                label, 
                label_en, 
                level, 
                position, 
                group_name,
                pattern
            FROM children_recursive
            WHERE code IS NOT NULL
            ORDER BY position, code
        """, (parent_code,))
        
        results = [dict(row) for row in cursor.fetchall()]
        return results
    finally:
        conn.close()


# ============================================================
# QUERY 2b: Get Children by ID (für Deep Copy Path Selection)
# ============================================================
@app.get("/api/nodes/by-id/{parent_id}/children", response_model=List[Node])
def get_children_by_id(parent_id: int):
    """
    Holt direkte Kinder eines Nodes basierend auf ID (statt Code).
    Verwendet für Deep Copy Path Selection wo wir mit IDs arbeiten.
    
    Pattern Container (pattern != NULL, code = NULL) werden durchschaut,
    ihre Kinder werden als direkte Kinder des Parents behandelt.
    """
    conn = get_db()
    
    try:
        cursor = conn.execute("""
            WITH RECURSIVE children_recursive AS (
                -- Direkte Kinder
                SELECT 
                    n.id, 
                    n.code, 
                    n.label, 
                    n.label_en, 
                    n.level, 
                    n.pattern, 
                    n.position, 
                    n.group_name
                FROM nodes n
                WHERE n.parent_id = ?
                
                UNION ALL
                
                -- Gehe durch Pattern Container (code IS NULL)
                SELECT 
                    n.id, 
                    n.code, 
                    n.label, 
                    n.label_en, 
                    n.level, 
                    n.pattern, 
                    n.position, 
                    n.group_name
                FROM nodes n
                INNER JOIN children_recursive cr ON n.parent_id = cr.id
                WHERE cr.pattern IS NOT NULL AND cr.code IS NULL
            )
            SELECT 
                id,
                code, 
                label, 
                label_en, 
                level, 
                position, 
                group_name,
                pattern
            FROM children_recursive
            WHERE code IS NOT NULL
            ORDER BY position, code
        """, (parent_id,))
        
        results = [dict(row) for row in cursor.fetchall()]
        return results
    finally:
        conn.close()


# ============================================================
# QUERY 3: Get Max Depth
# ============================================================
@app.get("/api/nodes/{node_code}/max-depth")
def get_max_depth(node_code: str):
    """
    Holt maximale DEPTH (Tree-Hops) von einem Node aus.
    
    DEPTH = Anzahl Hops inklusive Pattern Container
    
    Nutzt Closure Table - KEINE REKURSION!
    """
    conn = get_db()
    
    try:
        cursor = conn.execute("""
            SELECT MAX(p.depth) as max_depth
            FROM node_paths p
            WHERE p.ancestor_id = (SELECT id FROM nodes WHERE code = ?)
        """, (node_code,))
        
        result = cursor.fetchone()
        
        if result is None:
            raise HTTPException(status_code=404, detail=f"Node '{node_code}' not found")
        
        return {"max_depth": result['max_depth']}
    finally:
        conn.close()


# ============================================================
# QUERY 3b: Get Max Level (für UI!)
# ============================================================
@app.get("/api/nodes/{node_code}/max-level")
def get_max_level(node_code: str, family_code: str = None):
    """
    Holt maximale LEVEL (User-Selections) AB einem Node.
    
    LEVEL = Anzahl User-Auswahlen (Pattern Container werden NICHT gezählt)
    
    Das ist was du im Frontend brauchst für dynamische Optionsfelder!
    
    WICHTIG: Gibt die max-level der DESCENDANTS des gewählten Nodes zurück!
    - Familie C ausgewählt → max-level von allen Descendants der Familie
    - Level 1 = A ausgewählt → max-level von allen Descendants von A (innerhalb der Familie!)
    
    Wenn family_code angegeben ist, wird der korrekte Node innerhalb der Familie gesucht
    (wichtig weil Codes nicht eindeutig sind - z.B. 'A' gibt es in Familie A und C!)
    """
    conn = get_db()
    
    try:
        if family_code:
            # Finde den korrekten Node innerhalb der Familie und hole max-level seiner Descendants
            cursor = conn.execute("""
                SELECT MAX(desc.level) as max_level
                FROM nodes n
                JOIN node_paths p ON n.id = p.ancestor_id
                JOIN nodes desc ON p.descendant_id = desc.id
                WHERE n.code = ?
                  AND desc.code IS NOT NULL
                  AND EXISTS (
                    SELECT 1 FROM node_paths family_path
                    WHERE family_path.ancestor_id = (SELECT id FROM nodes WHERE code = ? AND level = 0)
                      AND family_path.descendant_id = n.id
                  )
            """, (node_code, family_code))
        else:
            # Alte Logik (nur code, nimmt ersten Match)
            cursor = conn.execute("""
                SELECT MAX(n.level) as max_level
                FROM node_paths p
                JOIN nodes n ON p.descendant_id = n.id
                WHERE p.ancestor_id = (SELECT id FROM nodes WHERE code = ? LIMIT 1)
                  AND n.code IS NOT NULL
            """, (node_code,))
        
        result = cursor.fetchone()
        
        if result is None:
            raise HTTPException(status_code=404, detail=f"Node '{node_code}' not found")
        
        return {"max_level": result['max_level']}
    finally:
        conn.close()


# ============================================================
# QUERY 4: Get Available Options (HAUPTFUNKTION!)
# ============================================================
@app.post("/api/options", response_model=List[AvailableOption])
def get_available_options(request: OptionsRequest):
    """
    WICHTIGSTER ENDPOINT! Ersetzt die gesamte Kompatibilitäts-Logik aus variantenbaum.ts.
    
    Holt alle verfügbaren Optionen auf einem Level und prüft Kompatibilität
    mit vorherigen Auswahlen.
    
    KEINE REKURSION! Nutzt nur Closure Table Lookups:
    - Forward Check: Ist vorherige Auswahl Ancestor der Kandidaten?
    - Backward Check: Ist Kandidat Ancestor späterer Auswahlen?
    
    Ersetzt:
      - getAvailableOptionsForLevel()
      - testBidirectionalCompatibility()
      - testPathCompatibility()
      - findAllNodesAtLevel()
      - und 10+ weitere rekursive Funktionen!
    
    Performance: ~10-50ms für 2M Nodes (statt 1-3 Sekunden mit Rekursion!)
    """
    conn = get_db()
    
    try:
        # WICHTIG: Finde die Root-Familie (Level 0) aus den Selections!
        root_family = None
        for selection in request.previous_selections:
            if selection.level == 0:
                root_family = selection.code
                break
        
        if not root_family:
            raise HTTPException(
                status_code=400, 
                detail="No product family (level 0) in selections"
            )
        
        # 1. Hole alle Kandidaten auf dem Ziel-Level, die DESCENDANTS der Familie sind!
        # WICHTIG: Hole auch Pattern-Info vom Parent für Gruppierung!
        candidates = conn.execute("""
            SELECT DISTINCT
                n.id, 
                n.code, 
                n.name,
                n.label, 
                n.label_en, 
                n.level, 
                n.position,
                n.group_name,
                n.pictures,
                n.links,
                parent.pattern as parent_pattern,
                parent.id as parent_id
            FROM nodes n
            INNER JOIN node_paths p ON n.id = p.descendant_id
            LEFT JOIN nodes parent ON n.parent_id = parent.id
            WHERE n.level = ? 
              AND n.code IS NOT NULL
              AND p.ancestor_id = (SELECT id FROM nodes WHERE code = ? AND level = 0)
            ORDER BY parent.pattern, n.position, n.code
        """, (request.target_level, root_family)).fetchall()
        
        # 2. GRUPPIERE Kandidaten nach Code (mehrere Nodes können gleichen Code haben!)
        # Struktur: { 'code': [node_dict1, node_dict2, ...] }
        code_groups = {}
        for candidate in candidates:
            code = candidate['code']
            if code not in code_groups:
                code_groups[code] = []
            code_groups[code].append(dict(candidate))
        
        # 3. Prüfe Kompatibilität für jede CODE-GRUPPE mit optimierten Batch-Queries
        results = []
        
        for code, nodes_with_code in code_groups.items():
            # Sammle alle IDs mit diesem Code
            all_ids = [node['id'] for node in nodes_with_code]
            
            # KRITISCH: Filtere die IDs auf nur die, die im Pfad aller Selections liegen!
            # Das gilt sowohl für VORHERIGE als auch SPÄTERE Selections!
            filtered_ids = all_ids.copy()
            
            # Filtere basierend auf ALLEN Selections (vorher UND nachher!)
            for selection in request.previous_selections:
                if selection.level == request.target_level:
                    continue  # Ignoriere gleichen Level
                
                # Sammle Selection IDs
                sel_ids = []
                if selection.ids and len(selection.ids) > 0:
                    sel_ids = selection.ids
                elif selection.id:
                    sel_ids = [selection.id]
                
                # KEINE Fallback-Logik! Wenn keine IDs, ignoriere diese Selection.
                # Das Frontend muss die korrekten IDs senden!
                if not sel_ids:
                    continue
                
                # Filtere filtered_ids basierend auf Pfad-Beziehung
                if filtered_ids:
                    sel_placeholders = ','.join('?' * len(sel_ids))
                    filtered_placeholders = ','.join('?' * len(filtered_ids))
                    
                    if selection.level < request.target_level:
                        # VORHERIGE Selection: Behalte nur IDs die Descendants von sel_ids sind
                        valid_ids = conn.execute(f"""
                            SELECT DISTINCT descendant_id
                            FROM node_paths
                            WHERE ancestor_id IN ({sel_placeholders})
                              AND descendant_id IN ({filtered_placeholders})
                        """, (*sel_ids, *filtered_ids)).fetchall()
                    else:
                        # SPÄTERE Selection: Behalte nur IDs die Ancestors von sel_ids sind
                        valid_ids = conn.execute(f"""
                            SELECT DISTINCT ancestor_id
                            FROM node_paths
                            WHERE descendant_id IN ({sel_placeholders})
                              AND ancestor_id IN ({filtered_placeholders})
                        """, (*sel_ids, *filtered_ids)).fetchall()
                    
                    filtered_ids = [row[0] for row in valid_ids]  # Erste Spalte (descendant_id oder ancestor_id)
            
            # Verwende die gefilterten IDs für Kompatibilitätsprüfung
            all_ids = filtered_ids if filtered_ids else all_ids
            
            # Nehme ersten Node als Repräsentant für Metadaten
            representative = nodes_with_code[0]
            
            # Group-Filter Kompatibilität (Batch-Query)
            group_compatible = True
            if request.group_filter:
                # Prüfe ob IRGENDEIN Node in der Gruppe die gewünschte Group hat
                placeholders = ','.join('?' * len(all_ids))
                check = conn.execute(f"""
                    SELECT 1 FROM nodes n
                    INNER JOIN node_paths p ON n.id = p.descendant_id
                    WHERE p.ancestor_id IN ({placeholders})
                      AND n.group_name = ?
                    LIMIT 1
                """, (*all_ids, request.group_filter)).fetchone()
                
                if not check:
                    group_compatible = False
            
            # Kompatibilität gegen ALLE Selections mit BATCH-Queries
            is_compatible = True
            
            for selection in request.previous_selections:
                if selection.level == request.target_level:
                    continue  # Gleicher Level → ignorieren
                
                # Sammle ALLE Selection-IDs
                sel_ids = []
                if selection.ids and len(selection.ids) > 0:
                    sel_ids = selection.ids
                elif selection.id:
                    sel_ids = [selection.id]
                
                # KEIN FALLBACK! Wenn keine IDs, ignoriere diese Selection
                if not sel_ids:
                    continue
                
                # BATCH-Query: Prüfe ob IRGENDEINE Kombination passt
                cand_placeholders = ','.join('?' * len(all_ids))
                sel_placeholders = ','.join('?' * len(sel_ids))
                
                if selection.level < request.target_level:
                    # FORWARD CHECK: Selection → Candidate (batch)
                    path = conn.execute(f"""
                        SELECT 1 FROM node_paths
                        WHERE ancestor_id IN ({sel_placeholders})
                          AND descendant_id IN ({cand_placeholders})
                        LIMIT 1
                    """, (*sel_ids, *all_ids)).fetchone()
                    
                    if not path:
                        is_compatible = False
                        break
                
                else:  # selection.level > request.target_level
                    # BACKWARD CHECK: Candidate → Selection (batch)
                    path = conn.execute(f"""
                        SELECT 1 FROM node_paths
                        WHERE ancestor_id IN ({cand_placeholders})
                          AND descendant_id IN ({sel_placeholders})
                        LIMIT 1
                    """, (*all_ids, *sel_ids)).fetchone()
                    
                    if not path:
                        is_compatible = False
                        break
            
            # Kombiniere Kompatibilität
            final_compatibility = is_compatible and group_compatible
            
            # WICHTIG: Verwende die GEFILTERTEN IDs für Labels!
            # Wenn nur 1 Node übrig → dessen Label
            # Wenn mehrere Nodes → sammle einzigartige Labels
            if len(all_ids) == 1:
                # Genau 1 Node → verwende dessen Daten direkt
                representative_node = next((n for n in nodes_with_code if n['id'] == all_ids[0]), nodes_with_code[0])
                final_label = representative_node['label']
                final_label_en = representative_node['label_en']
                final_name = representative_node['name']
                final_group_name = representative_node['group_name']
                pictures_data = representative_node.get('pictures', '[]')
                links_data = representative_node.get('links', '[]')
            else:
                # Mehrere Nodes → sammle einzigartige Labels
                labels = set()
                labels_en = set()
                names = set()
                group_names = set()
                all_pictures = []
                all_links = []
                
                for node in nodes_with_code:
                    if node['id'] in all_ids:
                        if node['label']:
                            labels.add(node['label'])
                        if node['label_en']:
                            labels_en.add(node['label_en'])
                        if node['name']:
                            names.add(node['name'])
                        if node['group_name']:
                            group_names.add(node['group_name'])
                        
                        # Sammle Pictures und Links von allen gefilterten Nodes
                        node_pictures = filter_existing_pictures(node.get('pictures', '[]'), UPLOADS_DIR)
                        all_pictures.extend(node_pictures)
                        
                        node_links = parse_links(node.get('links', '[]'))
                        all_links.extend(node_links)
                
                # Kombiniere einzigartige Labels mit Trennzeichen
                final_label = '\n---\n'.join(sorted(labels)) if labels else None
                final_label_en = '\n---\n'.join(sorted(labels_en)) if labels_en else None
                final_name = ', '.join(sorted(names)) if names else None
                final_group_name = ', '.join(sorted(group_names)) if group_names else None
                
                # Dedupliziere Pictures und Links basierend auf URL
                seen_pic_urls = set()
                unique_pictures = []
                for pic in all_pictures:
                    if pic['url'] not in seen_pic_urls:
                        seen_pic_urls.add(pic['url'])
                        unique_pictures.append(pic)
                
                seen_link_urls = set()
                unique_links = []
                for link in all_links:
                    if link['url'] not in seen_link_urls:
                        seen_link_urls.add(link['url'])
                        unique_links.append(link)
                
                pictures = unique_pictures
                links = unique_links
                pictures_data = '[]'  # Bereits geparsed
                links_data = '[]'  # Bereits geparsed
            
            # Parse pictures und links (falls noch nicht geparsed)
            if len(all_ids) == 1:
                pictures = filter_existing_pictures(pictures_data, UPLOADS_DIR)
                links = parse_links(links_data)
            
            # Nehme ersten Node für Metadaten die nicht Label sind
            representative = nodes_with_code[0]
            
            # Füge GRUPPEN-Repräsentant hinzu (nicht einzelne Nodes!)
            results.append(AvailableOption(
                id=representative['id'],  # Erste ID (für Edit)
                ids=all_ids,  # ALLE IDs mit diesem Code!
                code=representative['code'],
                label=final_label,  # Gefilterte/Kombinierte Labels!
                label_en=final_label_en,
                name=final_name,
                group_name=final_group_name,
                level=representative['level'],
                position=representative['position'],
                is_compatible=final_compatibility,
                parent_pattern=representative['parent_pattern'],  # Für Gruppierung!
                pictures=pictures,
                links=links
            ))
        
        # 3. Sortiere: Pattern, dann Kompatibilität, dann Position
        # Gruppierung nach parent_pattern ist wichtig für UI!
        results.sort(key=lambda x: (
            str(x.parent_pattern) if x.parent_pattern is not None else '',  # Pattern zuerst (immer string!)
            not x.is_compatible,      # Kompatible zuerst innerhalb Pattern
            x.position,               # Position
            x.code                    # Code
        ))
        
        return results
    
    finally:
        conn.close()


@app.post("/api/derived-group-name")
async def get_derived_group_name(request: OptionsRequest):
    """
    Berechnet den abgeleiteten group_name basierend auf bisherigen Auswahlen.
    
    Logik:
    - Findet alle möglichen vollständigen Produkte (bis zum letzten Level)
    - Prüft ob alle diese Produkte denselben group_name haben
    - Falls ja: group_name ist eindeutig und kann angezeigt werden
    - Falls nein: Zeige Liste aller möglichen group_names
    
    Use Case:
    - User hat BCC M313 ausgewählt
    - Alle möglichen vollständigen Produkte haben group_name="Bauform A"
    - → Zeige "Bauform A" schon jetzt an (ohne dass User alle Levels wählen muss)
    """
    conn = get_db()
    
    try:
        # 1. Finde Root-Familie aus Selections
        root_family = None
        for selection in request.previous_selections:
            if selection.level == 0:
                root_family = selection.code
                break
        
        if not root_family:
            return DerivedGroupNameResponse(
                group_name=None,
                is_unique=False,
                possible_group_names=[]
            )
        
        # 2. Finde das höchste ausgewählte Level
        max_selected_level = max(
            (sel.level for sel in request.previous_selections),
            default=0
        )
        
        # 3. Finde alle vollständigen Produkte (Leafs), die kompatibel mit den Selections sind
        #    Ein "vollständiges Produkt" = ein Leaf-Node (kein parent_id Nachfolger)
        
        # Starte mit allen Leaf-Nodes dieser Familie
        leaf_query = """
            SELECT DISTINCT n.id, n.group_name
            FROM nodes n
            INNER JOIN node_paths p ON n.id = p.descendant_id
            WHERE p.ancestor_id = (SELECT id FROM nodes WHERE code = ? AND level = 0)
              AND n.id NOT IN (SELECT DISTINCT parent_id FROM nodes WHERE parent_id IS NOT NULL)
              AND n.group_name IS NOT NULL
        """
        
        leaf_nodes = conn.execute(leaf_query, (root_family,)).fetchall()
        
        if not leaf_nodes:
            return DerivedGroupNameResponse(
                group_name=None,
                is_unique=False,
                possible_group_names=[]
            )
        
        # 4. Filtere Leaf-Nodes: Nur die, die kompatibel mit allen Selections sind
        compatible_leaf_ids = [leaf['id'] for leaf in leaf_nodes]
        
        for selection in request.previous_selections:
            if selection.level == 0:
                continue  # Familie schon geprüft
            
            # Sammle Selection IDs
            sel_ids = selection.ids if selection.ids else ([selection.id] if selection.id else [])
            
            if not sel_ids:
                continue
            
            # Filtere: Leaf muss Descendant von einer der Selection-IDs sein
            sel_placeholders = ','.join(['?' for _ in sel_ids])
            compatible_query = f"""
                SELECT DISTINCT descendant_id
                FROM node_paths
                WHERE descendant_id IN ({','.join(['?' for _ in compatible_leaf_ids])})
                  AND ancestor_id IN ({sel_placeholders})
            """
            
            compatible_results = conn.execute(
                compatible_query,
                (*compatible_leaf_ids, *sel_ids)
            ).fetchall()
            
            compatible_leaf_ids = [row['descendant_id'] for row in compatible_results]
            
            if not compatible_leaf_ids:
                # Keine kompatiblen Leafs mehr
                return DerivedGroupNameResponse(
                    group_name=None,
                    is_unique=False,
                    possible_group_names=[]
                )
        
        # 5. Sammle group_names von allen kompatiblen Leaf-Nodes
        group_names = set()
        for leaf in leaf_nodes:
            if leaf['id'] in compatible_leaf_ids and leaf['group_name']:
                group_names.add(leaf['group_name'])
        
        possible_group_names = sorted(list(group_names))
        
        # 6. Prüfe ob eindeutig
        if len(group_names) == 1:
            return DerivedGroupNameResponse(
                group_name=possible_group_names[0],
                is_unique=True,
                possible_group_names=possible_group_names
            )
        else:
            return DerivedGroupNameResponse(
                group_name=None,
                is_unique=False,
                possible_group_names=possible_group_names
            )
    
    finally:
        conn.close()


# ============================================================
# QUERY 4b: Get Available Options with Search Filters (für erweiterte Suche)
# ============================================================
@app.post("/api/options/search", response_model=List[AvailableOption])
def get_available_options_with_search(request: SearchOptionsRequest):
    """
    Wie get_available_options, aber mit zusätzlichen Suchfiltern.
    Nutzt dieselbe Kompatibilitäts-Logik und Code-Gruppierung!
    """
    # Rufe den normalen Endpoint mit OptionsRequest
    base_request = OptionsRequest(
        target_level=request.target_level,
        previous_selections=request.previous_selections,
        group_filter=request.group_filter
    )
    
    # Hole alle Optionen
    all_options = get_available_options(base_request)
    
    # Wende zusätzliche Filter an
    filtered_options = all_options
    
    # Pattern-Filter (Codelänge)
    if request.pattern is not None:
        filtered_options = [opt for opt in filtered_options if len(opt.code) == request.pattern]
    
    # Prefix-Filter
    if request.code_prefix:
        prefix_upper = request.code_prefix.upper()
        filtered_options = [opt for opt in filtered_options if opt.code.startswith(prefix_upper)]
    
    # Label-Filter (in beiden Sprachen)
    if request.label_search:
        search_lower = request.label_search.lower()
        filtered_options = [
            opt for opt in filtered_options
            if (opt.label and search_lower in opt.label.lower()) or
               (opt.label_en and search_lower in opt.label_en.lower())
        ]
    
    return filtered_options


# ============================================================
# Search Nodes - Autocomplete für Source Node Auswahl
# WICHTIG: Muss VOR /api/nodes/{node_id} Routes stehen!
# ============================================================
@app.get("/api/nodes/autocomplete")
def autocomplete_nodes(
    level: Optional[int] = None,
    search: Optional[str] = None,
    family: Optional[str] = None,
    limit: int = 1000
):
    """
    Sucht Nodes für Autocomplete (Deep Copy Source Node Auswahl).
    Fasst gleiche Codes zusammen und speichert alle IDs.
    
    Filter:
    - level: Nur Nodes auf diesem Level
    - search: Suche in Code oder Label (case-insensitive)
    - family: Filter nach Produktfamilie
    - limit: Maximale Anzahl Ergebnisse (bezieht sich auf unique Codes)
    """
    conn = get_db()
    
    try:
        # Filtere nach Family wenn angegeben
        if family:
            query = """
                SELECT n.code, n.label, n.label_en, n.level, GROUP_CONCAT(n.id) as ids
                FROM nodes n
                INNER JOIN node_paths p ON n.id = p.descendant_id
                INNER JOIN nodes fam ON p.ancestor_id = fam.id
                WHERE fam.code = ? AND fam.level = 0 AND n.code IS NOT NULL
            """
            params = [family]
        else:
            query = """
                SELECT code, label, label_en, level, GROUP_CONCAT(id) as ids
                FROM nodes 
                WHERE code IS NOT NULL
            """
            params = []
        
        if level is not None:
            query += " AND n.level = ?" if family else " AND level = ?"
            params.append(level)
        
        if search:
            prefix = "n." if family else ""
            query += f" AND ({prefix}code LIKE ? OR {prefix}label LIKE ? OR {prefix}label_en LIKE ?)"
            search_pattern = f"%{search}%"
            params.extend([search_pattern, search_pattern, search_pattern])
        
        query += f" GROUP BY {('n.' if family else '')}code, {('n.' if family else '')}level ORDER BY {('n.' if family else '')}code LIMIT ?"
        params.append(limit)
        
        results = conn.execute(query, params).fetchall()
        
        return [
            {
                "code": row['code'],
                "label": row['label'],
                "label_en": row['label_en'],
                "level": row['level'],
                "ids": [int(id_str) for id_str in row['ids'].split(',')] if row['ids'] else []
            }
            for row in results
        ]
        
    finally:
        conn.close()


# ============================================================
# Advanced Search Endpoint
# ============================================================
@app.get("/api/nodes/search")
def advanced_search(
    level: int,
    pattern: Optional[int] = None,
    prefix: Optional[str] = None,
    postfix: Optional[str] = None,
    label: Optional[str] = None,
    family: Optional[str] = None
):
    """
    Erweiterte Suche für Nodes mit verschiedenen Filtern.
    
    Filter:
    - pattern: Codelänge (z.B. 3 für "ABC")
    - prefix: Code beginnt mit (z.B. "A")
    - postfix: Code endet mit (z.B. "X")  
    - label: Suche in label/label_en
    - family: Filter nach Produktfamilie
    """
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
    
    try:
        # Basis-Query
        query = """
            SELECT DISTINCT n.id, n.code, n.label, n.label_en, n.name, n.group_name, n.position, n.pattern
            FROM nodes n
            WHERE n.level = ? AND n.code IS NOT NULL
        """
        params = [level]
        
        # Pattern-Filter (Codelänge)
        if pattern is not None:
            query += " AND LENGTH(n.code) = ?"
            params.append(pattern)
        
        # Prefix-Filter
        if prefix:
            query += " AND n.code LIKE ?"
            params.append(f"{prefix.upper()}%")
        
        # Postfix-Filter
        if postfix:
            query += " AND n.code LIKE ?"
            params.append(f"%{postfix.upper()}")
        
        # Label-Filter (Suche in beiden Sprachen)
        if label:
            query += " AND (n.label LIKE ? OR n.label_en LIKE ?)"
            label_pattern = f"%{label}%"
            params.extend([label_pattern, label_pattern])
        
        # Familie-Filter
        if family:
            query += """
                AND n.id IN (
                    SELECT DISTINCT np.descendant_id
                    FROM node_paths np
                    INNER JOIN nodes family ON family.id = np.ancestor_id
                    WHERE family.code = ? AND family.level = 0
                )
            """
            params.append(family.upper())
        
        query += " ORDER BY n.code"
        
        cursor.execute(query, params)
        results = cursor.fetchall()
        
        options = []
        for row in results:
            options.append({
                "id": row[0],
                "code": row[1],
                "label": row[2],
                "label_en": row[3],
                "name": row[4],
                "group_name": row[5],
                "position": row[6],
                "pattern": row[7],
                "is_compatible": True  # Kompatibilität wird später im Frontend geprüft
            })
        
        return {
            "level": level,
            "count": len(options),
            "filters_applied": {
                "pattern": pattern,
                "prefix": prefix,
                "postfix": postfix,
                "label": label,
                "family": family
            },
            "options": options
        }
        
    finally:
        conn.close()


# ============================================================
# Get All Node IDs by Code and Level
# ============================================================
@app.get("/api/nodes/by-code/{code}/level/{level}/ids")
def get_all_node_ids_by_code_level(code: str, level: int):
    """
    Holt ALLE Node-IDs mit einem bestimmten Code auf einem Level.
    Unabhängig von Kompatibilität - für Bulk-Updates!
    """
    conn = get_db()
    
    try:
        cursor = conn.execute("""
            SELECT id
            FROM nodes
            WHERE code = ? AND level = ?
            ORDER BY id
        """, (code, level))
        
        ids = [row['id'] for row in cursor.fetchall()]
        
        return {"code": code, "level": level, "ids": ids, "count": len(ids)}
    finally:
        conn.close()


class FindNodeByPathRequest(BaseModel):
    """Request für pfad-basierte Node-Suche"""
    code: str
    level: int
    family_code: str
    parent_codes: List[str]  # Liste der Parent-Codes vom Level 1 bis level-1

@app.post("/api/nodes/by-path/find-id")
def find_node_id_by_path(request: FindNodeByPathRequest):
    """
    Findet die spezifische Node-ID für einen Code basierend auf dem Parent-Pfad.
    
    Beispiel: code="ABC", level=3, family_code="A", parent_codes=["XYZ", "123"]
    → Findet die Node mit Code "ABC" auf Level 3, die als Parents hat:
      Level 0: "A", Level 1: "XYZ", Level 2: "123"
    """
    conn = get_db()
    
    try:
        # Starte mit der Familie
        cursor = conn.execute("""
            SELECT id FROM nodes WHERE code = ? AND level = 0
        """, (request.family_code,))
        
        family_row = cursor.fetchone()
        if not family_row:
            return {"found": False, "node_id": None, "message": f"Familie '{request.family_code}' nicht gefunden"}
        
        current_parent_id = family_row['id']
        
        # Gehe durch alle Parent-Levels
        for lvl, parent_code in enumerate(request.parent_codes, start=1):
            cursor = conn.execute("""
                SELECT n.id
                FROM nodes n
                WHERE n.code = ?
                  AND n.level = ?
                  AND n.parent_id = ?
                LIMIT 1
            """, (parent_code, lvl, current_parent_id))
            
            parent_row = cursor.fetchone()
            if not parent_row:
                return {
                    "found": False, 
                    "node_id": None, 
                    "message": f"Parent '{parent_code}' auf Level {lvl} nicht gefunden unter Parent-ID {current_parent_id}"
                }
            
            current_parent_id = parent_row['id']
        
        # Jetzt suche die finale Node mit dem Code auf dem Ziel-Level
        # Jetzt suche die finale Node mit dem Code auf dem Ziel-Level
        cursor = conn.execute("""
            SELECT id, code, label, label_en, name, level, position, group_name
            FROM nodes
            WHERE code = ?
              AND level = ?
              AND parent_id = ?
            LIMIT 1
        """, (request.code, request.level, current_parent_id))
        
        node_row = cursor.fetchone()
        
        if node_row:
            return {
                "found": True,
                "node_id": node_row['id'],
                "node": dict(node_row)  # Vollständige Node-Daten
            }
        else:
            return {
                "found": False, 
                "node_id": None, 
                "message": f"Node '{request.code}' auf Level {request.level} nicht gefunden unter Parent-ID {current_parent_id}"
            }
    
    finally:
        conn.close()


# ============================================================
# QUERY 5: Get Node by Code
# ============================================================
@app.get("/api/nodes/{code}", response_model=Node)
def get_node_by_code(code: str):
    """
    Holt Node-Details anhand des Codes.
    """
    conn = get_db()
    
    try:
        cursor = conn.execute("""
            SELECT 
                code, 
                label, 
                label_en, 
                level, 
                position, 
                group_name,
                pattern
            FROM nodes
            WHERE code = ?
            LIMIT 1
        """, (code,))
        
        result = cursor.fetchone()
        
        if result is None:
            raise HTTPException(status_code=404, detail=f"Node '{code}' not found")
        
        return dict(result)
    finally:
        conn.close()


# ============================================================
# QUERY 8: Get Full Path (Root → Node)
# ============================================================
@app.get("/api/nodes/{code}/path", response_model=List[PathNode])
def get_node_path(code: str):
    """
    Holt den vollständigen Pfad von Root bis zum Node.
    
    Nutzt Closure Table - KEINE REKURSION!
    """
    conn = get_db()
    
    try:
        cursor = conn.execute("""
            SELECT 
                n.code,
                n.label,
                n.label_en,
                n.level,
                np.depth
            FROM node_paths np
            JOIN nodes n ON np.ancestor_id = n.id
            WHERE np.descendant_id = (SELECT id FROM nodes WHERE code = ?)
              AND n.code IS NOT NULL
            ORDER BY np.depth
        """, (code,))
        
        results = [dict(row) for row in cursor.fetchall()]
        
        if not results:
            raise HTTPException(status_code=404, detail=f"Node '{code}' not found")
        
        return results
    finally:
        conn.close()


# ============================================================
# Code Check - Prüft ob ein Code existiert (mit Normalisierung!)
# ============================================================

def search_with_wildcards(parts: list, cursor) -> NodeCheckResult:
    """
    Sucht nach Codes mit Wildcard-Unterstützung.
    
    NEUE Strategie für flexible Wildcards:
    - Sammle alle nicht-wildcard Codes mit ihren relativen Positionen
    - Suche Pfade die diese Codes in der richtigen Reihenfolge enthalten
    - Wildcards "*" bedeuten: "irgendein Code dazwischen erlaubt"
    
    Beispiel: ["BCC", "M313", "*", "*", "OP123"]
    → BCC muss Level 0 sein
    → M313 muss irgendwo nach BCC kommen
    → OP123 muss irgendwo nach M313 kommen
    → Wildcards definieren nur die minimale Anzahl Levels dazwischen
    """
    if not parts:
        return NodeCheckResult(exists=False)
    
    # Familie muss immer angegeben sein (keine Wildcard auf Level 0)
    family_code = parts[0]
    if family_code == '*':
        return NodeCheckResult(exists=False, product_type="unknown")
    
    # Finde Familie
    cursor.execute("""
        SELECT id, code, label, label_en
        FROM nodes
        WHERE code = ? AND level = 0 AND parent_id IS NULL
    """, (family_code,))
    
    family = cursor.fetchone()
    if not family:
        return NodeCheckResult(exists=False, product_type="unknown")
    
    # Wenn nur Familie + Wildcards: zähle einfach Treffer
    non_wildcard_parts = [(i, part) for i, part in enumerate(parts) if part != '*']
    
    if len(non_wildcard_parts) == 1:
        # Nur Familie, keine anderen Codes
        return NodeCheckResult(
            exists=True,
            code=' '.join(parts[:2]) + ('-' + '-'.join(parts[2:]) if len(parts) > 2 else ''),
            label="Familie gefunden",
            label_en="Family found",
            level=0,
            families=[family_code],
            is_complete_product=False,
            product_type="wildcard_search"
        )
    
    # Baue eine Query die den Pfad validiert
    # Strategie: Suche alle Nodes die:
    # 1. Zur richtigen Familie gehören
    # 2. Die nicht-wildcard Codes in der richtigen Reihenfolge im Pfad haben
    
    # Sammle die nicht-wildcard Codes (ohne Familie)
    required_codes = [(i, part) for i, part in enumerate(parts[1:], 1) if part != '*']
    
    if not required_codes:
        # Nur Wildcards nach Familie
        return NodeCheckResult(
            exists=True,
            code=' '.join(parts[:2]) + ('-' + '-'.join(parts[2:]) if len(parts) > 2 else ''),
            label="Wildcard-Suche erfolgreich",
            label_en="Wildcard search successful",
            level=0,
            families=[family_code],
            is_complete_product=False,
            product_type="wildcard_search"
        )
    
    # Für jeden required code: finde alle Nodes mit diesem Code in dieser Familie
    # und prüfe ob sie in der richtigen Reihenfolge im Pfad vorkommen
    
    # Suche nach dem LETZTEN nicht-wildcard Code im Pfad
    last_level_idx, last_code = required_codes[-1]
    
    # Finde alle Nodes mit dem letzten Code
    cursor.execute("""
        SELECT DISTINCT n.id, n.code, n.label, n.label_en, n.level, n.full_typecode
        FROM nodes n
        INNER JOIN node_paths np ON n.id = np.descendant_id
        INNER JOIN nodes family ON np.ancestor_id = family.id
        WHERE family.code = ?
          AND family.level = 0
          AND n.code = ?
          AND n.level >= ?
    """, (family_code, last_code, last_level_idx))
    
    candidate_nodes = cursor.fetchall()
    
    if not candidate_nodes:
        return NodeCheckResult(exists=False, product_type="unknown")
    
    # Für jeden Kandidaten: Prüfe ob alle required codes im Pfad vorkommen
    valid_nodes = []
    
    for candidate in candidate_nodes:
        # Hole den vollständigen Pfad zu diesem Node
        cursor.execute("""
            SELECT n.code, n.level
            FROM nodes n
            INNER JOIN node_paths np ON n.id = np.ancestor_id
            WHERE np.descendant_id = ?
              AND n.level > 0
            ORDER BY n.level ASC
        """, (candidate['id'],))
        
        path_codes = [(row['level'], row['code']) for row in cursor.fetchall()]
        
        # Prüfe ob alle required codes in der richtigen Reihenfolge vorkommen
        path_dict = {level: code for level, code in path_codes}
        
        all_match = True
        for req_level, req_code in required_codes:
            # Finde ob dieser Code auf einem Level >= req_level vorkommt
            found = False
            for level, code in path_codes:
                if level >= req_level and code == req_code:
                    found = True
                    break
            
            if not found:
                all_match = False
                break
        
        if all_match:
            valid_nodes.append(candidate)
    
    if not valid_nodes:
        return NodeCheckResult(exists=False, product_type="unknown")
    
    # Rekonstruiere den Suchcode (mit Wildcards)
    search_code = ' '.join(parts[:2]) if len(parts) > 1 else parts[0]
    if len(parts) > 2:
        search_code += '-' + '-'.join(parts[2:])
    
    # Sichere Zugriff auf Row-Objekt
    first_node = valid_nodes[0]
    try:
        full_typecode = first_node['full_typecode']
    except (KeyError, IndexError):
        full_typecode = None
    
    return NodeCheckResult(
        exists=True,
        code=search_code,
        label=f"{len(valid_nodes)} Treffer gefunden",
        label_en=f"{len(valid_nodes)} matches found",
        level=first_node['level'],
        families=[family_code],
        is_complete_product=bool(full_typecode),
        product_type="wildcard_search"
    )


@app.get("/api/nodes/check/{code:path}", response_model=NodeCheckResult)
def check_node_code(code: str):
    """
    Prüft ob ein Produktcode existiert und gibt Details zurück.
    
    NEU: Unterstützt Wildcards!
    - "*" = beliebiger Code auf diesem Level
    - Beispiel: "BCC M313 * OP123" → findet alle Pfade mit BCC → M313 → (beliebig) → OP123
    
    WICHTIG: Prüft nur EXAKTE oder VOLLSTÄNDIGE PARTIAL Matches!
    - "A A12-X" → findet exakten Match
    - "A A12-XYZ123" → findet Partial Match (existiert als Zwischenknoten)
    - "A A12 x" → findet NICHTS (nicht "A A12-X", weil nicht vollständig!)
    - "B A" → findet NICHTS (nicht "A", weil Produktfamilie nicht passt!)
    
    Unterstützt verschiedene Formate:
    - Standard: "A A12-XYZ123"
    - Mit Underscores: "A_A12_XYZ123"
    - Kleinbuchstaben: "a a12-xyz123"
    - Mit Wildcards: "BCC * M313"
    """
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # Normalisiere und splitte den Input
        parts = split_typecode(code)
        
        if not parts:
            return NodeCheckResult(exists=False)
        
        # Prüfe ob Wildcards enthalten sind
        has_wildcards = any(part == '*' for part in parts)
        
        if has_wildcards:
            # Wildcard-Suche
            return search_with_wildcards(parts, cursor)
        
        # SPEZIALFALL: Einzelner Code (z.B. "A", "XYZ123")
        # → Suche nach Code auf beliebigem Level
        if len(parts) == 1:
            # Prüfe zuerst Produktfamilie (level 0)
            cursor.execute("""
                SELECT id, code, label, label_en, level
                FROM nodes
                WHERE code = ? AND level = 0 AND parent_id IS NULL
                LIMIT 1
            """, (parts[0],))
            
            node = cursor.fetchone()
            
            if node:
                return NodeCheckResult(
                    exists=True,
                    code=node['code'],
                    label=node['label'],
                    label_en=node['label_en'],
                    level=node['level'],
                    families=[node['code']],
                    is_complete_product=False,
                    product_type="product_family"
                )
            
            # Wenn nicht gefunden: Suche auf allen Levels
            # (z.B. "XYZ123" ohne Produktfamilie)
            cursor.execute("""
                SELECT DISTINCT n.id, n.code, n.label, n.label_en, n.level, n.full_typecode
                FROM nodes n
                WHERE n.code = ?
                  AND n.code IS NOT NULL
                ORDER BY n.level ASC
                LIMIT 1
            """, (parts[0],))
            
            node = cursor.fetchone()



        
            if node:
                # Finde alle Produktfamilien in denen dieser Code vorkommt
                cursor.execute("""
                    SELECT DISTINCT family.code as family_code
                    FROM nodes n
                    INNER JOIN node_paths p ON n.id = p.descendant_id
                    INNER JOIN nodes family ON p.ancestor_id = family.id
                    WHERE n.code = ?
                      AND family.level = 0
                      AND family.code IS NOT NULL
                """, (parts[0],))
                
                families = [row['family_code'] for row in cursor.fetchall()]
                
                return NodeCheckResult(
                    exists=True,
                    code=node['code'],  # Nur den eingegebenen Code zurückgeben, nicht full_typecode
                    label=node['label'],
                    label_en=node['label_en'],
                    level=node['level'],
                    families=families,
                    is_complete_product=False,  # Single-Code-Eingaben sind NIEMALS vollständige Produkte
                    product_type="product_family" if node['level'] == 0 else "level_code"
                )
            
            # Nichts gefunden
            return NodeCheckResult(exists=False, product_type="unknown")
        
        # Ab hier: Multi-Level Codes (mindestens 2 Teile)
        # Rekonstruiere den normalisierten Typcode
        normalized_full = reconstruct_typecode(parts)
        
        if not normalized_full:
            return NodeCheckResult(exists=False)
        
        # STRATEGIE 1: Exakter Match gegen full_typecode (für vollständige Leaf-Typcodes)
        cursor.execute("""
            SELECT DISTINCT n.id, n.code, n.label, n.label_en, n.level, n.full_typecode
            FROM nodes n
            WHERE n.full_typecode = ?
            LIMIT 1
        """, (normalized_full,))
        
        node = cursor.fetchone()
        
        if node:
            # Finde alle Produktfamilien für diesen vollständigen Typcode
            cursor.execute("""
                SELECT DISTINCT family.code as family_code
                FROM nodes n
                INNER JOIN node_paths p ON n.id = p.descendant_id
                INNER JOIN nodes family ON p.ancestor_id = family.id
                WHERE n.full_typecode = ?
                  AND family.level = 0
                  AND family.code IS NOT NULL
            """, (normalized_full,))
            
            families = [row['family_code'] for row in cursor.fetchall()]
            
            return NodeCheckResult(
                exists=True,
                code=node['full_typecode'] or node['code'],
                label=node['label'],
                label_en=node['label_en'],
                level=node['level'],
                families=families,
                is_complete_product=True,
                product_type="complete_product"
            )
        
        # STRATEGIE 2: Partial Match - aber nur mit PATH-VALIDIERUNG!
        # Prüfe ob ein vollständiger Pfad durch den Baum mit allen Teilen existiert
        
        # Starte mit der Produktfamilie (parts[0])
        cursor.execute("""
            SELECT id FROM nodes 
            WHERE code = ? AND level = 0 AND parent_id IS NULL
        """, (parts[0],))
        
        family_node = cursor.fetchone()
        
        if not family_node:
            # Produktfamilie existiert nicht
            return NodeCheckResult(exists=False)
        
        current_node_id = family_node['id']
        
        # Durchlaufe alle weiteren Teile und prüfe ob Pfad existiert
        for i, part in enumerate(parts[1:], start=1):
            # Prüfe ob ein Kind mit diesem Code und Level existiert
            # Nutze node_paths für schnellere Suche statt rekursiver CTE
            cursor.execute("""
                SELECT DISTINCT n.id, n.code, n.level
                FROM nodes n
                INNER JOIN node_paths p ON n.id = p.descendant_id
                WHERE p.ancestor_id = ?
                  AND n.code = ?
                  AND n.level = ?
                LIMIT 1
            """, (current_node_id, part, i))
            
            next_node = cursor.fetchone()
            
            if not next_node:
                # Pfad bricht ab - dieser Code existiert nicht
                return NodeCheckResult(
                    exists=False,
                    product_type="unknown"
                )
            
            current_node_id = next_node['id']
        
        # Pfad existiert! Hole Details des gefundenen Nodes
        cursor.execute("""
            SELECT n.id, n.code, n.label, n.label_en, n.level, n.full_typecode
            FROM nodes n
            WHERE n.id = ?
        """, (current_node_id,))
        
        node = cursor.fetchone()
        
        if node:
            # Finde Produktfamilie
            cursor.execute("""
                SELECT DISTINCT family.code as family_code
                FROM node_paths p
                INNER JOIN nodes family ON p.ancestor_id = family.id
                WHERE p.descendant_id = ?
                  AND family.level = 0
                  AND family.code IS NOT NULL
            """, (current_node_id,))
            
            families = [row['family_code'] for row in cursor.fetchall()]
            
            return NodeCheckResult(
                exists=True,
                code=normalized_full,  # Gib den vollständigen eingegebenen Code zurück
                label=node['label'] or "",
                label_en=node['label_en'],
                level=node['level'],
                families=families,
                is_complete_product=bool(node['full_typecode']),
                product_type="complete_product" if node['full_typecode'] else "partial_code"
            )
        
        # Nichts gefunden
        return NodeCheckResult(
            exists=False,
            product_type="unknown"
        )
        
    finally:
        conn.close()


@app.get("/api/nodes/search-code/{code:path}", response_model=CodeSearchResult)
def search_code_all_occurrences(code: str):
    """
    Sucht nach einem Code und gibt ALLE Vorkommen zurück,
    gruppiert nach Produktfamilie und Level.
    
    Für jeden Code wird gezeigt:
    - In welchen Produktfamilien er vorkommt
    - Auf welchen Levels er vorkommt
    - Deduplizierte Labels (DE + EN)
    - Anzahl der Nodes
    
    Beispiel: "A11" könnte vorkommen als:
    - BCC, Level 2: ["Option A", "Variante 11"] (50 Nodes)
    - BCC, Level 5: ["Endstück A11"] (12 Nodes)
    - BTL7, Level 3: ["Sensor A11"] (8 Nodes)
    """
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # Suche alle Nodes mit diesem Code
        cursor.execute("""
            SELECT 
                n.id,
                n.code,
                n.name,
                n.label,
                n.label_en,
                n.level,
                family.code as family_code
            FROM nodes n
            INNER JOIN node_paths np ON n.id = np.descendant_id
            INNER JOIN nodes family ON np.ancestor_id = family.id
            WHERE n.code = ?
              AND family.level = 0
              AND family.code IS NOT NULL
            ORDER BY family.code, n.level, n.id
        """, (code,))
        
        nodes = cursor.fetchall()
        
        if not nodes:
            return CodeSearchResult(exists=False, code=code, occurrences=[])
        
        # Gruppiere nach (family, level)
        from collections import defaultdict
        grouped = defaultdict(lambda: {
            'names': set(),
            'labels_de': set(),
            'labels_en': set(),
            'node_ids': [],
        })
        
        for node in nodes:
            key = (node['family_code'], node['level'])
            
            if node['name']:
                grouped[key]['names'].add(node['name'])
            if node['label']:
                grouped[key]['labels_de'].add(node['label'])
            if node['label_en']:
                grouped[key]['labels_en'].add(node['label_en'])
            
            grouped[key]['node_ids'].append(node['id'])
        
        # Konvertiere zu CodeOccurrence Objekten
        occurrences = []
        for (family, level), data in sorted(grouped.items()):
            occurrences.append(CodeOccurrence(
                family=family,
                level=level,
                names=sorted(list(data['names'])),
                labels_de=sorted(list(data['labels_de'])),
                labels_en=sorted(list(data['labels_en'])),
                node_count=len(data['node_ids']),
                sample_node_id=data['node_ids'][0] if data['node_ids'] else None
            ))
        
        return CodeSearchResult(
            exists=True,
            code=code,
            occurrences=occurrences
        )
        
    finally:
        conn.close()


# ============================================================
# Wildcard Decode Helper
# ============================================================
def decode_with_wildcards(parts: list, original_input: str, cursor) -> TypecodeDecodeResult:
    """
    Entschlüsselt einen Typcode mit Wildcards.
    
    Beispiel: ["BCC", "M313", "*", "OP123"]
    → Zeigt alle passenden Pfade mit Segmenten
    """
    if not parts or parts[0] == '*':
        return TypecodeDecodeResult(
            exists=False,
            original_input=original_input,
            product_type="unknown"
        )
    family_code = parts[0]
    
    # Finde Familie
    cursor.execute("""
        SELECT id, code, label, label_en, pictures, links, group_name
        FROM nodes
        WHERE code = ? AND level = 0 AND parent_id IS NULL
    """, (family_code,))
    
    family = cursor.fetchone()
    if not family:
        return TypecodeDecodeResult(
            exists=False,
            original_input=original_input,
            product_type="unknown"
        )
    
    # Sammle Pfad-Segmente
    path_segments = []
    
    # Familie als erstes Segment
    family_pictures = filter_existing_pictures(family['pictures'] or '[]', UPLOADS_DIR)
    family_links = parse_links(family['links'] or '[]')
    
    path_segments.append(CodePathSegment(
        level=0,
        code=family['code'],
        label=family['label'],
        label_en=family['label_en'],
        group_name=family['group_name'],
        pictures=family_pictures,
        links=family_links
    ))
    
    # Starte mit Familie
    current_node_ids = [family['id']]
    
    # Iteriere durch die restlichen Parts
    for level_idx, part in enumerate(parts[1:], start=1):
        if not current_node_ids:
            break
        
        if part == '*':
            # Wildcard: Sammle ALLE Codes auf diesem Level
            # WICHTIG: Nutze node_paths (closure table) statt parent_id, 
            # weil Pattern-Container dazwischen sein können!
            placeholders = ','.join('?' * len(current_node_ids))
            cursor.execute(f"""
                SELECT DISTINCT 
                    child.id, child.code, child.name, 
                    child.label, child.label_en,
                    child.group_name, child.pictures, child.links
                FROM nodes child
                INNER JOIN node_paths np ON child.id = np.descendant_id
                WHERE np.ancestor_id IN ({placeholders})
                  AND child.level = ?
                  AND child.code IS NOT NULL
                ORDER BY child.code
            """, (*current_node_ids, level_idx))
            
            nodes = cursor.fetchall()
            
            if nodes:
                # Sammle alle Codes und zeige sie als Liste
                codes = sorted(set(node['code'] for node in nodes))
                
                # Dedupliziere Labels
                labels_de = set()
                labels_en = set()
                
                for node in nodes:
                    if node['label']:
                        labels_de.add(node['label'])
                    if node['label_en']:
                        labels_en.add(node['label_en'])
                
                # Zeige alle gefundenen Codes in der Beschreibung
                code_list = ', '.join(codes[:10])  # Zeige maximal 10 Codes
                if len(codes) > 10:
                    code_list += f' ... (+{len(codes) - 10} weitere)'
                
                path_segments.append(CodePathSegment(
                    level=level_idx,
                    code=f"*",  # Wildcard-Symbol
                    label=f"Wildcard Match: {code_list}\n\nMögliche Labels:\n" + '\n'.join(sorted(labels_de)[:5]) if labels_de else f"Wildcard Match: {code_list}",
                    label_en=f"Wildcard Match: {code_list}\n\nPossible Labels:\n" + '\n'.join(sorted(labels_en)[:5]) if labels_en else f"Wildcard Match: {code_list}",
                    pictures=[],
                    links=[]
                ))
                
                # Nächste Level: Alle gefundenen Nodes
                current_node_ids = [node['id'] for node in nodes]
            else:
                break
        else:
            # Exakter Code
            # WICHTIG: Nutze node_paths (closure table) statt parent_id, 
            # weil Pattern-Container dazwischen sein können!
            placeholders = ','.join('?' * len(current_node_ids))
            cursor.execute(f"""
                SELECT DISTINCT 
                    child.id, child.code, child.name,
                    child.label, child.label_en,
                    child.group_name, child.pictures, child.links
                FROM nodes child
                INNER JOIN node_paths np ON child.id = np.descendant_id
                WHERE np.ancestor_id IN ({placeholders})
                  AND child.level = ?
                  AND child.code = ?
            """, (*current_node_ids, level_idx, part))
            
            nodes = cursor.fetchall()
            
            if nodes:
                # Dedupliziere Labels (falls mehrere Pfade zum gleichen Code führen)
                labels_de = set()
                labels_en = set()
                all_pictures = []
                all_links = []
                
                for node in nodes:
                    if node['label']:
                        labels_de.add(node['label'])
                    if node['label_en']:
                        labels_en.add(node['label_en'])
                    if node['pictures']:
                        pics = filter_existing_pictures(node['pictures'], UPLOADS_DIR)
                        all_pictures.extend(pics)
                    if node['links']:
                        links = parse_links(node['links'])
                        all_links.extend(links)
                
                # Dedupliziere Pictures und Links
                seen_pic_urls = set()
                unique_pictures = []
                for pic in all_pictures:
                    if pic['url'] not in seen_pic_urls:
                        seen_pic_urls.add(pic['url'])
                        unique_pictures.append(pic)
                
                seen_link_urls = set()
                unique_links = []
                for link in all_links:
                    if link['url'] not in seen_link_urls:
                        seen_link_urls.add(link['url'])
                        unique_links.append(link)
                
                path_segments.append(CodePathSegment(
                    level=level_idx,
                    code=part,
                    label='\n'.join(sorted(labels_de)) if labels_de else None,
                    label_en='\n'.join(sorted(labels_en)) if labels_en else None,
                    group_name=nodes[0]['group_name'] if nodes else None,
                    pictures=unique_pictures,
                    links=unique_links
                ))
                
                current_node_ids = [node['id'] for node in nodes]
            else:
                break
    
    # Rekonstruiere normalisierten Code
    normalized = ' '.join(parts[:2]) if len(parts) > 1 else parts[0]
    if len(parts) > 2:
        normalized += '-' + '-'.join(parts[2:])
    
    # Sichere Zugriff auf Row-Objekt
    try:
        group_name = family['group_name']
    except (KeyError, IndexError):
        group_name = None
    
    return TypecodeDecodeResult(
        exists=len(path_segments) > 1,  # Mindestens Familie + ein Level
        original_input=original_input,
        normalized_code=normalized,
        is_complete_product=False,  # Wildcards = nie vollständig
        product_type="wildcard_search",
        path_segments=path_segments,
        families=[family_code],
        group_name=group_name
    )


# ============================================================
# Decode Typecode - Typcode entschlüsseln
# ============================================================
@app.get("/api/nodes/decode/{code:path}", response_model=TypecodeDecodeResult)
def decode_typecode(code: str):
    """
    Entschlüsselt einen Typcode und zeigt alle Segmente mit Labels.
    Funktioniert sowohl für vollständige als auch für Teilcodes.
    
    NEU: Unterstützt Wildcards!
    - "*" = beliebiger Code auf diesem Level
    - Beispiel: "BCC M313 * OP123" → zeigt alle passenden Pfade
    """
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # Normalisierung wie in check_node_code
        parts = split_typecode(code)
        
        if not parts:
            return TypecodeDecodeResult(
                exists=False,
                original_input=code,
                product_type="unknown"
            )
        
        # Prüfe ob Wildcards enthalten sind
        has_wildcards = any(part == '*' for part in parts)
        
        if has_wildcards and len(parts) > 1:
            # Wildcard-Entschlüsselung für Multi-Level Codes
            return decode_with_wildcards(parts, code, cursor)
        
        # Single-Code-Entschlüsselung
        if len(parts) == 1:
            # Hole ALLE Nodes mit diesem Code
            cursor.execute("""
                SELECT DISTINCT n.id, n.code, n.name, n.label, n.label_en, n.level, n.full_typecode, n.position, n.group_name, n.pictures, n.links
                FROM nodes n
                WHERE n.code = ?
                  AND n.code IS NOT NULL
                ORDER BY n.level ASC
            """, (parts[0],))
            
            all_nodes = cursor.fetchall()
            
            if not all_nodes:
                return TypecodeDecodeResult(
                    exists=False,
                    original_input=code,
                    product_type="unknown"
                )
            
            # Verwende erste Node für Metadaten
            first_node = all_nodes[0]
            
            # Finde Produktfamilien
            cursor.execute("""
                SELECT DISTINCT family.code as family_code
                FROM nodes n
                INNER JOIN node_paths p ON n.id = p.descendant_id
                INNER JOIN nodes family ON p.ancestor_id = family.id
                WHERE n.code = ?
                  AND family.level = 0
                  AND family.code IS NOT NULL
            """, (parts[0],))
            
            families = [row['family_code'] for row in cursor.fetchall()]
            
            # Sammle einzigartige Labels, Pictures und Links von ALLEN Nodes mit diesem Code
            if len(all_nodes) == 1:
                # Nur eine Node → verwende deren Daten direkt
                node = all_nodes[0]
                final_label = node['label']
                final_label_en = node['label_en']
                final_name = node['name']
                pictures_data = node['pictures'] if node['pictures'] else '[]'
                pictures = filter_existing_pictures(pictures_data, UPLOADS_DIR)
                links_data = node['links'] if node['links'] else '[]'
                links = parse_links(links_data)
            else:
                # Mehrere Nodes → sammle einzigartige Labels
                labels = set()
                labels_en = set()
                names = set()
                all_pictures = []
                all_links = []
                
                for node in all_nodes:
                    if node['label']:
                        labels.add(node['label'])
                    if node['label_en']:
                        labels_en.add(node['label_en'])
                    if node['name']:
                        names.add(node['name'])
                    
                    # Sammle Pictures und Links
                    node_pictures = filter_existing_pictures(node.get('pictures', '[]'), UPLOADS_DIR)
                    all_pictures.extend(node_pictures)
                    
                    node_links = parse_links(node.get('links', '[]'))
                    all_links.extend(node_links)
                
                # Kombiniere einzigartige Labels mit Trennzeichen
                final_label = '\n---\n'.join(sorted(labels)) if labels else None
                final_label_en = '\n---\n'.join(sorted(labels_en)) if labels_en else None
                final_name = ', '.join(sorted(names)) if names else None
                
                # Dedupliziere Pictures basierend auf URL
                seen_pic_urls = set()
                unique_pictures = []
                for pic in all_pictures:
                    if pic['url'] not in seen_pic_urls:
                        seen_pic_urls.add(pic['url'])
                        unique_pictures.append(pic)
                
                # Dedupliziere Links basierend auf URL
                seen_link_urls = set()
                unique_links = []
                for link in all_links:
                    if link['url'] not in seen_link_urls:
                        seen_link_urls.add(link['url'])
                        unique_links.append(link)
                
                pictures = unique_pictures
                links = unique_links
            
            return TypecodeDecodeResult(
                exists=True,
                original_input=code,
                normalized_code=first_node['code'],
                is_complete_product=False,  # Single codes sind nie complete products
                product_type="product_family" if first_node['level'] == 0 else "level_code",
                path_segments=[
                    CodePathSegment(
                        level=first_node['level'],
                        code=first_node['code'],
                        name=final_name,
                        label=final_label,
                        label_en=final_label_en,
                        position_start=first_node['position'],
                        position_end=first_node['position'] + len(first_node['code']) if first_node['position'] else None,
                        pictures=pictures,
                        links=links
                    )
                ],
                full_typecode=first_node['full_typecode'],
                families=families,
                group_name=first_node['group_name']
            )
        
        # Multi-Level-Code-Entschlüsselung
        normalized_full = reconstruct_typecode(parts)
        
        if not normalized_full:
            return TypecodeDecodeResult(
                exists=False,
                original_input=code,
                product_type="unknown"
            )
        
        # Überprüfe ob exakter Pfad existiert
        first_part = parts[0]
        
        # Finde Produktfamilie (Level 0)
        cursor.execute("""
            SELECT n.id, n.code, n.label, n.label_en, n.level, n.position, n.group_name, n.pictures, n.links
            FROM nodes n
            WHERE n.code = ? 
              AND n.level = 0
              AND n.code IS NOT NULL
            LIMIT 1
        """, (first_part,))
        
        family_node = cursor.fetchone()
        
        if not family_node:
            return TypecodeDecodeResult(
                exists=False,
                original_input=code,
                product_type="unknown"
            )
        
        # Sammle alle Pfad-Segmente
        # Hole name für Produktfamilie
        cursor.execute("""
            SELECT name FROM nodes WHERE id = ?
        """, (family_node['id'],))
        family_name_row = cursor.fetchone()
        family_name = family_name_row['name'] if family_name_row else None
        
        # Parse pictures für Familie und filtere nicht existierende Dateien
        family_pictures_data = family_node['pictures'] if family_node['pictures'] else '[]'
        family_pictures = filter_existing_pictures(family_pictures_data, UPLOADS_DIR)
        
        # Parse links für Familie
        family_links_data = family_node['links'] if family_node['links'] else '[]'
        family_links = parse_links(family_links_data)
        
        path_segments = [
            CodePathSegment(
                level=family_node['level'],
                code=family_node['code'],
                name=family_name,
                label=family_node['label'],
                label_en=family_node['label_en'],
                position_start=1,
                position_end=1 + len(family_node['code']),
                pictures=family_pictures,
                links=family_links
            )
        ]
        
        current_node_id = family_node['id']
        current_position = len(family_node['code']) + 2  # +1 für Leerzeichen
        
        # Sammle group_name während des Pfad-Durchlaufs (erstes nicht-NULL group_name)
        # Starte mit family_node falls es schon ein group_name hat
        collected_group_name = family_node['group_name'] if family_node['group_name'] else None
        
        # Durchlaufe alle weiteren Teile des Pfads
        path_exists = True
        for i, part in enumerate(parts[1:], start=1):
            cursor.execute("""
                SELECT DISTINCT n.id, n.code, n.name, n.label, n.label_en, n.level, n.position, n.full_typecode, n.group_name, n.pictures, n.links
                FROM nodes n
                INNER JOIN node_paths p ON n.id = p.descendant_id
                WHERE p.ancestor_id = ?
                  AND n.code = ?
                  AND n.level = ?
                LIMIT 1
            """, (current_node_id, part, i))
            
            next_node = cursor.fetchone()
            
            if not next_node:
                path_exists = False
                break
            
            # Sammle erstes nicht-NULL group_name
            if not collected_group_name and next_node['group_name']:
                collected_group_name = next_node['group_name']
            
            # Parse pictures und filtere nicht existierende Dateien
            pictures_data = next_node['pictures'] if next_node['pictures'] else '[]'
            pictures = filter_existing_pictures(pictures_data, UPLOADS_DIR)
            
            # Parse links
            links_data = next_node['links'] if next_node['links'] else '[]'
            links = parse_links(links_data)
            
            # Position berechnen
            part_start = current_position
            part_end = current_position + len(part)
            
            path_segments.append(
                CodePathSegment(
                    level=next_node['level'],
                    code=next_node['code'],
                    name=next_node['name'],
                    label=next_node['label'],
                    label_en=next_node['label_en'],
                    position_start=part_start,
                    position_end=part_end,
                    pictures=pictures,
                    links=links
                )
            )
            
            current_node_id = next_node['id']
            current_position = part_end + 1  # +1 für Trennzeichen
            final_node = next_node
        
        if not path_exists:
            return TypecodeDecodeResult(
                exists=False,
                original_input=code,
                normalized_code=normalized_full,
                product_type="unknown"
            )
        
        # Bestimme finale Klassifizierung
        is_complete_product = bool(final_node['full_typecode'])
        product_type = "complete_product" if is_complete_product else "partial_code"
        
        # Verwende gesammeltes group_name (wurde während des Pfad-Durchlaufs gefunden)
        group_name = collected_group_name
        
        return TypecodeDecodeResult(
            exists=True,
            original_input=code,
            normalized_code=normalized_full,
            is_complete_product=is_complete_product,
            product_type=product_type,
            path_segments=path_segments,
            full_typecode=final_node['full_typecode'],
            families=[family_node['code']],
            group_name=group_name
        )
        
    finally:
        conn.close()


# ============================================================
# KMAT References - Admin only
# ============================================================

class KMATReferenceRequest(BaseModel):
    """Request zum Speichern/Updaten einer KMAT Referenz"""
    family_id: int
    path_node_ids: List[int]  # Array der Node IDs im Pfad
    full_typecode: str
    kmat_reference: str

class KMATReferenceResponse(BaseModel):
    """Response für KMAT Referenz Operationen"""
    success: bool
    id: int
    kmat_reference: str
    message: str

@app.post("/api/admin/kmat-references", dependencies=[Depends(require_admin)])
def create_or_update_kmat_reference(
    request: KMATReferenceRequest,
    current_user: TokenData = Depends(get_current_user)
) -> KMATReferenceResponse:
    """
    Erstellt oder aktualisiert eine KMAT Referenz für ein konfiguriertes Produkt.
    Die KMAT Referenz ist spezifisch für einen vollständigen Pfad durch den Baum.
    Nur für Admins verfügbar.
    """
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # Konvertiere path_node_ids zu JSON string
        path_json = json.dumps(request.path_node_ids)
        
        # Prüfe ob bereits eine Referenz für diesen Pfad existiert
        cursor.execute("""
            SELECT id FROM kmat_references
            WHERE family_id = ? AND path_node_ids = ?
        """, (request.family_id, path_json))
        
        existing = cursor.fetchone()
        
        if existing:
            # Update existing
            cursor.execute("""
                UPDATE kmat_references
                SET kmat_reference = ?,
                    full_typecode = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (request.kmat_reference, request.full_typecode, existing[0]))
            
            kmat_id = existing[0]
            message = "KMAT Referenz aktualisiert"
        else:
            # Insert new
            cursor.execute("""
                INSERT INTO kmat_references (
                    family_id, path_node_ids, full_typecode, 
                    kmat_reference, created_by
                ) VALUES (?, ?, ?, ?, ?)
            """, (
                request.family_id,
                path_json,
                request.full_typecode,
                request.kmat_reference,
                current_user.user_id
            ))
            
            kmat_id = cursor.lastrowid
            message = "KMAT Referenz erstellt"
        
        conn.commit()
        
        return KMATReferenceResponse(
            success=True,
            id=kmat_id,
            kmat_reference=request.kmat_reference,
            message=message
        )
        
    except Exception as e:
        conn.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Fehler beim Speichern der KMAT Referenz: {str(e)}"
        )
    finally:
        conn.close()


@app.get("/api/kmat-references")
def get_kmat_reference(
    family_id: int,
    path_node_ids: str  # JSON string: "[1,5,12,45]"
) -> dict:
    """
    Ruft die KMAT Referenz für ein konfiguriertes Produkt ab.
    Öffentlich verfügbar (alle User).
    """
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            SELECT id, kmat_reference, full_typecode, 
                   created_at, updated_at
            FROM kmat_references
            WHERE family_id = ? AND path_node_ids = ?
        """, (family_id, path_node_ids))
        
        result = cursor.fetchone()
        
        if result:
            return {
                "found": True,
                "id": result[0],
                "kmat_reference": result[1],
                "full_typecode": result[2],
                "created_at": result[3],
                "updated_at": result[4]
            }
        else:
            return {"found": False}
            
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Fehler beim Abrufen der KMAT Referenz: {str(e)}"
        )
    finally:
        conn.close()


@app.delete("/api/admin/kmat-references/{kmat_id}", dependencies=[Depends(require_admin)])
def delete_kmat_reference(
    kmat_id: int,
    current_user: TokenData = Depends(get_current_user)
) -> dict:
    """
    Löscht eine KMAT Referenz.
    Nur für Admins verfügbar.
    """
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        cursor.execute("DELETE FROM kmat_references WHERE id = ?", (kmat_id,))
        
        if cursor.rowcount == 0:
            raise HTTPException(
                status_code=404,
                detail=f"KMAT Referenz mit ID {kmat_id} nicht gefunden"
            )
        
        conn.commit()
        
        return {
            "success": True,
            "message": f"KMAT Referenz {kmat_id} gelöscht"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Fehler beim Löschen der KMAT Referenz: {str(e)}"
        )
    finally:
        conn.close()


# ============================================================
# Create Node - Knoten hinzufügen
# ============================================================
@app.post("/api/nodes", response_model=CreateNodeResponse)
def create_node(request: CreateNodeRequest):
    """
    Erstellt einen neuen Knoten und aktualisiert die Closure Table.
    
    WICHTIG: Closure Table wird automatisch aktualisiert!
    - Neuer Knoten bekommt self-reference (depth=0)
    - Alle Ancestors werden kopiert mit depth+1
    """
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # 1. Neuen Node erstellen
        cursor.execute("""
            INSERT INTO nodes (code, name, label, label_en, level, parent_id, position, pattern, group_name)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            request.code,
            request.name,
            request.label,
            request.label_en,
            request.level,
            request.parent_id,
            request.position,
            request.pattern,
            request.group_name
        ))
        
        new_node_id = cursor.lastrowid
        
        # WICHTIG: Die Closure Table wird durch DB-Trigger aktualisiert!
        # Trigger trg_node_insert feuert nur wenn parent_id IS NOT NULL
        # Root-Nodes (parent_id = NULL) brauchen manuellen self-reference
        if request.parent_id is None:
            cursor.execute("""
                INSERT INTO node_paths (ancestor_id, descendant_id, depth)
                VALUES (?, ?, 0)
            """, (new_node_id, new_node_id))
        
        conn.commit()
        
        return CreateNodeResponse(
            success=True,
            node_id=new_node_id,
            message=f"Node created with ID {new_node_id}"
        )
        
    except Exception as e:
        conn.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create node: {str(e)}"
        )
    finally:
        conn.close()


# ============================================================
# Create Product Family (Admin only)
# ============================================================
@app.post("/api/admin/families", dependencies=[Depends(require_admin)])
def create_family(
    request: CreateFamilyRequest,
    current_user: TokenData = Depends(get_current_user)
) -> CreateFamilyResponse:
    """
    Erstellt eine neue Produktfamilie (Level 0 Node).
    
    - Erstellt Node mit parent_id=NULL
    - Setzt family_id auf sich selbst
    - Erstellt Self-Reference in node_paths (Closure Table)
    
    Nur für Admins verfügbar.
    """
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # Validierung: Code darf nicht leer sein
        if not request.code or not request.code.strip():
            raise HTTPException(
                status_code=400,
                detail="Code darf nicht leer sein"
            )
        
        # Prüfe ob Code bereits existiert (auf Level 0)
        cursor.execute("""
            SELECT id FROM nodes 
            WHERE code = ? AND parent_id IS NULL
        """, (request.code.strip(),))
        
        if cursor.fetchone():
            raise HTTPException(
                status_code=409,
                detail=f"Produktfamilie mit Code '{request.code}' existiert bereits"
            )
        
        # Position: Ermittle nächste freie Position (max + 1)
        cursor.execute("""
            SELECT COALESCE(MAX(position), -1) + 1 
            FROM nodes 
            WHERE parent_id IS NULL
        """)
        position = cursor.fetchone()[0]
        
        # name und label sind NOT NULL im Schema
        # Falls label leer/None: verwende leeren String (wie bestehende Nodes)
        label = (request.label or '').strip() if request.label else ''
        label_en = (request.label_en or '').strip() if request.label_en else None
        
        # 1. Insert neue Produktfamilie
        cursor.execute("""
            INSERT INTO nodes (
                code, name, label, label_en, level, 
                parent_id, position
            ) VALUES (?, ?, ?, ?, 0, NULL, ?)
        """, (
            request.code.strip(),
            request.code.strip(),  # name = code (NOT NULL constraint)
            label,  # label = '' wenn leer (NOT NULL constraint)
            label_en,  # label_en kann NULL sein
            position
        ))
        
        family_id = cursor.lastrowid
        
        # 2. Closure Table: Self-reference manuell erstellen
        # (Trigger feuert nur bei parent_id IS NOT NULL)
        cursor.execute("""
            INSERT INTO node_paths (ancestor_id, descendant_id, depth)
            VALUES (?, ?, 0)
        """, (family_id, family_id))
        
        conn.commit()
        
        return CreateFamilyResponse(
            success=True,
            family_id=family_id,
            code=request.code.strip(),
            label=label,  # Verwende den berechneten label ('' wenn leer)
            label_en=label_en,
            message=f"Produktfamilie '{request.code}' erfolgreich erstellt"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Fehler beim Erstellen der Produktfamilie: {str(e)}"
        )
    finally:
        conn.close()


# ============================================================
# Update Product Family Labels (Admin only)
# ============================================================
@app.put("/api/admin/families/{family_code}", dependencies=[Depends(require_admin)])
def update_family_labels(
    family_code: str,
    request: UpdateFamilyRequest,
    current_user: TokenData = Depends(get_current_user)
) -> dict:
    """
    Aktualisiert Labels einer Produktfamilie (Level 0 Node).
    
    - Nur label und label_en können aktualisiert werden
    - Code kann nicht geändert werden
    
    Nur für Admins verfügbar.
    """
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # Finde die Produktfamilie
        cursor.execute("""
            SELECT id, code, label, label_en 
            FROM nodes 
            WHERE code = ? AND parent_id IS NULL AND level = 0
        """, (family_code.upper(),))
        
        family = cursor.fetchone()
        if not family:
            raise HTTPException(
                status_code=404,
                detail=f"Produktfamilie '{family_code}' nicht gefunden"
            )
        
        # Update labels
        cursor.execute("""
            UPDATE nodes 
            SET label = ?, label_en = ?, name = ?
            WHERE id = ?
        """, (
            request.label,
            request.label_en,
            request.label,  # name = label für Familien
            family['id']
        ))
        
        conn.commit()
        
        return {
            "success": True,
            "code": family['code'],
            "label": request.label,
            "label_en": request.label_en,
            "message": f"Labels für Produktfamilie '{family_code}' erfolgreich aktualisiert"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Fehler beim Aktualisieren der Produktfamilie: {str(e)}"
        )
    finally:
        conn.close()


# ============================================================
# Delete Product Family (Admin only)
# ============================================================
@app.delete("/api/admin/families/{family_code}", dependencies=[Depends(require_admin)])
def delete_family(
    family_code: str,
    current_user: TokenData = Depends(get_current_user)
) -> dict:
    """
    Löscht eine Produktfamilie und ALLE zugehörigen Nodes (gesamter Subtree).
    
    Prüft vorher:
    - Anzahl der betroffenen Nodes (Warnung)
    - Abhängigkeiten in product_successors
    - Abhängigkeiten in constraint_combinations
    
    WICHTIG: Der trg_node_delete Trigger kümmert sich automatisch um node_paths!
    
    Nur für Admins verfügbar.
    """
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # 1. Finde die Produktfamilie
        cursor.execute("""
            SELECT id, code 
            FROM nodes 
            WHERE code = ? AND parent_id IS NULL AND level = 0
        """, (family_code.upper(),))
        
        family = cursor.fetchone()
        if not family:
            raise HTTPException(
                status_code=404,
                detail=f"Produktfamilie '{family_code}' nicht gefunden"
            )
        
        family_id = family['id']
        
        # 2. Zähle alle betroffenen Nodes (Family + alle Descendants)
        cursor.execute("""
            SELECT COUNT(*) as count
            FROM node_paths
            WHERE ancestor_id = ?
        """, (family_id,))
        total_nodes = cursor.fetchone()['count']
        
        # 3. Prüfe product_successors Abhängigkeiten
        cursor.execute("""
            SELECT COUNT(*) as count
            FROM product_successors
            WHERE source_node_id IN (
                SELECT descendant_id FROM node_paths WHERE ancestor_id = ?
            ) OR target_node_id IN (
                SELECT descendant_id FROM node_paths WHERE ancestor_id = ?
            )
        """, (family_id, family_id))
        successor_count = cursor.fetchone()['count']
        
        # 4. Lösche product_successors Einträge (auch wenn CASCADE das macht, explizit ist besser)
        if successor_count > 0:
            cursor.execute("""
                DELETE FROM product_successors
                WHERE source_node_id IN (
                    SELECT descendant_id FROM node_paths WHERE ancestor_id = ?
                ) OR target_node_id IN (
                    SELECT descendant_id FROM node_paths WHERE ancestor_id = ?
                )
            """, (family_id, family_id))
        
        # 5. Lösche alle Nodes
        # CASCADE löscht automatisch: node_labels, node_dates
        # Trigger trg_node_delete löscht: node_paths
        cursor.execute("""
            DELETE FROM nodes
            WHERE id IN (
                SELECT descendant_id FROM node_paths WHERE ancestor_id = ?
            )
        """, (family_id,))
        
        deleted_count = cursor.rowcount
        conn.commit()
        
        return {
            "success": True,
            "code": family_code,
            "deleted_nodes": deleted_count,
            "deleted_successors": successor_count,
            "message": f"Produktfamilie '{family_code}' und {deleted_count} Nodes erfolgreich gelöscht"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Fehler beim Löschen der Produktfamilie: {str(e)}"
        )
    finally:
        conn.close()


# ============================================================
# Delete Single Node (Admin only)
# ============================================================
@app.delete("/api/admin/nodes/{node_id}", dependencies=[Depends(require_admin)])
def delete_node(
    node_id: int,
    current_user: TokenData = Depends(get_current_user)
) -> dict:
    """
    Löscht ALLE Nodes mit demselben Code auf demselben Level und ALLE ihre Descendants.
    
    Beispiel: Wenn Node "C010" auf Level 2 gelöscht wird, werden ALLE Nodes mit
    Code "C010" auf Level 2 gelöscht (da derselbe Code in verschiedenen Pfaden existieren kann).
    
    Prüft vorher:
    - Anzahl der betroffenen Nodes (alle Nodes mit diesem Code+Level + ihre Descendants)
    - Abhängigkeiten in product_successors
    
    WICHTIG: Der trg_node_delete Trigger kümmert sich automatisch um node_paths!
    
    Nur für Admins verfügbar.
    """
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # 1. Finde den Node
        cursor.execute("""
            SELECT id, code, label, level, parent_id
            FROM nodes 
            WHERE id = ?
        """, (node_id,))
        
        node = cursor.fetchone()
        if not node:
            raise HTTPException(
                status_code=404,
                detail=f"Node mit ID {node_id} nicht gefunden"
            )
        
        # Verhindere Löschen von Level 0 (Produktfamilien) über diesen Endpoint
        if node['level'] == 0:
            raise HTTPException(
                status_code=400,
                detail="Produktfamilien (Level 0) müssen über DELETE /api/admin/families/{code} gelöscht werden"
            )
        
        node_code = node['code']
        node_level = node['level']
        
        # 2. Finde ALLE Nodes mit demselben Code auf demselben Level
        cursor.execute("""
            SELECT id FROM nodes
            WHERE code = ? AND level = ?
        """, (node_code, node_level))
        
        all_node_ids = [row['id'] for row in cursor.fetchall()]
        
        if not all_node_ids:
            raise HTTPException(
                status_code=404,
                detail=f"Keine Nodes mit Code '{node_code}' auf Level {node_level} gefunden"
            )
        
        # 3. Zähle alle betroffenen Nodes (alle Nodes mit diesem Code+Level + alle ihre Descendants)
        placeholders = ','.join('?' * len(all_node_ids))
        cursor.execute(f"""
            SELECT COUNT(DISTINCT descendant_id) as count
            FROM node_paths
            WHERE ancestor_id IN ({placeholders})
        """, all_node_ids)
        total_nodes = cursor.fetchone()['count']
        
        # 4. Prüfe product_successors Abhängigkeiten
        cursor.execute(f"""
            SELECT COUNT(*) as count
            FROM product_successors
            WHERE source_node_id IN (
                SELECT DISTINCT descendant_id FROM node_paths WHERE ancestor_id IN ({placeholders})
            ) OR target_node_id IN (
                SELECT DISTINCT descendant_id FROM node_paths WHERE ancestor_id IN ({placeholders})
            )
        """, all_node_ids + all_node_ids)
        successor_count = cursor.fetchone()['count']
        
        # 5. Lösche product_successors Einträge
        if successor_count > 0:
            cursor.execute(f"""
                DELETE FROM product_successors
                WHERE source_node_id IN (
                    SELECT DISTINCT descendant_id FROM node_paths WHERE ancestor_id IN ({placeholders})
                ) OR target_node_id IN (
                    SELECT DISTINCT descendant_id FROM node_paths WHERE ancestor_id IN ({placeholders})
                )
            """, all_node_ids + all_node_ids)
        
        # 6. Lösche alle Nodes
        # CASCADE löscht automatisch: node_labels, node_dates
        # Trigger trg_node_delete löscht: node_paths
        cursor.execute(f"""
            DELETE FROM nodes
            WHERE id IN (
                SELECT DISTINCT descendant_id FROM node_paths WHERE ancestor_id IN ({placeholders})
            )
        """, all_node_ids)
        
        deleted_count = cursor.rowcount
        conn.commit()
        
        return {
            "success": True,
            "node_id": node_id,
            "code": node_code,
            "level": node_level,
            "deleted_nodes": deleted_count,
            "deleted_successors": successor_count,
            "nodes_with_same_code": len(all_node_ids),
            "message": f"Alle {len(all_node_ids)} Nodes mit Code '{node_code}' (Level {node_level}) und insgesamt {deleted_count} Nodes erfolgreich gelöscht"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Fehler beim Löschen des Nodes: {str(e)}"
        )
    finally:
        conn.close()


# ============================================================
# Preview Node Deletion (Admin only)
# ============================================================
@app.get("/api/admin/nodes/{node_id}/delete-preview", dependencies=[Depends(require_admin)])
def preview_node_deletion(
    node_id: int,
    current_user: TokenData = Depends(get_current_user)
) -> dict:
    """
    Zeigt eine Vorschau der Auswirkungen beim Löschen eines Nodes.
    
    WICHTIG: Löscht ALLE Nodes mit demselben Code auf demselben Level!
    
    Gibt zurück:
    - Node-Informationen (Code, Label, Level)
    - Anzahl der Nodes mit demselben Code+Level
    - Anzahl betroffener Nodes gesamt (inkl. Descendants)
    - Anzahl betroffener Successors
    
    Nur für Admins verfügbar.
    """
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # Finde den Node
        cursor.execute("""
            SELECT id, code, label, level, parent_id
            FROM nodes 
            WHERE id = ?
        """, (node_id,))
        
        node = cursor.fetchone()
        if not node:
            raise HTTPException(
                status_code=404,
                detail=f"Node mit ID {node_id} nicht gefunden"
            )
        
        # Verhindere Löschen von Level 0 über diesen Endpoint
        if node['level'] == 0:
            raise HTTPException(
                status_code=400,
                detail="Produktfamilien (Level 0) können nicht über diesen Endpoint gelöscht werden"
            )
        
        node_code = node['code']
        node_level = node['level']
        
        # Finde ALLE Nodes mit demselben Code auf demselben Level
        cursor.execute("""
            SELECT id FROM nodes
            WHERE code = ? AND level = ?
        """, (node_code, node_level))
        
        all_node_ids = [row['id'] for row in cursor.fetchall()]
        
        if not all_node_ids:
            raise HTTPException(
                status_code=404,
                detail=f"Keine Nodes mit Code '{node_code}' auf Level {node_level} gefunden"
            )
        
        # Zähle betroffene Nodes gesamt
        placeholders = ','.join('?' * len(all_node_ids))
        cursor.execute(f"""
            SELECT COUNT(DISTINCT descendant_id) as count
            FROM node_paths
            WHERE ancestor_id IN ({placeholders})
        """, all_node_ids)
        total_nodes = cursor.fetchone()['count']
        
        # Zähle betroffene Successors
        cursor.execute(f"""
            SELECT COUNT(*) as count
            FROM product_successors
            WHERE source_node_id IN (
                SELECT DISTINCT descendant_id FROM node_paths WHERE ancestor_id IN ({placeholders})
            ) OR target_node_id IN (
                SELECT DISTINCT descendant_id FROM node_paths WHERE ancestor_id IN ({placeholders})
            )
        """, all_node_ids + all_node_ids)
        successor_count = cursor.fetchone()['count']
        
        return {
            "node_id": node_id,
            "code": node_code,
            "label": node['label'],
            "level": node_level,
            "nodes_with_same_code": len(all_node_ids),
            "affected_nodes": total_nodes,
            "affected_successors": successor_count,
            "affected_constraints": 0,
            "can_delete": True,
            "warnings": [
                f"{len(all_node_ids)} Nodes mit Code '{node_code}' auf Level {node_level} werden gelöscht",
                f"{total_nodes} Nodes gesamt (inkl. alle Descendants)",
                f"{successor_count} Nachfolger-Beziehungen werden gelöscht" if successor_count > 0 else None,
            ]
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Fehler beim Abrufen der Lösch-Vorschau: {str(e)}"
        )
    finally:
        conn.close()


# ============================================================
# Preview Family Deletion (Admin only)
# ============================================================
@app.get("/api/admin/families/{family_code}/delete-preview", dependencies=[Depends(require_admin)])
def preview_family_deletion(
    family_code: str,
    current_user: TokenData = Depends(get_current_user)
) -> dict:
    """
    Zeigt eine Vorschau der Auswirkungen beim Löschen einer Produktfamilie.
    
    Gibt zurück:
    - Anzahl betroffener Nodes
    - Anzahl betroffener Successors
    - Anzahl betroffener Constraints
    
    Nur für Admins verfügbar.
    """
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # Finde die Produktfamilie
        cursor.execute("""
            SELECT id, code, label 
            FROM nodes 
            WHERE code = ? AND parent_id IS NULL AND level = 0
        """, (family_code.upper(),))
        
        family = cursor.fetchone()
        if not family:
            raise HTTPException(
                status_code=404,
                detail=f"Produktfamilie '{family_code}' nicht gefunden"
            )
        
        family_id = family['id']
        
        # Zähle betroffene Nodes
        cursor.execute("""
            SELECT COUNT(*) as count
            FROM node_paths
            WHERE ancestor_id = ?
        """, (family_id,))
        total_nodes = cursor.fetchone()['count']
        
        # Zähle betroffene Successors
        cursor.execute("""
            SELECT COUNT(*) as count
            FROM product_successors
            WHERE source_node_id IN (
                SELECT descendant_id FROM node_paths WHERE ancestor_id = ?
            ) OR target_node_id IN (
                SELECT descendant_id FROM node_paths WHERE ancestor_id = ?
            )
        """, (family_id, family_id))
        successor_count = cursor.fetchone()['count']
        
        return {
            "code": family['code'],
            "label": family['label'],
            "affected_nodes": total_nodes,
            "affected_successors": successor_count,
            "affected_constraints": 0,
            "can_delete": True,
            "warnings": [
                f"{total_nodes} Nodes werden gelöscht",
                f"{successor_count} Nachfolger-Beziehungen werden gelöscht" if successor_count > 0 else None,
            ]
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Fehler beim Abrufen der Lösch-Vorschau: {str(e)}"
        )
    finally:
        conn.close()


# ============================================================
# Bulk Filter Nodes - Nodes nach Kriterien filtern
# ============================================================
def check_allowed_pattern(code: str, allowed_config: dict) -> bool:
    """
    Prüft ob ein Code das allowed-pattern erfüllt.
    
    Args:
        code: Der zu prüfende Code
        allowed_config: {"from": int, "to": int|None, "allowed": "alphabetic|numeric|alphanumeric"}
        
    Returns:
        True wenn Code das Pattern erfüllt
    """
    if not allowed_config or not code:
        return True
    
    from_pos = allowed_config.get('from', 0)
    to_pos = allowed_config.get('to')
    allowed = allowed_config.get('allowed', 'alphanumeric')
    
    # Extrahiere den zu prüfenden Teil
    if to_pos is not None:
        check_part = code[from_pos:to_pos]
    else:
        check_part = code[from_pos:]
    
    if not check_part:
        return False
    
    # Prüfe gegen allowed-pattern
    # WICHTIG: Sonderzeichen sind immer erlaubt!
    # Wir prüfen nur, dass MINDESTENS ein passendes Zeichen vorhanden ist
    if allowed == 'alphabetic':
        # Enthält mindestens einen Buchstaben, keine Zahlen
        has_alpha = any(c.isalpha() for c in check_part)
        has_digit = any(c.isdigit() for c in check_part)
        return has_alpha and not has_digit
    elif allowed == 'numeric':
        # Enthält mindestens eine Zahl, keine Buchstaben
        has_alpha = any(c.isalpha() for c in check_part)
        has_digit = any(c.isdigit() for c in check_part)
        return has_digit and not has_alpha
    elif allowed == 'alphanumeric':
        # Enthält mindestens Buchstaben oder Zahlen
        has_alnum = any(c.isalnum() for c in check_part)
        return has_alnum
    
    return True


def check_parent_level_option(parent_code: str, option_config) -> bool:
    """
    Prüft ob ein Parent-Code eine Option erfüllt.
    
    Args:
        parent_code: Der Parent-Code
        option_config: Entweder String (exakter Code) oder dict mit {"pattern": "alphabetic|numeric|alphanumeric"}
        
    Returns:
        True wenn Parent-Code die Option erfüllt
    """
    if not parent_code:
        return False
    
    # String = exakter Code-Match
    if isinstance(option_config, str):
        return parent_code == option_config
    
    # Dict = Pattern-Match
    if isinstance(option_config, dict) and 'pattern' in option_config:
        pattern = option_config['pattern']
        # WICHTIG: Sonderzeichen sind immer erlaubt!
        if pattern == 'alphabetic':
            # Enthält mindestens einen Buchstaben, keine Zahlen
            has_alpha = any(c.isalpha() for c in parent_code)
            has_digit = any(c.isdigit() for c in parent_code)
            return has_alpha and not has_digit
        elif pattern == 'numeric':
            # Enthält mindestens eine Zahl, keine Buchstaben
            has_alpha = any(c.isalpha() for c in parent_code)
            has_digit = any(c.isdigit() for c in parent_code)
            return has_digit and not has_alpha
        elif pattern == 'alphanumeric':
            # Enthält mindestens Buchstaben oder Zahlen
            has_alnum = any(c.isalnum() for c in parent_code)
            return has_alnum
    
    return False


@app.post("/api/nodes/bulk-filter", response_model=BulkFilterResponse)
def bulk_filter_nodes(request: BulkFilterRequest):
    """
    Filtert Nodes auf einem Level basierend auf mehreren Kriterien.
    
    Filter:
    - code: Exakter Code-Match
    - code_prefix: Code startet mit diesem Prefix
    - code_content: Code enthält an Position X den Wert Y
    - group_name: Group-Name Match
    - name: Name Match (Teilstring-Suche)
    - pattern: Code-Länge
    - parent_level_patterns: {level: pattern_length} - Filtert nach Parent-Pattern auf bestimmten Levels
    - parent_level_options: {level: [codes]} - Filtert nach Parent-Code auf bestimmten Levels
    - allowed_pattern: {"from": int, "to": int, "allowed": str} - Filtert nach Code-Pattern (alphabetic/numeric/alphanumeric)
    """
    conn = get_db()
    
    try:
        # Basis-Query: Hole alle Nodes auf dem Level in der Familie
        # Gruppiere nach Code um Duplikate zu vermeiden
        query = """
            SELECT 
                n.code,
                MIN(n.id) as id,
                MIN(n.label) as label,
                MIN(n.label_en) as label_en,
                MIN(n.name) as name,
                n.level,
                MIN(n.position) as position,
                MIN(n.group_name) as group_name,
                MIN(n.pattern) as pattern,
                MIN(parent.pattern) as parent_pattern
            FROM nodes n
            LEFT JOIN nodes parent ON parent.id = n.parent_id
            LEFT JOIN node_paths np ON np.descendant_id = n.id
            WHERE n.level = ?
              AND n.code IS NOT NULL
              AND EXISTS (
                  SELECT 1 FROM nodes fam
                  WHERE fam.code = ?
                    AND fam.level = 0
                    AND np.ancestor_id = fam.id
              )
        """
        
        params = [request.level, request.family_code]
        
        # HINWEIS: Filter für aktuelles Level (code, code_prefix, pattern) werden
        # NICHT mehr in der SQL-Query angewendet, sondern später per is_compatible Flag,
        # damit auch "inkompatible" Optionen angezeigt werden können!
        
        # Nur Filter, die nichts mit Code-Matching zu tun haben:
        if request.group_name:
            query += " AND n.group_name = ?"
            params.append(request.group_name)
        
        if request.name:
            query += " AND n.name LIKE ?"
            params.append(f"%{request.name}%")
        
        query += " GROUP BY n.code, n.level ORDER BY position, n.code"
        
        results = conn.execute(query, params).fetchall()
        
        nodes = []
        for row in results:
            # Starte mit kompatibel = True
            is_compatible = True
            
            # Filter für aktuelles Level (Code-Matching)
            # Diese werden NICHT in der SQL-Query angewendet, damit auch inkompatible Optionen angezeigt werden!
            
            # Exakter Code-Filter
            if request.code and row['code'] != request.code:
                is_compatible = False
            
            # Code-Prefix Filter
            if request.code_prefix and not row['code'].startswith(request.code_prefix):
                is_compatible = False
            
            # Pattern-Länge Filter (Code-Länge: exakt oder Range)
            if request.pattern:
                pattern_str = str(request.pattern)
                if '-' in pattern_str:
                    # Range: z.B. "2-4"
                    parts = pattern_str.split('-')
                    if len(parts) == 2:
                        try:
                            min_len = int(parts[0])
                            max_len = int(parts[1])
                            if not (min_len <= len(row['code']) <= max_len):
                                is_compatible = False
                        except ValueError:
                            is_compatible = False
                else:
                    # Exakte Länge
                    try:
                        expected_len = int(pattern_str)
                        if len(row['code']) != expected_len:
                            is_compatible = False
                    except ValueError:
                        is_compatible = False
            
            # Code-Content Filter (nach DB-Abfrage, weil komplex)
            if request.code_content and row['code']:
                position = request.code_content.get('position')
                value = request.code_content.get('value', '')
                
                passes_filter = True
                if position is not None:
                    # Position ist 1-basiert (UI), konvertiere zu 0-basiert (Python)
                    # Position 1 = erstes Zeichen (Index 0)
                    # Position 2 = zweites Zeichen (Index 1), etc.
                    index = position - 1
                    
                    # Code muss ab dieser Position MIT dem Wert BEGINNEN (startswith)
                    if index >= 0 and index < len(row['code']):
                        code_from_index = row['code'][index:]
                        if not code_from_index.startswith(value):
                            passes_filter = False
                    else:
                        # Position außerhalb des Codes
                        passes_filter = False
                else:
                    # Keine Position: Suche im gesamten Code (substring-Suche)
                    if value not in row['code']:
                        passes_filter = False
                
                if not passes_filter:
                    is_compatible = False
            
            # Allowed-Pattern Filter (prüfe aktuellen Code)
            if request.allowed_pattern:
                if not check_allowed_pattern(row['code'], request.allowed_pattern):
                    is_compatible = False
            
            # Hole ALLE Node-IDs mit diesem Code auf diesem Level in dieser Familie
            # (Wird sowohl für Parent-Filter als auch für Bulk-Update benötigt)
            all_ids_query = """
                SELECT DISTINCT n.id
                FROM nodes n
                LEFT JOIN node_paths np ON np.descendant_id = n.id
                WHERE n.code = ?
                  AND n.level = ?
                  AND EXISTS (
                      SELECT 1 FROM nodes fam
                      WHERE fam.code = ?
                        AND fam.level = 0
                        AND np.ancestor_id = fam.id
                  )
            """
            all_ids_result = conn.execute(all_ids_query, (row['code'], request.level, request.family_code)).fetchall()
            all_ids = [r['id'] for r in all_ids_result]
            
            # Parent-Level-Patterns und Parent-Level-Options Filter
            # WICHTIG: Es kann mehrere Nodes mit demselben Code geben!
            # Wir müssen prüfen ob MINDESTENS EINE Node die Parent-Filter erfüllt
            if request.parent_level_patterns or request.parent_level_options:
                # Prüfe ob mindestens EINE dieser Nodes die Parent-Filter erfüllt
                at_least_one_compatible = False
                
                for node_id in all_ids:
                    node_compatible = True
                    
                    # Hole Parent-Codes für diese spezifische Node
                    parent_codes_query = """
                        SELECT p.level, p.code
                        FROM nodes n
                        JOIN node_paths np ON np.descendant_id = n.id AND np.depth > 0
                        JOIN nodes p ON p.id = np.ancestor_id
                        WHERE n.id = ?
                          AND p.code IS NOT NULL
                        ORDER BY p.level
                    """
                    parent_results = conn.execute(parent_codes_query, (node_id,)).fetchall()
                    parent_codes_by_level = {p['level']: p['code'] for p in parent_results}
                    
                    # Prüfe parent_level_patterns für diese Node
                    if request.parent_level_patterns:
                        for level, pattern_config in request.parent_level_patterns.items():
                            level_int = int(level)
                            parent_code = parent_codes_by_level.get(level_int)
                            
                            if parent_code is None:
                                node_compatible = False
                                break
                            
                            # pattern_config kann int (alte API) oder dict sein
                            if isinstance(pattern_config, dict):
                                length_str = pattern_config.get('length', '')
                                pattern_type = pattern_config.get('type', '')
                                
                                # Prüfe Länge (exakt oder Range)
                                if length_str:
                                    if '-' in str(length_str):
                                        # Range: z.B. "2-4"
                                        parts = str(length_str).split('-')
                                        if len(parts) == 2:
                                            try:
                                                min_len = int(parts[0])
                                                max_len = int(parts[1])
                                                if not (min_len <= len(parent_code) <= max_len):
                                                    node_compatible = False
                                                    break
                                            except ValueError:
                                                node_compatible = False
                                                break
                                    else:
                                        # Exakte Länge
                                        try:
                                            expected_len = int(length_str)
                                            if len(parent_code) != expected_len:
                                                node_compatible = False
                                                break
                                        except ValueError:
                                            node_compatible = False
                                            break
                                
                                # Prüfe Pattern-Type (wenn angegeben)
                                if pattern_type:
                                    if not check_parent_level_option(parent_code, {'pattern': pattern_type}):
                                        node_compatible = False
                                        break
                            else:
                                # Rückwärtskompatibilität: int = exakte Länge
                                expected_pattern = int(pattern_config)
                                if len(parent_code) != expected_pattern:
                                    node_compatible = False
                                    break
                    
                    # Prüfe parent_level_options für diese Node (exakte Codes oder Prefix mit *)
                    if node_compatible and request.parent_level_options:
                        for level, allowed_options in request.parent_level_options.items():
                            level_int = int(level)
                            parent_code = parent_codes_by_level.get(level_int)
                            
                            if parent_code is None:
                                node_compatible = False
                                break
                            
                            # Prüfe ob parent_code mit einem der Patterns übereinstimmt
                            matches_any = False
                            for option in allowed_options:
                                if '*' in option:
                                    # Wildcard-Matching: "M1*" bedeutet startet mit "M1"
                                    prefix = option.replace('*', '')
                                    if parent_code.startswith(prefix):
                                        matches_any = True
                                        break
                                else:
                                    # Exakte Übereinstimmung
                                    if parent_code == option:
                                        matches_any = True
                                        break
                            
                            if not matches_any:
                                node_compatible = False
                                break
                    
                    # Wenn diese Node kompatibel ist, haben wir mindestens eine gefunden
                    if node_compatible:
                        at_least_one_compatible = True
                        break  # Wir brauchen nur EINE kompatible
                
                # Setze is_compatible basierend auf Ergebnis
                if not at_least_one_compatible:
                    is_compatible = False
            
            nodes.append(AvailableOption(
                id=row['id'],
                ids=all_ids,  # ALLE IDs mit diesem Code!
                code=row['code'],
                label=row['label'],
                label_en=row['label_en'],
                name=row['name'],
                group_name=row['group_name'],
                level=row['level'],
                position=row['position'],
                is_compatible=is_compatible,  # Basierend auf erweiterten Filtern!
                parent_pattern=row['parent_pattern']
            ))
        
        return BulkFilterResponse(
            nodes=nodes,
            count=len(nodes)
        )
    
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Bulk filter failed: {str(e)}"
        )
    finally:
        conn.close()


# ============================================================
# Bulk Update Nodes - Mehrere Nodes gleichzeitig aktualisieren
# WICHTIG: Muss VOR /api/nodes/{node_id} stehen!
# ============================================================
@app.put("/api/nodes/bulk-update", response_model=BulkUpdateResponse)
def bulk_update_nodes(request: BulkUpdateRequest):
    """
    Aktualisiert mehrere Nodes gleichzeitig.
    
    Unterstützt zwei Modi:
    1. Direktes Setzen (name, label, label_en, group_name)
    2. Anhängen (append_name, append_label, append_label_en, append_group_name)
    
    WICHTIG: Code kann NICHT per Bulk geändert werden (zu riskant!)
    """
    if not request.node_ids:
        raise HTTPException(status_code=400, detail="No node IDs provided")
    
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # Prüfe ob append-Felder verwendet werden
        has_append = any([
            request.updates.append_name,
            request.updates.append_label,
            request.updates.append_label_en,
            request.updates.append_group_name
        ])
        
        updated_count = 0
        
        if has_append:
            # APPEND-Modus: Jeden Node einzeln updaten (wegen bestehende Werte lesen)
            for node_id in request.node_ids:
                # Hole aktuelle Werte
                node = cursor.execute(
                    "SELECT name, label, label_en, group_name FROM nodes WHERE id = ?",
                    (node_id,)
                ).fetchone()
                
                if not node:
                    continue
                
                updates = []
                params = []
                
                # Append Name (mit Leerzeichen)
                if request.updates.append_name:
                    current_name = node['name'] or ''
                    new_name = f"{current_name} {request.updates.append_name}".strip()
                    updates.append("name = ?")
                    params.append(new_name)
                
                # Append Label (mit \n\n)
                if request.updates.append_label:
                    current_label = node['label'] or ''
                    new_label = f"{current_label}\n\n{request.updates.append_label}".strip()
                    updates.append("label = ?")
                    params.append(new_label)
                
                # Append Label EN (mit \n\n)
                if request.updates.append_label_en:
                    current_label_en = node['label_en'] or ''
                    new_label_en = f"{current_label_en}\n\n{request.updates.append_label_en}".strip()
                    updates.append("label_en = ?")
                    params.append(new_label_en)
                
                # Append Group Name (mit Leerzeichen)
                if request.updates.append_group_name:
                    current_group = node['group_name'] or ''
                    new_group = f"{current_group} {request.updates.append_group_name}".strip()
                    updates.append("group_name = ?")
                    params.append(new_group)
                
                if updates:
                    params.append(node_id)
                    query = f"UPDATE nodes SET {', '.join(updates)} WHERE id = ?"
                    cursor.execute(query, params)
                    updated_count += cursor.rowcount
        else:
            # DIREKTER SET-Modus: Batch-Update
            update_fields = []
            params = []
            
            # WICHTIG: Auch leere Strings sind gültig (zum Löschen)
            if request.updates.name is not None:
                update_fields.append("name = ?")
                params.append(request.updates.name)
            
            if request.updates.label is not None:
                update_fields.append("label = ?")
                params.append(request.updates.label)
            
            if request.updates.label_en is not None:
                update_fields.append("label_en = ?")
                params.append(request.updates.label_en)
            
            if request.updates.group_name is not None:
                update_fields.append("group_name = ?")
                params.append(request.updates.group_name)
            
            print(f"[BULK UPDATE] update_fields: {update_fields}, params: {params[:len(update_fields)]}")
            
            if not update_fields:
                raise HTTPException(status_code=400, detail="No valid update fields")
            
            # Batch Update
            placeholders = ','.join('?' * len(request.node_ids))
            params.extend(request.node_ids)
            
            query = f"""
                UPDATE nodes
                SET {', '.join(update_fields)}
                WHERE id IN ({placeholders})
            """
            
            print(f"[BULK UPDATE] Executing query: {query}")
            print(f"[BULK UPDATE] Full params: {params}")
            
            cursor.execute(query, params)
            updated_count = cursor.rowcount
        
        conn.commit()
        
        return BulkUpdateResponse(
            success=True,
            updated_count=updated_count,
            message=f"Successfully updated {updated_count} nodes"
        )
    
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    
    finally:
        conn.close()


# ============================================================
# Update Node - Knoten aktualisieren
# ============================================================
@app.put("/api/nodes/{node_id}", response_model=UpdateNodeResponse)
def update_node(node_id: int, request: UpdateNodeRequest):
    """
    Aktualisiert einen bestehenden Knoten.
    Nur die übergebenen Felder werden aktualisiert.
    
    WICHTIG: 
    - Code-Änderungen sind NICHT erlaubt (würde Pattern und Referenzen brechen)
    - Group Name Änderungen werden auf alle Nachkommen propagiert
    """
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # Prüfe ob Node existiert und hole aktuelle Daten
        existing = cursor.execute(
            "SELECT id, code, group_name FROM nodes WHERE id = ?", 
            (node_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail=f"Node with ID {node_id} not found")
        
        # WICHTIG: Code-Änderungen verbieten!
        if request.code is not None and request.code != existing['code']:
            raise HTTPException(
                status_code=400, 
                detail="Code changes are not allowed. Delete and recreate the node instead."
            )
        
        # Baue UPDATE Query nur mit übergebenen Feldern
        updates = []
        params = []
        
        if request.name is not None:
            updates.append("name = ?")
            params.append(request.name)
        
        if request.label is not None:
            updates.append("label = ?")
            params.append(request.label)
        
        if request.label_en is not None:
            updates.append("label_en = ?")
            params.append(request.label_en)
        
        # Group Name: Propagiere auf alle Nachkommen
        if request.group_name is not None and request.group_name != existing['group_name']:
            updates.append("group_name = ?")
            params.append(request.group_name)
            
            # UPDATE auch alle Nachkommen (alle Nodes die diesen Node als Ancestor haben)
            cursor.execute("""
                UPDATE nodes 
                SET group_name = ?
                WHERE id IN (
                    SELECT descendant_id 
                    FROM node_paths 
                    WHERE ancestor_id = ? AND ancestor_id != descendant_id
                )
            """, (request.group_name, node_id))
        
        if not updates:
            return UpdateNodeResponse(
                success=True,
                message="No fields to update"
            )
        
        # Führe UPDATE auf dem Hauptknoten aus
        params.append(node_id)
        query = f"UPDATE nodes SET {', '.join(updates)} WHERE id = ?"
        cursor.execute(query, params)
        conn.commit()
        
        return UpdateNodeResponse(
            success=True,
            message=f"Node {node_id} updated successfully"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update node: {str(e)}"
        )
    finally:
        conn.close()


# ============================================================
# Create Node With Children - Deep Copy mit Closure Table
# ============================================================
@app.post("/api/nodes/with-children", response_model=CreateNodeResponse)
def create_node_with_children(request: CreateNodeWithChildrenRequest):
    """
    Erstellt einen neuen Knoten und kopiert ganzen Subtree von Source Node.
    
    Verwendet Closure Table für effizienten Deep Copy (keine Rekursion!):
    1. Eine Query holt alle Descendants vom Source Node
    2. Simple Loop erstellt neue Nodes (sortiert nach depth)
    3. ID-Mapping (alt → neu) für parent_id Lookup
    4. Batch Insert für Closure Table Paths
    
    Performance: O(N) - sehr effizient auch für große Subtrees!
    """
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # 1. Erstelle neuen Parent Node
        cursor.execute("""
            INSERT INTO nodes (code, name, label, label_en, level, parent_id, position, pattern, group_name)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            request.code,
            request.name,
            request.label,
            request.label_en,
            request.level,
            request.parent_id,
            request.position,
            request.pattern,
            request.group_name
        ))
        
        new_parent_id = cursor.lastrowid
        
        # Closure Table für Parent (self-reference oder via Trigger)
        if request.parent_id is None:
            cursor.execute("""
                INSERT INTO node_paths (ancestor_id, descendant_id, depth)
                VALUES (?, ?, 0)
            """, (new_parent_id, new_parent_id))
        
        # 2. Hole nur den Source Node selbst (KEINE Children!)
        # Der User wählt im Frontend schrittweise aus wie tief kopiert werden soll
        # Wenn er ZABC auswählt → nur ZABC kopieren
        # Wenn er ZABC → 333 auswählt → sourceId ist 333 → nur 333 kopieren
        descendants = cursor.execute("""
            SELECT 
                n.id,
                n.code,
                n.name,
                n.label,
                n.label_en,
                n.level,
                n.parent_id,
                n.position,
                n.pattern,
                n.group_name,
                0 as depth
            FROM nodes n
            WHERE n.id = ?
        """, (request.source_node_id,)).fetchall()
        
        if not descendants:
            # Kein Subtree vorhanden - nur Parent erstellt
            conn.commit()
            return CreateNodeResponse(
                success=True,
                node_id=new_parent_id,
                message=f"Node created (no children to copy)",
                nodes_created=1
            )
        
        # 3. ID-Mapping: {alte_id → neue_id}
        # Wichtig: Source Node wird als Kind vom new_parent erstellt, nicht als Ersatz!
        old_to_new = {}
        
        # 4. Loop durch Descendants (depth-sortiert!)
        for desc in descendants:
            old_id = desc['id']
            old_parent_id = desc['parent_id']
            
            # Spezialfall: Source Node selbst (depth=0) wird Kind vom neuen Parent
            if desc['depth'] == 0:
                new_desc_parent_id = new_parent_id
            else:
                # Lookup new parent_id im Mapping
                new_desc_parent_id = old_to_new.get(old_parent_id)
                if new_desc_parent_id is None:
                    raise HTTPException(status_code=500, detail=f"Parent mapping not found for {old_id}")
            
            # INSERT neuer Node
            cursor.execute("""
                INSERT INTO nodes (code, name, label, label_en, level, parent_id, position, pattern, group_name)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                desc['code'],
                desc['name'],
                desc['label'],
                desc['label_en'],
                desc['level'],
                new_desc_parent_id,  # Gemappter Parent!
                desc['position'],
                desc['pattern'],
                desc['group_name']
            ))
            
            new_desc_id = cursor.lastrowid
            old_to_new[old_id] = new_desc_id
        
        # 5. Closure Table Paths erstellen
        # Für jeden neuen Node: Kopiere alle Paths vom alten Node
        for old_id, new_id in old_to_new.items():
            # Hole alle ancestor paths vom alten Node
            old_paths = cursor.execute("""
                SELECT ancestor_id, depth
                FROM node_paths
                WHERE descendant_id = ?
            """, (old_id,)).fetchall()
            
            for path in old_paths:
                old_ancestor_id = path['ancestor_id']
                depth = path['depth']
                
                # Mappe ancestor_id (oder nutze new_parent_id für externe Ancestors)
                if old_ancestor_id in old_to_new:
                    new_ancestor_id = old_to_new[old_ancestor_id]
                else:
                    # Ancestor außerhalb des kopierten Subtrees (z.B. Großeltern)
                    # Diese müssen auch verbunden werden!
                    if request.parent_id is not None:
                        # Hole alle Ancestors des neuen Parents
                        parent_ancestors = cursor.execute("""
                            SELECT ancestor_id, depth
                            FROM node_paths
                            WHERE descendant_id = ?
                        """, (new_parent_id,)).fetchall()
                        
                        for pa in parent_ancestors:
                            # Depth = parent_ancestor_depth + 1 + desc_depth_in_subtree
                            desc_depth_in_subtree = cursor.execute("""
                                SELECT depth FROM node_paths
                                WHERE ancestor_id = ? AND descendant_id = ?
                            """, (request.source_node_id, old_id)).fetchone()['depth']
                            
                            total_depth = pa['depth'] + 1 + desc_depth_in_subtree
                            
                            cursor.execute("""
                                INSERT OR IGNORE INTO node_paths (ancestor_id, descendant_id, depth)
                                VALUES (?, ?, ?)
                            """, (pa['ancestor_id'], new_id, total_depth))
                    continue
                
                cursor.execute("""
                    INSERT OR IGNORE INTO node_paths (ancestor_id, descendant_id, depth)
                    VALUES (?, ?, ?)
                """, (new_ancestor_id, new_id, depth))
        
        conn.commit()
        
        total_created = len(descendants) + 1  # Descendants (inkl. source node) + Parent
        
        return CreateNodeResponse(
            success=True,
            node_id=new_parent_id,
            message=f"Node created with {len(descendants)} children copied",
            nodes_created=total_created
        )
        
    except Exception as e:
        conn.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create node with children: {str(e)}"
        )
    finally:
        conn.close()


# ============================================================
# Get Subtree Info - Preview für Deep Copy
# ============================================================
@app.get("/api/nodes/{node_id}/subtree-info", response_model=SubtreeInfo)
def get_subtree_info(node_id: int):
    """
    Gibt Info über Subtree eines Nodes zurück (für Preview).
    Zeigt wie viele Nodes kopiert würden und wie tief der Tree ist.
    """
    conn = get_db()
    
    try:
        # Hole Node Info
        node = conn.execute("""
            SELECT id, code, label
            FROM nodes
            WHERE id = ?
        """, (node_id,)).fetchone()
        
        if not node:
            raise HTTPException(status_code=404, detail=f"Node {node_id} not found")
        
        # Zähle Descendants und finde maximale Tiefe
        stats = conn.execute("""
            SELECT 
                COUNT(DISTINCT np.descendant_id) - 1 as descendant_count,
                COALESCE(MAX(np.depth), 0) as tree_depth
            FROM node_paths np
            WHERE np.ancestor_id = ?
        """, (node_id,)).fetchone()
        
        return SubtreeInfo(
            node_id=node['id'],
            code=node['code'],
            label=node['label'],
            descendant_count=stats['descendant_count'],
            tree_depth=stats['tree_depth']
        )
        
    finally:
        conn.close()


# ============================================================
# Constraint Helper Functions
# ============================================================

def expand_code_range(range_str: str) -> List[str]:
    """
    Expandiert einen Code-Range String zu einer Liste aller Codes.
    
    Unterstützte Formate:
    - C010-C020: Numerischer Bereich mit Prefix
    - A-X: Alphabetischer Bereich
    - 0-Z: Alphanumerischer Bereich
    - Z0-ZZ: Komplexe alphanumerische Kombinationen
    - PS001-PS999: Längere Prefixe mit numerischem Bereich
    
    Returns:
        List[str]: Alle Codes im Bereich
    """
    if '-' not in range_str:
        return [range_str]  # Einzelner Code
    
    try:
        start_str, end_str = range_str.split('-', 1)
        
        # Finde gemeinsamen Prefix
        prefix = ""
        i = 0
        while i < min(len(start_str), len(end_str)) and start_str[i] == end_str[i]:
            if not start_str[i].isdigit():
                prefix += start_str[i]
                i += 1
            else:
                break
        
        # Suffix nach Prefix
        start_suffix = start_str[len(prefix):]
        end_suffix = end_str[len(prefix):]
        
        codes = []
        
        # Prüfe ob numerischer Bereich
        if start_suffix.isdigit() and end_suffix.isdigit():
            start_num = int(start_suffix)
            end_num = int(end_suffix)
            width = len(start_suffix)  # Padding-Breite
            
            for num in range(start_num, end_num + 1):
                codes.append(f"{prefix}{str(num).zfill(width)}")
        
        # Alphabetischer Bereich (A-Z)
        elif len(start_suffix) == 1 and len(end_suffix) == 1 and start_suffix.isalpha() and end_suffix.isalpha():
            start_ord = ord(start_suffix.upper())
            end_ord = ord(end_suffix.upper())
            
            for i in range(start_ord, end_ord + 1):
                codes.append(f"{prefix}{chr(i)}")
        
        # Alphanumerischer Bereich (0-9, A-Z)
        elif len(start_suffix) == 1 and len(end_suffix) == 1:
            chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
            try:
                start_idx = chars.index(start_suffix.upper())
                end_idx = chars.index(end_suffix.upper())
                
                for i in range(start_idx, end_idx + 1):
                    codes.append(f"{prefix}{chars[i]}")
            except ValueError:
                # Fallback: nur Start und End
                codes = [start_str, end_str]
        
        # Komplexe Kombinationen (Z0-ZZ)
        else:
            # Generiere alle Kombinationen (limitiert auf max 1000)
            if len(start_suffix) <= 2 and len(end_suffix) <= 2:
                chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
                
                # 1-stellig zu 2-stellig
                if len(start_suffix) == 1 and len(end_suffix) == 2:
                    # Erst alle 1-stelligen ab Start
                    start_idx = chars.index(start_suffix.upper())
                    for i in range(start_idx, len(chars)):
                        codes.append(f"{prefix}{chars[i]}")
                    
                    # Dann alle 2-stelligen bis End
                    for c1 in chars:
                        for c2 in chars:
                            code = f"{c1}{c2}"
                            if code <= end_suffix.upper():
                                codes.append(f"{prefix}{code}")
                            if len(codes) > 1000:
                                break
                        if len(codes) > 1000:
                            break
                
                # Beide 2-stellig
                elif len(start_suffix) == 2 and len(end_suffix) == 2:
                    for c1 in chars:
                        for c2 in chars:
                            code = f"{c1}{c2}"
                            if start_suffix.upper() <= code <= end_suffix.upper():
                                codes.append(f"{prefix}{code}")
                            if len(codes) > 1000:
                                break
                        if len(codes) > 1000:
                            break
            else:
                # Zu komplex, nur Start und End
                codes = [start_str, end_str]
        
        return codes if codes else [start_str, end_str]
    
    except Exception as e:
        print(f"Error expanding range '{range_str}': {e}")
        return [range_str]  # Fallback auf Original


def check_pattern_match(code_length: int, pattern_value: str) -> bool:
    """
    Prüft ob eine Code-Länge einem Pattern entspricht.
    
    Args:
        code_length: Länge des Codes
        pattern_value: Pattern-String (z.B. "5", "4-6")
    
    Returns:
        bool: True wenn Pattern matcht
    """
    if '-' in pattern_value:
        # Range: "4-6"
        try:
            min_len, max_len = map(int, pattern_value.split('-'))
            return min_len <= code_length <= max_len
        except:
            return False
    else:
        # Exact: "5"
        try:
            return code_length == int(pattern_value)
        except:
            return False


def validate_code_against_constraints(
    code: str,
    level: int,
    previous_selections: dict,
    conn
) -> ConstraintValidationResult:
    """
    Prüft ob ein Code gegen definierte Constraints verstößt.
    
    Args:
        code: Der zu prüfende Code
        level: Level auf dem der Code erstellt werden soll
        previous_selections: Dict {level: code} der vorherigen Auswahlen
        conn: Datenbankverbindung
    
    Returns:
        ConstraintValidationResult mit is_valid und violated_constraints
    """
    # Hole alle Constraints für dieses Level
    constraints_rows = conn.execute("""
        SELECT id, level, mode, description, created_at, updated_at
        FROM constraints
        WHERE level = ?
    """, (level,)).fetchall()
    
    if not constraints_rows:
        return ConstraintValidationResult(is_valid=True)
    
    violated = []
    
    for constraint_row in constraints_rows:
        constraint_id = constraint_row['id']
        
        # Hole Bedingungen
        conditions_rows = conn.execute("""
            SELECT condition_type, target_level, value
            FROM constraint_conditions
            WHERE constraint_id = ?
        """, (constraint_id,)).fetchall()
        
        # Prüfe ob ALLE Bedingungen erfüllt sind
        all_conditions_met = True
        
        for cond in conditions_rows:
            target_level = cond['target_level']
            condition_type = cond['condition_type']
            value = cond['value']
            
            # Hole den Code vom target_level
            target_code = previous_selections.get(target_level)
            
            if target_code is None:
                all_conditions_met = False
                break
            
            # Prüfe Bedingung
            if condition_type == 'exact_code':
                if target_code != value:
                    all_conditions_met = False
                    break
            
            elif condition_type == 'prefix':
                if not target_code.startswith(value):
                    all_conditions_met = False
                    break
            
            elif condition_type == 'pattern':
                if not check_pattern_match(len(target_code), value):
                    all_conditions_met = False
                    break
        
        # Wenn alle Bedingungen erfüllt -> Constraint gilt!
        if all_conditions_met:
            # Hole erlaubte/verbotene Codes
            codes_rows = conn.execute("""
                SELECT code_type, code_value
                FROM constraint_codes
                WHERE constraint_id = ?
            """, (constraint_id,)).fetchall()
            
            # Expandiere Ranges
            all_codes = []
            for code_row in codes_rows:
                if code_row['code_type'] == 'single':
                    all_codes.append(code_row['code_value'])
                elif code_row['code_type'] == 'range':
                    all_codes.extend(expand_code_range(code_row['code_value']))
            
            # Prüfe Mode
            mode = constraint_row['mode']
            
            if mode == 'allow':
                # Whitelist: Code MUSS in Liste sein
                if code not in all_codes:
                    # Hole vollständiges Constraint-Objekt
                    conditions = [
                        ConstraintCondition(
                            condition_type=c['condition_type'],
                            target_level=c['target_level'],
                            value=c['value']
                        ) for c in conditions_rows
                    ]
                    codes = [
                        ConstraintCode(
                            code_type=c['code_type'],
                            code_value=c['code_value']
                        ) for c in codes_rows
                    ]
                    
                    violated.append(Constraint(
                        id=constraint_id,
                        level=constraint_row['level'],
                        mode=constraint_row['mode'],
                        description=constraint_row['description'],
                        conditions=conditions,
                        codes=codes
                    ))
            
            elif mode == 'deny':
                # Blacklist: Code darf NICHT in Liste sein
                if code in all_codes:
                    conditions = [
                        ConstraintCondition(
                            condition_type=c['condition_type'],
                            target_level=c['target_level'],
                            value=c['value']
                        ) for c in conditions_rows
                    ]
                    codes = [
                        ConstraintCode(
                            code_type=c['code_type'],
                            code_value=c['code_value']
                        ) for c in codes_rows
                    ]
                    
                    violated.append(Constraint(
                        id=constraint_id,
                        level=constraint_row['level'],
                        mode=constraint_row['mode'],
                        description=constraint_row['description'],
                        conditions=conditions,
                        codes=codes
                    ))
    
    if violated:
        msg = f"Code '{code}' verstößt gegen {len(violated)} Constraint(s)"
        return ConstraintValidationResult(
            is_valid=False,
            violated_constraints=violated,
            message=msg
        )
    
    return ConstraintValidationResult(is_valid=True)


# ============================================================
# Constraint CRUD Endpoints
# ============================================================

@app.get("/api/constraints/level/{level}", response_model=List[Constraint])
def get_constraints_for_level(level: int):
    """
    Holt alle Constraints für ein bestimmtes Level.
    """
    conn = get_db()
    
    try:
        # Hole alle Constraints
        constraints_rows = conn.execute("""
            SELECT id, level, mode, description, created_at, updated_at
            FROM constraints
            WHERE level = ?
            ORDER BY id
        """, (level,)).fetchall()
        
        constraints = []
        
        for row in constraints_rows:
            constraint_id = row['id']
            
            # Hole Conditions
            conditions_rows = conn.execute("""
                SELECT id, condition_type, target_level, value
                FROM constraint_conditions
                WHERE constraint_id = ?
            """, (constraint_id,)).fetchall()
            
            conditions = [
                ConstraintCondition(
                    id=c['id'],
                    condition_type=c['condition_type'],
                    target_level=c['target_level'],
                    value=c['value']
                ) for c in conditions_rows
            ]
            
            # Hole Codes
            codes_rows = conn.execute("""
                SELECT id, code_type, code_value
                FROM constraint_codes
                WHERE constraint_id = ?
            """, (constraint_id,)).fetchall()
            
            codes = [
                ConstraintCode(
                    id=c['id'],
                    code_type=c['code_type'],
                    code_value=c['code_value']
                ) for c in codes_rows
            ]
            
            constraints.append(Constraint(
                id=row['id'],
                level=row['level'],
                mode=row['mode'],
                description=row['description'],
                conditions=conditions,
                codes=codes,
                created_at=row['created_at'],
                updated_at=row['updated_at']
            ))
        
        return constraints
    
    except Exception as e:
        print(f"[ERROR] get_constraints_for_level: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to load constraints: {str(e)}")
    
    finally:
        conn.close()


@app.post("/api/constraints", response_model=Constraint)
def create_constraint(request: CreateConstraintRequest):
    """
    Erstellt eine neue Constraint-Regel.
    """
    print(f"[CREATE CONSTRAINT] Request: {request}")
    
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # Insert Constraint
        cursor.execute("""
            INSERT INTO constraints (level, mode, description)
            VALUES (?, ?, ?)
        """, (request.level, request.mode, request.description))
        
        constraint_id = cursor.lastrowid
        print(f"[CREATE CONSTRAINT] Created constraint ID: {constraint_id}")
        
        # Insert Conditions
        for cond in request.conditions:
            cursor.execute("""
                INSERT INTO constraint_conditions (constraint_id, condition_type, target_level, value)
                VALUES (?, ?, ?, ?)
            """, (constraint_id, cond.condition_type, cond.target_level, cond.value))
        
        # Insert Codes
        for code in request.codes:
            cursor.execute("""
                INSERT INTO constraint_codes (constraint_id, code_type, code_value)
                VALUES (?, ?, ?)
            """, (constraint_id, code.code_type, code.code_value))
        
        conn.commit()
        print(f"[CREATE CONSTRAINT] Committed to database")
        
        # Schließe Verbindung BEVOR wir get_constraints_for_level aufrufen
        conn.close()
        
        # Hole vollständiges Constraint-Objekt (öffnet neue Verbindung)
        result = get_constraints_for_level(request.level)
        created = next((c for c in result if c.id == constraint_id), None)
        
        if not created:
            raise HTTPException(status_code=500, detail="Failed to retrieve created constraint")
        
        print(f"[CREATE CONSTRAINT] Success: {created}")
        return created
    
    except Exception as e:
        print(f"[ERROR] create_constraint: {e}")
        import traceback
        traceback.print_exc()
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create constraint: {str(e)}")
    
    finally:
        if conn:
            conn.close()


@app.put("/api/constraints/{constraint_id}", response_model=Constraint)
def update_constraint(constraint_id: int, request: CreateConstraintRequest):
    """
    Aktualisiert eine bestehende Constraint-Regel.
    """
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # Update Constraint
        cursor.execute("""
            UPDATE constraints
            SET mode = ?, description = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (request.mode, request.description, constraint_id))
        
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Constraint not found")
        
        # Lösche alte Conditions und Codes
        cursor.execute("DELETE FROM constraint_conditions WHERE constraint_id = ?", (constraint_id,))
        cursor.execute("DELETE FROM constraint_codes WHERE constraint_id = ?", (constraint_id,))
        
        # Insert neue Conditions
        for cond in request.conditions:
            cursor.execute("""
                INSERT INTO constraint_conditions (constraint_id, condition_type, target_level, value)
                VALUES (?, ?, ?, ?)
            """, (constraint_id, cond.condition_type, cond.target_level, cond.value))
        
        # Insert neue Codes
        for code in request.codes:
            cursor.execute("""
                INSERT INTO constraint_codes (constraint_id, code_type, code_value)
                VALUES (?, ?, ?)
            """, (constraint_id, code.code_type, code.code_value))
        
        conn.commit()
        
        # Hole aktualisiertes Constraint
        result = get_constraints_for_level(request.level)
        updated = next((c for c in result if c.id == constraint_id), None)
        
        if not updated:
            raise HTTPException(status_code=500, detail="Failed to retrieve updated constraint")
        
        return updated
    
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update constraint: {str(e)}")
    
    finally:
        conn.close()


@app.delete("/api/constraints/{constraint_id}")
def delete_constraint(constraint_id: int):
    """
    Löscht eine Constraint-Regel (CASCADE löscht auch Conditions und Codes).
    """
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        cursor.execute("DELETE FROM constraints WHERE id = ?", (constraint_id,))
        
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Constraint not found")
        
        conn.commit()
        
        return {"success": True, "message": f"Constraint {constraint_id} deleted"}
    
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete constraint: {str(e)}")
    
    finally:
        conn.close()


@app.post("/api/constraints/validate", response_model=ConstraintValidationResult)
def validate_code(request: ConstraintValidationRequest):
    """
    Validiert einen Code gegen alle Constraints für ein Level.
    
    Args:
        request: ValidationRequest mit code, level, previous_selections
    """
    conn = get_db()
    
    try:
        result = validate_code_against_constraints(
            request.code, 
            request.level, 
            request.previous_selections, 
            conn
        )
        return result
    
    finally:
        conn.close()


# ============================================================
# Health Check
# ============================================================
@app.get("/api/health", response_model=HealthResponse)
def health_check():
    """
    Prüft ob Datenbank erreichbar ist und zeigt Statistiken.
    """
    try:
        conn = get_db()
        
        total_nodes = conn.execute("SELECT COUNT(*) as count FROM nodes").fetchone()['count']
        total_paths = conn.execute("SELECT COUNT(*) as count FROM node_paths").fetchone()['count']
        
        conn.close()
        
        return HealthResponse(
            status="healthy",
            database="connected",
            total_nodes=total_nodes,
            total_paths=total_paths
        )
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Database unhealthy: {str(e)}"
        )


# ============================================================
# Bild-Upload Endpoints (Admin)
# ============================================================

class PictureInfo(BaseModel):
    """Info über ein hochgeladenes Bild"""
    url: str
    description: Optional[str] = None
    uploaded_at: str

class LinkInfo(BaseModel):
    """Info über einen Link"""
    url: str
    title: str
    description: Optional[str] = None
    added_at: Optional[str] = None

@app.post("/api/nodes/{node_id}/upload-image")
async def upload_node_image(
    node_id: int,
    file: UploadFile = File(...),
    description: Optional[str] = Form(None)
):
    """
    Lädt ein Bild für einen Node hoch und speichert die URL in der Datenbank.
    Unterstützt lokalen Upload (Entwicklung) und Azure Blob Storage (Produktion).
    
    Args:
        node_id: Node ID in der Datenbank
        file: Hochzuladende Bilddatei
        description: Optionale Beschreibung des Bildes
        
    Returns:
        PictureInfo: URL und Metadaten des hochgeladenen Bildes
    """
    # Validiere Dateityp
    allowed_extensions = {'.png', '.jpg', '.jpeg', '.gif', '.webp'}
    file_ext = Path(file.filename).suffix.lower()
    
    if file_ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Ungültiger Dateityp. Erlaubt: {', '.join(allowed_extensions)}"
        )
    
    # Generiere eindeutigen Dateinamen
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_filename = f"node_{node_id}_{timestamp}{file_ext}"
    
    # Upload-Logik: Azure oder Lokal
    uploaded_at = datetime.now().isoformat()
    
    if blob_service:
        # PRODUKTION: Upload zu Azure Blob Storage
        try:
            # Lese Datei-Inhalt
            file_content = await file.read()
            
            # Upload zu Azure Blob
            blob_client = blob_service.get_blob_client(
                container="uploads",
                blob=safe_filename
            )
            blob_client.upload_blob(file_content, overwrite=True)
            
            # Azure URL (absolut)
            file_url = blob_client.url
            
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Azure Upload Fehler: {str(e)}"
            )
    else:
        # ENTWICKLUNG: Upload zu lokalem uploads/ Ordner
        file_path = UPLOADS_DIR / safe_filename
        
        try:
            with file_path.open("wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            
            # Relativer Pfad (wird vom Frontend mit API_BASE_URL kombiniert)
            file_url = f"/uploads/{safe_filename}"
            
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Lokaler Upload Fehler: {str(e)}"
            )
    
    # Speichere in Datenbank (in pictures JSON array)
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Prüfe ob Node existiert
        cursor.execute("SELECT id, pictures FROM nodes WHERE id = ?", (node_id,))
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail=f"Node {node_id} nicht gefunden")
        
        # Parse existierende Bilder (JSON)
        import json
        existing_pictures = json.loads(row[1]) if row[1] else []
        
        # Füge neues Bild hinzu
        new_picture = {
            "url": file_url,
            "description": description,
            "uploaded_at": uploaded_at
        }
        existing_pictures.append(new_picture)
        
        # Update in DB
        cursor.execute(
            "UPDATE nodes SET pictures = ? WHERE id = ?",
            (json.dumps(existing_pictures), node_id)
        )
        conn.commit()
        conn.close()
        
        return PictureInfo(
            url=file_url,
            description=description,
            uploaded_at=uploaded_at
        )
        
    except Exception as e:
        # Lösche Datei bei DB-Fehler
        if file_path.exists():
            file_path.unlink()
        raise HTTPException(
            status_code=500,
            detail=f"Datenbankfehler: {str(e)}"
        )


@app.delete("/api/nodes/{node_id}/images/{filename}")
async def delete_node_image(node_id: int, filename: str):
    """
    Löscht ein Bild von einem Node.
    
    Args:
        node_id: Node ID
        filename: Dateiname des zu löschenden Bildes
    """
    import json
    
    file_path = UPLOADS_DIR / filename
    file_url = f"/uploads/{filename}"
    
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Hole existierende Bilder
        cursor.execute("SELECT pictures FROM nodes WHERE id = ?", (node_id,))
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail=f"Node {node_id} nicht gefunden")
        
        existing_pictures = json.loads(row[0]) if row[0] else []
        
        # Entferne Bild aus Liste
        updated_pictures = [p for p in existing_pictures if p.get('url') != file_url]
        
        if len(updated_pictures) == len(existing_pictures):
            raise HTTPException(status_code=404, detail="Bild nicht in Datenbank gefunden")
        
        # Update DB
        cursor.execute(
            "UPDATE nodes SET pictures = ? WHERE id = ?",
            (json.dumps(updated_pictures), node_id)
        )
        conn.commit()
        conn.close()
        
        # Lösche Datei
        if file_path.exists():
            file_path.unlink()
        
        return {"message": "Bild erfolgreich gelöscht", "filename": filename}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Fehler beim Löschen: {str(e)}"
        )


# ============================================================
# Links Management
# ============================================================

@app.post("/api/nodes/{node_id}/links", response_model=LinkInfo)
async def add_node_link(
    node_id: int,
    url: str = Form(...),
    title: str = Form(...),
    description: Optional[str] = Form(None)
):
    """
    Fügt einen Link zu einem Node hinzu.
    
    Args:
        node_id: Node ID
        url: Link URL
        title: Link-Titel
        description: Optionale Beschreibung
    """
    import json
    from datetime import datetime
    
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Hole existierende Links
        cursor.execute("SELECT links FROM nodes WHERE id = ?", (node_id,))
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail=f"Node {node_id} nicht gefunden")
        
        existing_links = json.loads(row[0]) if row[0] else []
        
        # Erstelle neuen Link
        added_at = datetime.now().isoformat()
        new_link = {
            "url": url,
            "title": title,
            "description": description,
            "added_at": added_at
        }
        
        existing_links.append(new_link)
        
        # Update DB
        cursor.execute(
            "UPDATE nodes SET links = ? WHERE id = ?",
            (json.dumps(existing_links), node_id)
        )
        conn.commit()
        conn.close()
        
        return LinkInfo(
            url=url,
            title=title,
            description=description,
            added_at=added_at
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Fehler beim Hinzufügen des Links: {str(e)}"
        )


@app.delete("/api/nodes/{node_id}/links")
async def delete_node_link(node_id: int, url: str):
    """
    Löscht einen Link von einem Node.
    
    Args:
        node_id: Node ID
        url: URL des zu löschenden Links
    """
    import json
    
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Hole existierende Links
        cursor.execute("SELECT links FROM nodes WHERE id = ?", (node_id,))
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail=f"Node {node_id} nicht gefunden")
        
        existing_links = json.loads(row[0]) if row[0] else []
        
        # Entferne Link aus Liste
        updated_links = [l for l in existing_links if l.get('url') != url]
        
        if len(updated_links) == len(existing_links):
            raise HTTPException(status_code=404, detail="Link nicht gefunden")
        
        # Update DB
        cursor.execute(
            "UPDATE nodes SET links = ? WHERE id = ?",
            (json.dumps(updated_links), node_id)
        )
        conn.commit()
        conn.close()
        
        return {"message": "Link erfolgreich gelöscht", "url": url}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Fehler beim Löschen: {str(e)}"
        )


# ============================================================
# PRODUCT LIFECYCLE MANAGEMENT - Successor/Replacement Tracking
# ============================================================

# Pydantic Models
class SuccessorResponse(BaseModel):
    """Response model for successor information"""
    id: int
    source_node_id: int
    source_type: str
    target_node_id: Optional[int] = None
    target_full_code: Optional[str] = None
    target_family_code: Optional[str] = None
    replacement_type: str
    migration_note: Optional[str] = None
    migration_note_en: Optional[str] = None
    effective_date: Optional[str] = None
    show_warning: bool
    allow_old_selection: bool
    warning_severity: str
    # Enriched data
    target_name: Optional[str] = None
    target_label: Optional[str] = None
    target_code: Optional[str] = None

class CreateSuccessorRequest(BaseModel):
    """Request to create a new successor relationship"""
    source_node_id: int
    source_type: str  # 'node', 'leaf', 'intermediate'
    target_node_id: Optional[int] = None
    target_full_code: Optional[str] = None
    replacement_type: str  # 'successor', 'alternative', 'deprecated'
    migration_note: Optional[str] = None
    migration_note_en: Optional[str] = None
    effective_date: Optional[str] = None
    show_warning: bool = True
    allow_old_selection: bool = True
    warning_severity: str = "info"  # 'info', 'warning', 'critical'

class UpdateSuccessorRequest(BaseModel):
    """Request to update an existing successor relationship"""
    replacement_type: Optional[str] = None
    migration_note: Optional[str] = None
    migration_note_en: Optional[str] = None
    effective_date: Optional[str] = None
    show_warning: Optional[bool] = None
    allow_old_selection: Optional[bool] = None
    warning_severity: Optional[str] = None

class CreateSuccessorBulkRequest(BaseModel):
    """Create successor relationships using pre-filtered node IDs from frontend"""
    source_node_ids: List[int]  # Array of source node IDs (already filtered by frontend)
    target_node_ids: List[int]  # Array of target node IDs (already filtered by frontend)
    migration_note: Optional[str] = None


@app.get("/api/node/{node_id}/successor")
def get_node_successor(node_id: int):
    """
    Get successor information for a specific node.
    
    Returns active successor warnings for the given node.
    Used in configurator to show badges and warnings.
    
    Phase 1: Leaf products (is_intermediate or actual leaves)
    Phase 2: Individual nodes
    """
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # Get successor with target node details
        cursor.execute("""
            SELECT 
                ps.*,
                target.code as target_code,
                target.name as target_name,
                target.label as target_label,
                target.full_typecode as target_typecode
            FROM product_successors ps
            LEFT JOIN nodes target ON ps.target_node_id = target.id
            WHERE ps.source_node_id = ?
              AND ps.show_warning = 1
              AND (ps.effective_date IS NULL OR ps.effective_date <= date('now'))
            ORDER BY ps.warning_severity DESC, ps.created_at DESC
            LIMIT 1
        """, (node_id,))
        
        row = cursor.fetchone()
        
        if not row:
            return {"has_successor": False}
        
        # Build response
        result = {
            "has_successor": True,
            "id": row['id'],
            "source_node_id": row['source_node_id'],
            "source_type": row['source_type'],
            "target_node_id": row['target_node_id'],
            "target_full_code": row['target_full_code'] or row['target_typecode'],
            "target_family_code": row['target_family_code'],
            "replacement_type": row['replacement_type'],
            "migration_note": row['migration_note'],
            "migration_note_en": row['migration_note_en'],
            "warning_severity": row['warning_severity'],
            "allow_old_selection": bool(row['allow_old_selection']),
            # Enriched data
            "target_code": row['target_code'],
            "target_name": row['target_name'],
            "target_label": row['target_label'],
        }
        
        return result
        
    finally:
        conn.close()


@app.post("/api/product/successor")
def get_product_successor(request: dict):
    """
    Get successor for a complete product configuration.
    
    Input: { "code": "BCC-M313-GS-XYZ123", "selections": [...] }
    
    Checks if any node in the path has a successor.
    Returns most critical warning.
    
    Phase 3: Cross-family migrations
    """
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        product_code = request.get('code')
        selections = request.get('selections', [])
        
        if not product_code and not selections:
            raise HTTPException(status_code=400, detail="Either 'code' or 'selections' required")
        
        # Get all node IDs in the selection path
        node_ids = []
        
        if selections:
            for sel in selections:
                if 'id' in sel:
                    node_ids.append(sel['id'])
        
        # Also decode product code to get leaf node
        if product_code:
            cursor.execute("""
                SELECT id FROM nodes 
                WHERE full_typecode = ? OR code = ?
            """, (product_code, product_code))
            leaf = cursor.fetchone()
            if leaf:
                node_ids.append(leaf['id'])
        
        if not node_ids:
            return {"has_successor": False}
        
        # Find successors for any node in path (prioritize by severity)
        placeholders = ','.join('?' * len(node_ids))
        cursor.execute(f"""
            SELECT 
                ps.*,
                source.code as source_code,
                source.label as source_label,
                target.code as target_code,
                target.name as target_name,
                target.label as target_label,
                target.full_typecode as target_typecode
            FROM product_successors ps
            JOIN nodes source ON ps.source_node_id = source.id
            LEFT JOIN nodes target ON ps.target_node_id = target.id
            WHERE ps.source_node_id IN ({placeholders})
              AND ps.show_warning = 1
              AND (ps.effective_date IS NULL OR ps.effective_date <= date('now'))
            ORDER BY 
                CASE ps.warning_severity 
                    WHEN 'critical' THEN 1 
                    WHEN 'warning' THEN 2 
                    ELSE 3 
                END,
                ps.created_at DESC
            LIMIT 1
        """, node_ids)
        
        row = cursor.fetchone()
        
        if not row:
            return {"has_successor": False}
        
        # Build response
        result = {
            "has_successor": True,
            "id": row['id'],
            "source_node_id": row['source_node_id'],
            "source_code": row['source_code'],
            "source_label": row['source_label'],
            "source_type": row['source_type'],
            "target_node_id": row['target_node_id'],
            "target_full_code": row['target_full_code'] or row['target_typecode'],
            "target_family_code": row['target_family_code'],
            "replacement_type": row['replacement_type'],
            "migration_note": row['migration_note'],
            "migration_note_en": row['migration_note_en'],
            "warning_severity": row['warning_severity'],
            "allow_old_selection": bool(row['allow_old_selection']),
            # Enriched data
            "target_code": row['target_code'],
            "target_name": row['target_name'],
            "target_label": row['target_label'],
        }
        
        return result
        
    finally:
        conn.close()


# ============================================================
# ADMIN: Product Lifecycle Management
# ============================================================

@app.get("/api/admin/successors", dependencies=[Depends(require_admin)])
def get_all_successors(current_user: TokenData = Depends(get_current_user)):
    """
    Get all successor relationships (Admin only).
    
    Returns list with enriched source/target information.
    """
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            SELECT 
                ps.*,
                source.code as source_code,
                source.label as source_label,
                source.full_typecode as source_typecode,
                source.level as source_level,
                source_family.code as source_family_code,
                target.code as target_code,
                target.label as target_label,
                target.full_typecode as target_typecode,
                target.level as target_level
            FROM product_successors ps
            JOIN nodes source ON ps.source_node_id = source.id
            LEFT JOIN nodes target ON ps.target_node_id = target.id
            -- Get source family (root ancestor at level 0)
            -- depth = level * 2 because of pattern containers between levels
            LEFT JOIN node_paths sc_root ON sc_root.descendant_id = source.id AND sc_root.depth = source.level * 2
            LEFT JOIN nodes source_family ON source_family.id = sc_root.ancestor_id AND source_family.level = 0
            ORDER BY ps.created_at DESC
        """)
        
        rows = cursor.fetchall()
        
        results = []
        for row in rows:
            # Get target family code with separate query (subquery in SELECT doesn't work with LEFT JOIN)
            target_family_code = None
            if row['target_node_id'] and row['target_level'] is not None:
                cursor.execute("""
                    SELECT n.code FROM nodes n 
                    JOIN node_paths np ON np.ancestor_id = n.id 
                    WHERE np.descendant_id = ? 
                      AND np.depth = ? 
                      AND n.level = 0 
                    LIMIT 1
                """, (row['target_node_id'], row['target_level'] * 2))
                family_result = cursor.fetchone()
                if family_result:
                    target_family_code = family_result['code']
            
            results.append({
                "id": row['id'],
                "source_node_id": row['source_node_id'],
                "source_code": row['source_code'],
                "source_label": row['source_label'],
                "source_typecode": row['source_typecode'],
                "source_level": row['source_level'],
                "source_family_code": row['source_family_code'],
                "source_type": row['source_type'],
                "target_node_id": row['target_node_id'],
                "target_code": row['target_code'],
                "target_label": row['target_label'],
                "target_typecode": row['target_typecode'],
                "target_level": row['target_level'],
                "target_full_code": row['target_full_code'],
                "target_family_code": target_family_code,
                "replacement_type": row['replacement_type'],
                "migration_note": row['migration_note'],
                "migration_note_en": row['migration_note_en'],
                "effective_date": row['effective_date'],
                "show_warning": bool(row['show_warning']),
                "allow_old_selection": bool(row['allow_old_selection']),
                "warning_severity": row['warning_severity'],
                "created_at": row['created_at'],
                "created_by": row['created_by'],
            })
        
        return {"successors": results}
        
    finally:
        conn.close()


@app.post("/api/admin/successors", dependencies=[Depends(require_admin)])
def create_successor(
    request: CreateSuccessorRequest,
    current_user: TokenData = Depends(get_current_user)
):
    """
    Create a new successor relationship (Admin only).
    
    Validates:
    - Source node exists
    - Target node exists (if target_node_id provided)
    - Either target_node_id OR target_full_code is set
    """
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # Validate source node exists
        cursor.execute("SELECT id, code, full_typecode FROM nodes WHERE id = ?", 
                      (request.source_node_id,))
        source = cursor.fetchone()
        if not source:
            raise HTTPException(status_code=404, detail="Source node not found")
        
        # Validate target if target_node_id provided
        target_family_code = None
        if request.target_node_id:
            cursor.execute("""
                SELECT n.id, n.code, n.full_typecode,
                       family.code as family_code
                FROM nodes n
                LEFT JOIN nodes family ON (
                    SELECT ancestor_id FROM node_paths 
                    WHERE descendant_id = n.id AND depth = (
                        SELECT MAX(depth) FROM node_paths WHERE descendant_id = n.id
                    )
                    LIMIT 1
                ) = family.id
                WHERE n.id = ?
            """, (request.target_node_id,))
            target = cursor.fetchone()
            if not target:
                raise HTTPException(status_code=404, detail="Target node not found")
            target_family_code = target['family_code']
        
        # Validate: Either target_node_id OR target_full_code
        if not request.target_node_id and not request.target_full_code:
            raise HTTPException(
                status_code=400, 
                detail="Either target_node_id or target_full_code must be provided"
            )
        
        # Insert successor
        cursor.execute("""
            INSERT INTO product_successors (
                source_node_id, source_type,
                target_node_id, target_full_code, target_family_code,
                replacement_type, migration_note, migration_note_en,
                effective_date, show_warning, allow_old_selection,
                warning_severity, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            request.source_node_id, request.source_type,
            request.target_node_id, request.target_full_code, target_family_code,
            request.replacement_type, request.migration_note, request.migration_note_en,
            request.effective_date, request.show_warning, request.allow_old_selection,
            request.warning_severity, current_user.username
        ))
        
        conn.commit()
        successor_id = cursor.lastrowid
        
        return {
            "message": "Successor created successfully",
            "id": successor_id
        }
        
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@app.post("/api/admin/successors/bulk", dependencies=[Depends(require_admin)])
def create_successor_bulk(
    request: CreateSuccessorBulkRequest,
    current_user: TokenData = Depends(get_current_user)
):
    """
    Create successor relationships using pre-filtered node IDs from frontend.
    
    Frontend sends arrays of node IDs that are already filtered based on user selections.
    Backend creates 1:1 or 1:many mappings, or a general hint if counts don't match.
    
    All settings are hard-coded:
    - replacement_type: 'successor'
    - show_warning: True
    - allow_old_selection: True
    - warning_severity: 'warning'
    """
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # 1. Fetch source nodes by IDs
        if not request.source_node_ids:
            raise HTTPException(status_code=400, detail="source_node_ids cannot be empty")
        
        placeholders = ','.join('?' * len(request.source_node_ids))
        cursor.execute(f"""
            SELECT id, code, full_typecode, is_intermediate_code
            FROM nodes
            WHERE id IN ({placeholders})
            ORDER BY id
        """, request.source_node_ids)
        
        source_nodes = cursor.fetchall()
        
        if not source_nodes:
            raise HTTPException(status_code=404, detail="No source nodes found with provided IDs")
        
        if len(source_nodes) != len(request.source_node_ids):
            raise HTTPException(
                status_code=404, 
                detail=f"Some source node IDs not found ({len(source_nodes)} found, {len(request.source_node_ids)} requested)"
            )
        
        # 2. Fetch target nodes by IDs
        if not request.target_node_ids:
            raise HTTPException(status_code=400, detail="target_node_ids cannot be empty")
        
        placeholders = ','.join('?' * len(request.target_node_ids))
        cursor.execute(f"""
            SELECT id, code, full_typecode, is_intermediate_code
            FROM nodes
            WHERE id IN ({placeholders})
            ORDER BY id
        """, request.target_node_ids)
        
        target_nodes = cursor.fetchall()
        
        if not target_nodes:
            raise HTTPException(status_code=404, detail="No target nodes found with provided IDs")
        
        if len(target_nodes) != len(request.target_node_ids):
            raise HTTPException(
                status_code=404, 
                detail=f"Some target node IDs not found ({len(target_nodes)} found, {len(request.target_node_ids)} requested)"
            )
        
        # 3. Automatic mode detection: Links vs Hint
        source_all_complete = all(node['full_typecode'] for node in source_nodes)
        target_all_complete = all(node['full_typecode'] for node in target_nodes)
        
        # Determine mode
        if (source_all_complete and target_all_complete and 
            len(source_nodes) == len(target_nodes)):
            # MODE 1: Create individual 1:1 links (bulk)
            created_successors = []
            skipped_duplicates = 0
            
            for source_node, target_node in zip(source_nodes, target_nodes):
                # Check if this link already exists
                cursor.execute("""
                    SELECT id FROM product_successors
                    WHERE source_node_id = ? AND target_node_id = ?
                """, (source_node['id'], target_node['id']))
                
                if cursor.fetchone():
                    # Skip duplicate
                    skipped_duplicates += 1
                    continue
                
                # Automatically determine source_type
                if source_node['full_typecode'] and source_node['is_intermediate_code']:
                    source_type = 'intermediate'
                elif source_node['full_typecode']:
                    source_type = 'leaf'
                else:
                    source_type = 'node'
                
                # Insert successor with hard-coded settings
                cursor.execute("""
                    INSERT INTO product_successors (
                        source_node_id, source_type,
                        target_node_id, target_full_code, target_family_code,
                        replacement_type, migration_note, migration_note_en,
                        effective_date, show_warning, allow_old_selection,
                        warning_severity, created_by
                    ) VALUES (?, ?, ?, NULL, NULL, 'successor', ?, NULL, NULL, 1, 1, 'warning', ?)
                """, (
                    source_node['id'],
                    source_type,
                    target_node['id'],
                    request.migration_note,
                    current_user.username
                ))
                
                created_successors.append({
                    "source_node_id": source_node['id'],
                    "source_code": source_node['code'],
                    "target_node_id": target_node['id'],
                    "target_code": target_node['code'],
                })
            
            conn.commit()
            
            return {
                "type": "links",
                "message": f"Successfully created {len(created_successors)} successor links" + 
                          (f", skipped {skipped_duplicates} duplicates" if skipped_duplicates > 0 else ""),
                "created_count": len(created_successors),
                "skipped_count": skipped_duplicates,
                "successors": created_successors
            }
        else:
            # MODE 2: Create hints for ALL source nodes to ALL target nodes
            # This covers cases like: BCC Level 2 "020" (multiple nodes) → BCC Level 2 "007" (multiple nodes)
            # Each "020" node gets a hint to each "007" node
            
            created_hints = []
            updated_hints = 0
            skipped_duplicates = 0
            
            # Create migration note with count info
            auto_note = f"Allgemeine Referenz: {len(source_nodes)} Source-Node(s) → {len(target_nodes)} Target-Node(s)"
            final_note = f"{request.migration_note}. {auto_note}" if request.migration_note else auto_note
            
            # For each source node, create hints to ALL target nodes
            for source_node in source_nodes:
                for target_node in target_nodes:
                    # Check if a hint already exists for this combination
                    cursor.execute("""
                        SELECT id FROM product_successors
                        WHERE source_node_id = ? AND target_node_id = ?
                    """, (source_node['id'], target_node['id']))
                    
                    existing = cursor.fetchone()
                    
                    if existing:
                        # Skip or update existing hint
                        skipped_duplicates += 1
                        continue
                    
                    # Determine source_type for the hint
                    if source_node['full_typecode'] and source_node['is_intermediate_code']:
                        source_type = 'intermediate'
                    elif source_node['full_typecode']:
                        source_type = 'leaf'
                    else:
                        source_type = 'node'  # General node-level hint (use 'node' instead of 'reference')
                    
                    # Insert hint entry
                    cursor.execute("""
                        INSERT INTO product_successors (
                            source_node_id, source_type,
                            target_node_id, target_full_code, target_family_code,
                            replacement_type, migration_note, migration_note_en,
                            effective_date, show_warning, allow_old_selection,
                            warning_severity, created_by
                        ) VALUES (?, ?, ?, NULL, NULL, 'successor', ?, NULL, NULL, 1, 1, 'info', ?)
                    """, (
                        source_node['id'],
                        source_type,
                        target_node['id'],
                        final_note,
                        current_user.username
                    ))
                    
                    created_hints.append({
                        "source_node_id": source_node['id'],
                        "source_code": source_node['code'],
                        "target_node_id": target_node['id'],
                        "target_code": target_node['code'],
                    })
            
            conn.commit()
            
            return {
                "type": "hint",
                "message": f"Created {len(created_hints)} reference hints ({len(source_nodes)} source × {len(target_nodes)} target nodes)" + 
                          (f", skipped {skipped_duplicates} duplicates" if skipped_duplicates > 0 else ""),
                "created_count": len(created_hints),
                "skipped_count": skipped_duplicates,
                "source_count": len(source_nodes),
                "target_count": len(target_nodes),
                "successors": created_hints[:10]  # Return max 10 for response size
            }
        
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@app.put("/api/admin/successors/{successor_id}", dependencies=[Depends(require_admin)])
def update_successor(
    successor_id: int,
    request: UpdateSuccessorRequest,
    current_user: TokenData = Depends(get_current_user)
):
    """
    Update an existing successor relationship (Admin only).
    """
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # Check if exists
        cursor.execute("SELECT id FROM product_successors WHERE id = ?", (successor_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Successor not found")
        
        # Build update query dynamically
        updates = []
        params = []
        
        if request.replacement_type is not None:
            updates.append("replacement_type = ?")
            params.append(request.replacement_type)
        if request.migration_note is not None:
            updates.append("migration_note = ?")
            params.append(request.migration_note)
        if request.migration_note_en is not None:
            updates.append("migration_note_en = ?")
            params.append(request.migration_note_en)
        if request.effective_date is not None:
            updates.append("effective_date = ?")
            params.append(request.effective_date)
        if request.show_warning is not None:
            updates.append("show_warning = ?")
            params.append(request.show_warning)
        if request.allow_old_selection is not None:
            updates.append("allow_old_selection = ?")
            params.append(request.allow_old_selection)
        if request.warning_severity is not None:
            updates.append("warning_severity = ?")
            params.append(request.warning_severity)
        
        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")
        
        params.append(successor_id)
        query = f"UPDATE product_successors SET {', '.join(updates)} WHERE id = ?"
        
        cursor.execute(query, params)
        conn.commit()
        
        return {"message": "Successor updated successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@app.delete("/api/admin/successors/{successor_id}", dependencies=[Depends(require_admin)])
def delete_successor(
    successor_id: int,
    current_user: TokenData = Depends(get_current_user)
):
    """
    Delete a successor relationship (Admin only).
    """
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        cursor.execute("SELECT id FROM product_successors WHERE id = ?", (successor_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Successor not found")
        
        cursor.execute("DELETE FROM product_successors WHERE id = ?", (successor_id,))
        conn.commit()
        
        return {"message": "Successor deleted successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


# ============================================================
# Root Endpoint
# ============================================================
@app.get("/")
def root():
    """
    Root Endpoint mit API-Info und Link zur Auto-Dokumentation.
    """
    return {
        "message": "Variantenbaum Product Configurator API",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/api/health",
        "features": [
            "✅ Closure Table (100x schneller als Rekursion)",
            "✅ Bidirektionale Kompatibilitätsprüfung",
            "✅ Pattern Container Support",
            "✅ FastAPI mit Auto-Dokumentation",
            "✅ CORS für React Frontend",
            "✅ Bild-Upload für Node Labels"
        ]
    }


# ============================================================
# Schema Visualization - Typecode Pattern Analysis
# ============================================================

class SchemaPattern(BaseModel):
    """Ein einzigartiges Schema-Muster"""
    pattern: List[int]  # z.B. [3, 5, 3] für BTL5-H1104-M9999
    pattern_string: str  # z.B. "3-5-3"
    example_code: str  # Beispiel Typcode mit diesem Muster
    segment_names: List[Optional[str]]  # Namen der Segmente (wenn vorhanden)
    segment_examples: List[str]  # Beispielwerte für jedes Segment
    count: int  # Wie oft dieses Muster vorkommt

class GroupSchema(BaseModel):
    """Schema-Muster für eine group_name"""
    group_name: str
    patterns: List[SchemaPattern]

class FamilySchemaVisualization(BaseModel):
    """Gesamte Schema-Visualisierung für eine Produktfamilie"""
    family_code: str
    family_label: Optional[str]
    has_group_names: bool
    groups: List[GroupSchema]  # Entweder nach group_name gruppiert oder alle zusammen

@app.get("/api/family-schema-visualization/{family_code}", response_model=FamilySchemaVisualization)
def get_family_schema_visualization(family_code: str):
    """
    Analysiert und visualisiert alle Typcode-Schema-Muster einer Produktfamilie.
    
    Logik:
    - Wenn Produktfamilie group_names hat:
      - Zeige Schemas pro group_name
      - Ignoriere Typecodes ohne group_name
    - Wenn Produktfamilie KEINE group_names hat UND max 5 einzigartige Schemas:
      - Zeige alle Schemas der gesamten Familie
    """
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # Familie finden
        cursor.execute("""
            SELECT id, code, label, label_en
            FROM nodes
            WHERE code = ? AND level = 0
        """, (family_code,))
        
        family = cursor.fetchone()
        if not family:
            raise HTTPException(status_code=404, detail=f"Familie '{family_code}' nicht gefunden")
        
        family_id = family['id']
        code = family['code']
        label = family['label']
        label_en = family['label_en']
        
        # Prüfe ob diese Familie group_names hat (alle Descendants dieser Familie)
        cursor.execute("""
            SELECT COUNT(DISTINCT n.group_name)
            FROM nodes n
            JOIN node_paths p ON p.descendant_id = n.id
            WHERE p.ancestor_id = ? AND n.group_name IS NOT NULL
        """, (family_id,))
        
        has_group_names = cursor.fetchone()[0] > 0
        
        groups = []
        
        if has_group_names:
            # Fall 1: Familie hat group_names - gruppiere nach group_name
            cursor.execute("""
                SELECT DISTINCT n.group_name
                FROM nodes n
                JOIN node_paths p ON p.descendant_id = n.id
                WHERE p.ancestor_id = ? AND n.group_name IS NOT NULL
                ORDER BY n.group_name
            """, (family_id,))
            
            group_names = [row[0] for row in cursor.fetchall()]
            
            for group_name in group_names:
                patterns = _analyze_schemas_for_group(cursor, family_id, group_name)
                if patterns:  # Nur hinzufügen wenn Patterns gefunden
                    groups.append(GroupSchema(
                        group_name=group_name,
                        patterns=patterns
                    ))
        
        else:
            # Fall 2: Familie hat KEINE group_names
            # Analysiere alle Schemas der Familie
            all_patterns = _analyze_schemas_for_family(cursor, family_id)
            
            # Nur anzeigen wenn max 5 einzigartige Schemas
            if len(all_patterns) <= 5:
                groups.append(GroupSchema(
                    group_name=f"Alle Typecodes ({family_code})",
                    patterns=all_patterns
                ))
        
        return FamilySchemaVisualization(
            family_code=code,
            family_label=label,
            has_group_names=has_group_names,
            groups=groups
        )
    
    finally:
        conn.close()


def _analyze_schemas_for_group(cursor, family_id: int, group_name: str) -> List[SchemaPattern]:
    """Analysiert Schema-Muster für eine bestimmte group_name"""
    
    # Hole alle Nodes mit full_typecode dieser group_name (nicht nur Leaves!)
    cursor.execute("""
        SELECT n.id, n.code, n.full_typecode, n.name
        FROM nodes n
        JOIN node_paths p ON p.descendant_id = n.id
        WHERE p.ancestor_id = ?
          AND n.group_name = ?
          AND n.full_typecode IS NOT NULL
    """, (family_id, group_name))
    
    nodes = cursor.fetchall()
    
    return _extract_patterns_from_nodes(cursor, family_id, nodes)


def _analyze_schemas_for_family(cursor, family_id: int) -> List[SchemaPattern]:
    """Analysiert Schema-Muster für die gesamte Familie (ohne group_name Filter)"""
    
    # Hole alle Nodes mit full_typecode der Familie (nicht nur Leaves!)
    cursor.execute("""
        SELECT n.id, n.code, n.full_typecode, n.name
        FROM nodes n
        JOIN node_paths p ON p.descendant_id = n.id
        WHERE p.ancestor_id = ?
          AND n.full_typecode IS NOT NULL
    """, (family_id,))
    
    nodes = cursor.fetchall()
    
    return _extract_patterns_from_nodes(cursor, family_id, nodes)


def _extract_patterns_from_nodes(cursor, family_id: int, nodes) -> List[SchemaPattern]:
    """Extrahiert einzigartige Schema-Muster aus einer Liste von Nodes"""
    
    # Sammle Muster
    pattern_examples = {}  # pattern_string -> (example_code, segments, node_id)
    pattern_counts = {}  # pattern_string -> count
    
    for node_id, code, full_typecode, name in nodes:
        if not full_typecode:
            continue
        
        # Parse Typcode in Segmente (durch '-' getrennt)
        segments = full_typecode.split('-')
        
        # Erstelle Pattern (Längen der Segmente)
        pattern = [len(seg) for seg in segments]
        pattern_string = '-'.join(map(str, pattern))
        
        # Zähle und speichere Beispiel
        pattern_counts[pattern_string] = pattern_counts.get(pattern_string, 0) + 1
        
        if pattern_string not in pattern_examples:
            pattern_examples[pattern_string] = (full_typecode, segments, node_id)
    
    # Erstelle SchemaPattern Objekte
    result = []
    for pattern_string in sorted(pattern_examples.keys()):
        example_code, segments, node_id = pattern_examples[pattern_string]
        pattern = [int(x) for x in pattern_string.split('-')]
        
        # Hole Segment-Namen für diesen Typcode (mit den tatsächlichen Segment-Codes)
        segment_names = _get_segment_names(cursor, family_id, node_id, len(segments), segments)
        
        result.append(SchemaPattern(
            pattern=pattern,
            pattern_string=pattern_string,
            example_code=example_code,
            segment_names=segment_names,
            segment_examples=segments,
            count=pattern_counts[pattern_string]
        ))
    
    return result


def _get_segment_names(cursor, family_id: int, node_id: int, num_segments: int, segments: List[str]) -> List[Optional[str]]:
    """
    Holt die Namen der Code-Segmente für einen bestimmten Node.
    Matched jedes Segment gegen den tatsächlichen Node im Pfad.
    """
    
    # Für jedes Segment: Finde den Node mit diesem Code auf dem entsprechenden Level
    names = []
    
    for level_idx, segment_code in enumerate(segments):
        # Finde den Node im Pfad, der auf diesem Level ist und diesen Code hat
        cursor.execute("""
            SELECT n.name
            FROM node_paths p
            JOIN nodes n ON p.ancestor_id = n.id
            WHERE p.descendant_id = ?
              AND n.level = ?
              AND n.code = ?
            LIMIT 1
        """, (node_id, level_idx, segment_code))
        
        row = cursor.fetchone()
        names.append(row[0] if row and row[0] else None)
    
    return names


# ============================================================
# Startup
# ============================================================
if __name__ == "__main__":
    import uvicorn
    
    print("=" * 60)
    print("  Variantenbaum Product Configurator API")
    print("")
    print("  Server starting at http://localhost:8000")
    print("  Auto-Docs at http://localhost:8000/docs") 
    print("  Health Check at http://localhost:8000/api/health")
    print("")
    print("  Closure Table: KEINE REKURSION!")
    print("  100x schneller als Tree-Traversal")
    print("=" * 60)
    
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
