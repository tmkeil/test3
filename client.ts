/**
 * API Client für Variantenbaum Backend
 * 
 * Ersetzt die 730 Zeilen Tree-Traversal Logik in variantenbaum.ts
 * mit einfachen API Calls gegen die Closure Table.
 */

// API Base URL aus Environment Variable (Vite)
// VITE_API_BASE_URL sollte nur die Base URL sein (z.B. http://localhost:8000)
// /api wird hier angehängt
const API_BASE = `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'}/api`;

// ============================================================
// Auth Token Management
// ============================================================

const TOKEN_KEY = 'auth_token';

// Global 401 handler - wird vom AuthContext gesetzt
let global401Handler: (() => void) | null = null;

export function set401Handler(handler: () => void): void {
  global401Handler = handler;
}

/**
 * Helper function für fetch()-Calls mit automatischem 401-Handling
 * Kann überall verwendet werden, wo direkte fetch()-Calls gemacht werden
 */
export async function fetchWithAuth(url: string, options?: RequestInit): Promise<Response> {
  const token = getAuthToken();
  
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const response = await fetch(url, {
    ...options,
    headers,
  });
  
  // 401 Unauthorized -> automatisches Handling
  if (response.status === 401) {
    removeAuthToken();
    if (global401Handler) {
      global401Handler();
    }
  }
  
  return response;
}

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function removeAuthToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// ============================================================
// Types (wie Backend Pydantic Models)
// ============================================================

export interface User {
  id: number;
  username: string;
  email: string;
  role: 'admin' | 'user';
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface Token {
  access_token: string;
  token_type: string;
}

export interface ChangePasswordRequest {
  old_password: string;
  new_password: string;
}

export interface Node {
  id?: number;  // Node ID from database
  code: string | null;
  label?: string | null;
  label_en?: string | null;
  name?: string | null;  // Name-Attribut für Beschreibung
  level: number;
  position: number;
  group_name?: string | null;
  pattern?: number | null;
  pictures?: NodePicture[];  // Bilder für diesen Node
  links?: NodeLink[];  // Links für diesen Node
}

export interface NodePicture {
  url: string;
  description?: string | null;
  uploaded_at: string;
}

export interface NodeLink {
  url: string;
  title: string;
  description?: string | null;
  added_at?: string;
}

export interface AvailableOption {
  id?: number;  // Primäre Node ID (erste gefundene)
  ids?: number[];  // ALLE Node IDs mit diesem Code (für Multi-Pfad-Kompatibilität!)
  code: string;
  label?: string | null;
  label_en?: string | null;
  name?: string | null;  // Name-Attribut für Beschreibung
  group_name?: string | null;  // Group-Name-Attribut
  level: number;
  position: number;
  is_compatible: boolean;
  parent_pattern?: number | null;  // Für Gruppierung nach Branch/Pattern
  pictures?: NodePicture[];  // Bilder für diese Option
  links?: NodeLink[];  // Links für diese Option
}

export interface Selection {
  code: string;
  level: number;
  id?: number;  // Primäre Node ID (deprecated - verwende ids!)
  ids?: number[];  // ALLE Node IDs mit diesem Code (für Multi-Pfad-Kompatibilität!)
}

export interface OptionsRequest {
  target_level: number;
  previous_selections: Selection[];
  group_filter?: string | null;
}

export interface PathNode {
  code: string;
  label?: string | null;
  label_en?: string | null;
  level: number;
  depth: number;
}

export interface DerivedGroupNameResponse {
  group_name?: string | null;  // Der eindeutige group_name (falls vorhanden)
  is_unique: boolean;  // True wenn alle möglichen Pfade denselben group_name haben
  possible_group_names: string[];  // Liste aller möglichen group_names
}

// ============================================================
// Product Lifecycle Management - Successor Types
// ============================================================

export interface SuccessorInfo {
  has_successor: boolean;
  id?: number;
  source_node_id?: number;
  source_code?: string;
  source_label?: string;
  source_type?: 'node' | 'leaf' | 'intermediate';
  target_node_id?: number | null;
  target_code?: string;
  target_name?: string;
  target_label?: string;
  target_full_code?: string | null;
  target_family_code?: string | null;
  replacement_type?: 'successor' | 'alternative' | 'deprecated';
  migration_note?: string | null;
  migration_note_en?: string | null;
  warning_severity?: 'info' | 'warning' | 'critical';
  allow_old_selection?: boolean;
}

export interface CreateSuccessorRequest {
  source_node_id: number;
  source_type: 'node' | 'leaf' | 'intermediate';
  target_node_id?: number | null;
  target_full_code?: string | null;
  replacement_type: 'successor' | 'alternative' | 'deprecated';
  migration_note?: string | null;
  migration_note_en?: string | null;
  effective_date?: string | null;
  show_warning?: boolean;
  allow_old_selection?: boolean;
  warning_severity?: 'info' | 'warning' | 'critical';
}

export interface UpdateSuccessorRequest {
  replacement_type?: 'successor' | 'alternative' | 'deprecated';
  migration_note?: string | null;
  migration_note_en?: string | null;
  effective_date?: string | null;
  show_warning?: boolean;
  allow_old_selection?: boolean;
  warning_severity?: 'info' | 'warning' | 'critical';
}

export interface SuccessorListItem {
  id: number;
  source_node_id: number;
  source_code: string;
  source_label: string;
  source_typecode?: string | null;
  source_level?: number;
  source_family_code?: string | null;
  source_type: 'node' | 'leaf' | 'intermediate';
  target_node_id?: number | null;
  target_code?: string;
  target_label?: string;
  target_typecode?: string | null;
  target_level?: number;
  target_full_code?: string | null;
  target_family_code?: string | null;
  replacement_type: 'successor' | 'alternative' | 'deprecated';
  migration_note?: string | null;
  migration_note_en?: string | null;
  effective_date?: string | null;
  show_warning: boolean;
  allow_old_selection: boolean;
  warning_severity: 'info' | 'warning' | 'critical';
  created_at: string;
  created_by?: string | null;
}

export interface CreateSuccessorBulkRequest {
  source_node_ids: number[];   // Array of source node IDs (already filtered by frontend)
  target_node_ids: number[];   // Array of target node IDs (already filtered by frontend)
  migration_note?: string | null;
}

export interface CreateSuccessorBulkResponse {
  type: 'links' | 'hint';  // Auto-detected mode
  message: string;
  created_count: number;
  skipped_count?: number;  // For MODE 1: duplicates skipped
  updated_count?: number;  // For MODE 2: existing hint updated
  source_count?: number;  // Only for hints
  target_count?: number;  // Only for hints
  successors: Array<{
    source_node_id: number;
    source_code: string;
    target_node_id: number;
    target_code: string;
  }>;
}

export interface CreateFamilyRequest {
  code: string;           // z.B. "XYZ"
  label?: string | null;  // Optional - z.B. "Neue Produktlinie"
  label_en?: string | null;
}

export interface UpdateFamilyRequest {
  label: string;          // z.B. "Aktualisierte Produktlinie"
  label_en?: string | null;
}

export interface CreateFamilyResponse {
  success: boolean;
  family_id: number;
  code: string;
  label: string;
  message: string;
}

export interface UpdateFamilyResponse {
  success: boolean;
  code: string;
  label: string;
  label_en: string | null;
  message: string;
}

export interface DeleteFamilyPreview {
  code: string;
  label: string | null;
  affected_nodes: number;
  affected_successors: number;
  affected_constraints: number;
  can_delete: boolean;
  warnings: (string | null)[];
}

export interface DeleteFamilyResponse {
  success: boolean;
  code: string;
  deleted_nodes: number;
  deleted_successors: number;
  deleted_constraints: number;
  message: string;
}

export interface DeleteNodePreview {
  node_id: number;
  code: string;
  label: string | null;
  level: number;
  nodes_with_same_code: number;  // Anzahl Nodes mit gleichem Code+Level
  affected_nodes: number;
  affected_successors: number;
  affected_constraints: number;
  can_delete: boolean;
  warnings: (string | null)[];
}

export interface DeleteNodeResponse {
  success: boolean;
  node_id: number;
  code: string;
  level: number;
  deleted_nodes: number;
  deleted_successors: number;
  nodes_with_same_code: number;  // Anzahl Nodes mit gleichem Code+Level
  message: string;
}

export interface NodeCheckResult {
  exists: boolean;
  code?: string | null;
  label?: string | null;
  label_en?: string | null;
  level?: number | null;
  families: string[];
  is_complete_product?: boolean;
  product_type?: string;
}

export interface CodePathSegment {
  level: number;
  code: string;
  name?: string | null;
  label?: string | null;
  label_en?: string | null;
  position_start?: number | null;
  position_end?: number | null;
  group_name?: string | null;
  pictures?: NodePicture[];  // Bilder für dieses Segment
  links?: NodeLink[];  // Links für dieses Segment
}

export interface TypecodeDecodeResult {
  exists: boolean;
  original_input: string;
  normalized_code?: string | null;
  is_complete_product: boolean;
  product_type: string;
  path_segments: CodePathSegment[];
  full_typecode?: string | null;
  families: string[];
  group_name?: string | null;  // Produktattribut (von erster Produktfamilie)
}

export interface CodeOccurrence {
  family: string;  // Produktfamilie
  level: number;  // Level
  names: string[];  // Deduplizierte Name-Werte
  labels_de: string[];  // Deduplizierte deutsche Labels
  labels_en: string[];  // Deduplizierte englische Labels
  node_count: number;  // Anzahl Nodes mit diesem Code
  sample_node_id?: number | null;  // Beispiel Node ID
}

export interface CodeSearchResult {
  exists: boolean;
  code: string;
  occurrences: CodeOccurrence[];  // Gruppiert nach Familie & Level
}

export interface HealthResponse {
  status: string;
  database: string;
  total_nodes: number;
  total_paths: number;
}

// ============================================================
// Constraint Types
// ============================================================

export interface ConstraintCondition {
  id?: number;
  condition_type: 'pattern' | 'prefix' | 'exact_code';
  target_level: number;
  value: string;
}

export interface ConstraintCode {
  id?: number;
  code_type: 'single' | 'range';
  code_value: string;
}

export interface Constraint {
  id?: number;
  level: number;
  mode: 'allow' | 'deny';
  description?: string | null;
  conditions: ConstraintCondition[];
  codes: ConstraintCode[];
  created_at?: string;
  updated_at?: string;
}

export interface CreateConstraintRequest {
  level: number;
  mode: 'allow' | 'deny';
  description?: string | null;
  conditions: ConstraintCondition[];
  codes: ConstraintCode[];
}

export interface ConstraintValidationResult {
  is_valid: boolean;
  violated_constraints: Constraint[];
  message?: string | null;
}

// ============================================================
// Helper Functions
// ============================================================

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  // JWT Token aus localStorage holen (falls vorhanden)
  const token = getAuthToken();
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };
  
  // Authorization Header hinzufügen wenn Token vorhanden
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    // 401 Unauthorized -> Token ist invalid/abgelaufen, redirect zu Login
    if (response.status === 401) {
      removeAuthToken();
      // Rufe globalen 401 Handler auf (vom AuthContext gesetzt)
      if (global401Handler) {
        global401Handler();
      }
    }
    
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    console.error('API Error Details:', error);
    throw new Error(JSON.stringify(error.detail || error));
  }

  return response.json();
}

// ============================================================
// AUTH API Functions
// ============================================================

/**
 * POST /api/auth/login
 * 
 * Login mit Username/Password
 */
export async function login(username: string, password: string): Promise<Token> {
  const response = await fetchApi<Token>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  
  // Token in localStorage speichern
  setAuthToken(response.access_token);
  
  return response;
}

/**
 * POST /api/auth/logout
 * 
 * Logout (entfernt Token aus localStorage)
 */
export async function logout(): Promise<void> {
  try {
    // Backend informieren (für evtl. Token-Blacklisting)
    await fetchApi('/auth/logout', { method: 'POST' });
  } finally {
    // Token immer entfernen, auch bei Fehler
    removeAuthToken();
  }
}

/**
 * GET /api/auth/me
 * 
 * Holt Infos über aktuell eingeloggten User
 */
export async function getCurrentUser(): Promise<User> {
  return fetchApi<User>('/auth/me');
}

/**
 * POST /api/auth/change-password
 * 
 * Ändert Passwort des eingeloggten Users
 */
export async function changePassword(oldPassword: string, newPassword: string): Promise<{ message: string }> {
  return fetchApi<{ message: string }>('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({
      old_password: oldPassword,
      new_password: newPassword,
    }),
  });
}

// ============================================================
// API Functions
// ============================================================

/**
 * GET /api/product-families
 * 
 * Ersetzt: getProductFamilies() in variantenbaum.ts
 */
export async function fetchProductFamilies(): Promise<Node[]> {
  return fetchApi<Node[]>('/product-families');
}

/**
 * GET /api/product-families/{family_code}/groups
 * 
 * Holt alle verfügbaren group_names für eine Produktfamilie
 */
export async function fetchFamilyGroups(familyCode: string): Promise<string[]> {
  return fetchApi<string[]>(`/product-families/${familyCode}/groups`);
}

/**
 * GET /api/product-families/{family_code}/groups/{group_name}/max-level
 * 
 * Gibt die maximale Level-Tiefe für eine bestimmte Group zurück
 */
export async function fetchGroupMaxLevel(familyCode: string, groupName: string): Promise<{ max_level: number }> {
  return fetchApi<{ max_level: number }>(`/product-families/${familyCode}/groups/${groupName}/max-level`);
}

/**
 * GET /api/nodes/suggest-codes
 * 
 * Schlägt Codes vor basierend auf Partial-Match
 */
export async function suggestCodes(partial: string, familyCode: string, level: number, limit: number = 10): Promise<{ suggestions: string[] }> {
  const params = new URLSearchParams({
    partial,
    family_code: familyCode,
    level: level.toString(),
    limit: limit.toString()
  });
  return fetchApi<{ suggestions: string[] }>(`/nodes/suggest-codes?${params}`);
}

/**
 * GET /api/nodes/check-code-exists
 * 
 * Prüft ob ein Code bereits existiert
 */
export async function checkCodeExists(
  code: string,
  familyCode: string,
  level: number,
  parentId?: number
): Promise<{ exists: boolean }> {
  const params = new URLSearchParams({
    code,
    family_code: familyCode,
    level: level.toString()
  });
  
  if (parentId !== undefined) {
    params.append('parent_id', parentId.toString());
  }
  
  return fetchApi<{ exists: boolean }>(`/nodes/check-code-exists?${params}`);
}

/**
 * GET /api/nodes/{code}/children
 * 
 * Ersetzt: Tree-Traversal für direkte Kinder
 */
export async function fetchChildren(parentCode: string): Promise<Node[]> {
  return fetchApi<Node[]>(`/nodes/${parentCode}/children`);
}

/**
 * GET /api/nodes/{code}/max-depth
 */
export async function fetchMaxDepth(nodeCode: string): Promise<{ max_depth: number }> {
  return fetchApi<{ max_depth: number }>(`/nodes/${nodeCode}/max-depth`);
}

/**
 * GET /api/nodes/{code}/max-level
 * 
 * **WICHTIG für UI!** Gibt maximale LEVEL (User-Selections) zurück,
 * nicht DEPTH (Tree-Hops). Pattern Container werden nicht gezählt.
 */
export async function fetchMaxLevel(nodeCode: string, familyCode?: string): Promise<{ max_level: number }> {
  const url = familyCode 
    ? `/nodes/${nodeCode}/max-level?family_code=${familyCode}`
    : `/nodes/${nodeCode}/max-level`;
  return fetchApi<{ max_level: number }>(url);
}

/**
 * POST /api/options
 * 
 * **WICHTIGSTER API CALL!**
 * 
 * Ersetzt die gesamte Kompatibilitäts-Logik:
 * - getAvailableOptionsForLevel()
 * - testBidirectionalCompatibility()
 * - testPathCompatibility()
 * - findAllNodesAtLevel()
 * - canReachLaterSelectionsFromNode()
 * - findCodeFromNodeAtLevel()
 * - testMultiLevelPathExists()
 * - und 10+ weitere Funktionen!
 * 
 * Performance: ~10-50ms (statt mehrere Sekunden mit Rekursion!)
 */
export async function fetchAvailableOptions(
  targetLevel: number,
  previousSelections: Selection[],
  groupFilter?: string | null
): Promise<AvailableOption[]> {
  return fetchApi<AvailableOption[]>('/options', {
    method: 'POST',
    body: JSON.stringify({
      target_level: targetLevel,
      previous_selections: previousSelections,
      group_filter: groupFilter || null,
    }),
  });
}

/**
 * POST /api/derived-group-name
 * 
 * Berechnet den abgeleiteten group_name basierend auf bisherigen Auswahlen.
 * 
 * Use Case:
 * - User hat BCC M313 ausgewählt
 * - Alle möglichen vollständigen Produkte haben group_name="Bauform A"
 * - → API gibt group_name zurück, auch wenn User noch nicht alle Levels gewählt hat
 * 
 * Returns:
 * - group_name: Der eindeutige group_name (falls alle Pfade denselben haben)
 * - is_unique: True wenn eindeutig
 * - possible_group_names: Liste aller möglichen group_names
 */
export async function fetchDerivedGroupName(
  previousSelections: Selection[]
): Promise<DerivedGroupNameResponse> {
  return fetchApi<DerivedGroupNameResponse>('/derived-group-name', {
    method: 'POST',
    body: JSON.stringify({
      target_level: 1,  // Wird ignoriert, aber Required für OptionsRequest
      previous_selections: previousSelections,
    }),
  });
}

/**
 * GET /api/nodes/{code}
 */
export async function fetchNode(code: string): Promise<Node> {
  return fetchApi<Node>(`/nodes/${code}`);
}

/**
 * GET /api/nodes/{code}/path
 */
export async function fetchNodePath(code: string): Promise<PathNode[]> {
  return fetchApi<PathNode[]>(`/nodes/${code}/path`);
}

/**
 * GET /api/health
 */
export async function fetchHealth(): Promise<HealthResponse> {
  return fetchApi<HealthResponse>('/health');
}

/**
 * GET /api/nodes/check/{code}
 */
export async function checkNodeCode(code: string): Promise<NodeCheckResult> {
  return fetchApi<NodeCheckResult>(`/nodes/check/${code}`);
}

/**
 * GET /api/nodes/decode/{code}
 */
export async function decodeTypecode(code: string): Promise<TypecodeDecodeResult> {
  return fetchApi<TypecodeDecodeResult>(`/nodes/decode/${code}`);
}

/**
 * GET /api/nodes/search-code/{code}
 * Sucht nach allen Vorkommen eines Codes (gruppiert nach Familie & Level)
 */
export async function searchCodeAllOccurrences(code: string): Promise<CodeSearchResult> {
  return fetchApi<CodeSearchResult>(`/nodes/search-code/${code}`);
}

/**
 * GET /api/nodes/search
 * 
 * Erweiterte Suche mit verschiedenen Filtern
 */
export interface AdvancedSearchFilters {
  pattern?: number;      // Codelänge
  prefix?: string;       // Code beginnt mit
  postfix?: string;      // Code endet mit
  label?: string;        // Suche in Labels
  family?: string;       // Produktfamilie
}

export interface AdvancedSearchResult {
  level: number;
  count: number;
  filters_applied: AdvancedSearchFilters;
  options: AvailableOption[];
}

export async function advancedSearch(
  level: number,
  filters: AdvancedSearchFilters
): Promise<AdvancedSearchResult> {
  const params = new URLSearchParams({ level: level.toString() });
  
  if (filters.pattern !== undefined) params.append('pattern', filters.pattern.toString());
  if (filters.prefix) params.append('prefix', filters.prefix);
  if (filters.postfix) params.append('postfix', filters.postfix);
  if (filters.label) params.append('label', filters.label);
  if (filters.family) params.append('family', filters.family);
  
  return fetchApi<AdvancedSearchResult>(`/nodes/search?${params.toString()}`);
}

/**
 * PUT /api/nodes/{node_id}
 * Update node attributes
 */
export interface UpdateNodeData {
  code?: string;
  name?: string;
  label?: string;
  label_en?: string;
  group_name?: string;
}

export interface UpdateNodeResponse {
  success: boolean;
  message: string;
}

export async function updateNode(
  nodeId: number,
  data: UpdateNodeData
): Promise<UpdateNodeResponse> {
  const response = await fetch(`${API_BASE}/nodes/${nodeId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Failed to update node');
  }
  
  return response.json();
}

/**
 * POST /api/nodes/bulk-filter
 * Filter nodes based on multiple criteria
 */
export interface BulkFilterRequest {
  level: number;
  family_code: string;
  code?: string;
  code_prefix?: string;
  code_content?: {
    position?: number;  // Optional: Wenn nicht angegeben, wird im gesamten Code gesucht
    value: string;
  };
  group_name?: string;
  name?: string;
  pattern?: string;  // Codelänge: exakt ("3") oder Range ("2-4")
  // Erweiterte Filter für kompatibel/inkompatibel Splits
  parent_level_patterns?: Record<number, {length: string; type: '' | 'alphabetic' | 'numeric' | 'alphanumeric'}>;  // {level: {length: "3" | "2-4", type: "numeric"}}
  parent_level_options?: Record<number, string[]>;  // {level: ["ABC", "DEF"]} - Nur exakte Codes!
  allowed_pattern?: {
    from: number;
    to?: number;
    allowed: 'alphabetic' | 'numeric' | 'alphanumeric';
  };
}

export interface BulkFilterResponse {
  nodes: AvailableOption[];
  count: number;
}

export async function bulkFilterNodes(
  filters: BulkFilterRequest
): Promise<BulkFilterResponse> {
  return fetchApi<BulkFilterResponse>('/nodes/bulk-filter', {
    method: 'POST',
    body: JSON.stringify(filters),
  });
}

/**
 * PUT /api/nodes/bulk-update
 * Update multiple nodes at once
 */
export interface BulkUpdateRequest {
  node_ids: number[];
  updates: {
    name?: string;
    label?: string;
    label_en?: string;
    group_name?: string;
    // Append-Felder (fügen Werte hinzu statt zu ersetzen)
    append_name?: string;
    append_label?: string;
    append_label_en?: string;
    append_group_name?: string;
  };
}

export interface BulkUpdateResponse {
  success: boolean;
  updated_count: number;
  message: string;
}

export async function bulkUpdateNodes(
  data: BulkUpdateRequest
): Promise<BulkUpdateResponse> {
  return fetchApi<BulkUpdateResponse>('/nodes/bulk-update', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

/**
 * GET /api/nodes/by-code/{code}/level/{level}/ids
 * Holt ALLE Node-IDs mit einem Code auf einem Level (unabhängig von Kompatibilität).
 */
export interface AllNodeIdsResponse {
  code: string;
  level: number;
  ids: number[];
  count: number;
}

export async function getAllNodeIdsByCodeLevel(
  code: string,
  level: number
): Promise<AllNodeIdsResponse> {
  return fetchApi<AllNodeIdsResponse>(
    `/nodes/by-code/${encodeURIComponent(code)}/level/${level}/ids`
  );
}

/**
 * POST /api/nodes/by-path/find-id
 * Findet die spezifische Node-ID für einen Code basierend auf dem Parent-Pfad
 */
export interface FindNodeIdByPathResponse {
  found: boolean;
  node_id: number | null;
  node?: {
    id: number;
    code: string;
    label?: string | null;
    label_en?: string | null;
    name?: string | null;
    level: number;
    position: number;
    group_name?: string | null;
  };
  message?: string;
}

export async function findNodeIdByPath(
  code: string,
  level: number,
  familyCode: string,
  parentCodes: string[]
): Promise<FindNodeIdByPathResponse> {
  return fetchApi<FindNodeIdByPathResponse>('/nodes/by-path/find-id', {
    method: 'POST',
    body: JSON.stringify({
      code,
      level,
      family_code: familyCode,
      parent_codes: parentCodes
    }),
  });
}

// ============================================================
// Constraint API Functions
// ============================================================

/**
 * GET /api/constraints/level/{level}
 * Holt alle Constraints für ein Level
 */
export async function fetchConstraintsForLevel(level: number): Promise<Constraint[]> {
  return fetchApi<Constraint[]>(`/constraints/level/${level}`);
}

/**
 * POST /api/constraints
 * Erstellt eine neue Constraint
 */
export async function createConstraint(request: CreateConstraintRequest): Promise<Constraint> {
  return fetchApi<Constraint>('/constraints', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

/**
 * PUT /api/constraints/{id}
 * Aktualisiert eine Constraint
 */
export async function updateConstraint(id: number, request: CreateConstraintRequest): Promise<Constraint> {
  return fetchApi<Constraint>(`/constraints/${id}`, {
    method: 'PUT',
    body: JSON.stringify(request),
  });
}

/**
 * DELETE /api/constraints/{id}
 * Löscht eine Constraint
 */
export async function deleteConstraint(id: number): Promise<{ success: boolean; message: string }> {
  return fetchApi<{ success: boolean; message: string }>(`/constraints/${id}`, {
    method: 'DELETE',
  });
}

/**
 * POST /api/constraints/validate
 * Validiert einen Code gegen Constraints
 */
export async function validateCodeAgainstConstraints(
  code: string,
  level: number,
  previousSelections: Record<number, string>
): Promise<ConstraintValidationResult> {
  return fetchApi<ConstraintValidationResult>('/constraints/validate', {
    method: 'POST',
    body: JSON.stringify({
      code,
      level,
      previous_selections: previousSelections,
    }),
  });
}

// ============================================================
// Product Lifecycle Management - Successor API Functions
// ============================================================

/**
 * GET /api/node/{node_id}/successor
 * Get successor information for a specific node
 */
export async function fetchNodeSuccessor(nodeId: number): Promise<SuccessorInfo> {
  return fetchApi<SuccessorInfo>(`/node/${nodeId}/successor`);
}

/**
 * POST /api/product/successor
 * Get successor for a complete product configuration
 */
export async function fetchProductSuccessor(
  code?: string,
  selections?: Selection[]
): Promise<SuccessorInfo> {
  return fetchApi<SuccessorInfo>('/product/successor', {
    method: 'POST',
    body: JSON.stringify({
      code,
      selections,
    }),
  });
}

/**
 * GET /api/admin/successors
 * Get all successor relationships (Admin only)
 */
export async function fetchAllSuccessors(): Promise<{ successors: SuccessorListItem[] }> {
  return fetchApi<{ successors: SuccessorListItem[] }>('/admin/successors');
}

/**
 * POST /api/admin/successors
 * Create new successor relationship (Admin only)
 */
export async function createSuccessor(request: CreateSuccessorRequest): Promise<{ message: string; id: number }> {
  return fetchApi<{ message: string; id: number }>('/admin/successors', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

/**
 * POST /api/admin/successors/bulk
 * Create successor relationships for all filtered nodes (Admin only)
 * Simplified API - uses path + code selection like configurator
 */
export async function createSuccessorBulk(request: CreateSuccessorBulkRequest): Promise<CreateSuccessorBulkResponse> {
  return fetchApi<CreateSuccessorBulkResponse>('/admin/successors/bulk', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

/**
 * POST /api/admin/families
 * Create new product family (Admin only)
 */
export async function createFamily(request: CreateFamilyRequest): Promise<CreateFamilyResponse> {
  return fetchApi<CreateFamilyResponse>('/admin/families', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

/**
 * PUT /api/admin/families/{family_code}
 * Update family labels (Admin only)
 */
export async function updateFamily(
  familyCode: string,
  request: UpdateFamilyRequest
): Promise<UpdateFamilyResponse> {
  return fetchApi<UpdateFamilyResponse>(`/admin/families/${familyCode}`, {
    method: 'PUT',
    body: JSON.stringify(request),
  });
}

/**
 * GET /api/admin/families/{family_code}/delete-preview
 * Preview deletion impact (Admin only)
 */
export async function previewFamilyDeletion(
  familyCode: string
): Promise<DeleteFamilyPreview> {
  return fetchApi<DeleteFamilyPreview>(`/admin/families/${familyCode}/delete-preview`);
}

/**
 * DELETE /api/admin/families/{family_code}
 * Delete product family and all descendants (Admin only)
 */
export async function deleteFamily(
  familyCode: string
): Promise<DeleteFamilyResponse> {
  return fetchApi<DeleteFamilyResponse>(`/admin/families/${familyCode}`, {
    method: 'DELETE',
  });
}

/**
 * GET /api/admin/nodes/{node_id}/delete-preview
 * Preview node deletion impact (Admin only)
 */
export async function previewNodeDeletion(
  nodeId: number
): Promise<DeleteNodePreview> {
  return fetchApi<DeleteNodePreview>(`/admin/nodes/${nodeId}/delete-preview`);
}

/**
 * DELETE /api/admin/nodes/{node_id}
 * Delete node and all descendants (Admin only)
 */
export async function deleteNode(
  nodeId: number
): Promise<DeleteNodeResponse> {
  return fetchApi<DeleteNodeResponse>(`/admin/nodes/${nodeId}`, {
    method: 'DELETE',
  });
}

/**
 * PUT /api/admin/successors/{id}
 * Update successor relationship (Admin only)
 */
export async function updateSuccessor(
  id: number,
  request: UpdateSuccessorRequest
): Promise<{ message: string }> {
  return fetchApi<{ message: string }>(`/admin/successors/${id}`, {
    method: 'PUT',
    body: JSON.stringify(request),
  });
}

/**
 * DELETE /api/admin/successors/{id}
 * Delete successor relationship (Admin only)
 */
export async function deleteSuccessor(id: number): Promise<{ message: string }> {
  return fetchApi<{ message: string }>(`/admin/successors/${id}`, {
    method: 'DELETE',
  });
}

// ============================================================
// KMAT References
// ============================================================

export interface KMATReferenceRequest {
  family_id: number;
  path_node_ids: number[];  // Array of node IDs in path
  full_typecode: string;
  kmat_reference: string;
}

export interface KMATReferenceResponse {
  success: boolean;
  id: number;
  kmat_reference: string;
  message: string;
}

export interface KMATReferenceData {
  found: boolean;
  id?: number;
  kmat_reference?: string;
  full_typecode?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * POST /api/admin/kmat-references
 * Create or update KMAT reference for configured product (Admin only)
 */
export async function saveKMATReference(
  request: KMATReferenceRequest
): Promise<KMATReferenceResponse> {
  return fetchApi<KMATReferenceResponse>('/admin/kmat-references', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

/**
 * GET /api/kmat-references
 * Get KMAT reference for configured product (all users)
 */
export async function getKMATReference(
  familyId: number,
  pathNodeIds: number[]
): Promise<KMATReferenceData> {
  const pathJson = JSON.stringify(pathNodeIds);
  return fetchApi<KMATReferenceData>(
    `/kmat-references?family_id=${familyId}&path_node_ids=${encodeURIComponent(pathJson)}`
  );
}

/**
 * DELETE /api/admin/kmat-references/{kmat_id}
 * Delete KMAT reference (Admin only)
 */
export async function deleteKMATReference(kmatId: number): Promise<{ success: boolean; message: string }> {
  return fetchApi<{ success: boolean; message: string }>(`/admin/kmat-references/${kmatId}`, {
    method: 'DELETE',
  });
}

// ============================================================
// Schema Visualization
// ============================================================

export interface SchemaPattern {
  pattern: number[];  // z.B. [3, 5, 3]
  pattern_string: string;  // z.B. "3-5-3"
  example_code: string;  // Beispiel Typcode
  segment_names: (string | null)[];  // Namen der Segmente
  segment_examples: string[];  // Beispielwerte für jedes Segment
  count: number;  // Wie oft dieses Muster vorkommt
}

export interface GroupSchema {
  group_name: string;
  patterns: SchemaPattern[];
}

export interface FamilySchemaVisualization {
  family_code: string;
  family_label: string | null;
  has_group_names: boolean;
  groups: GroupSchema[];
}

/**
 * GET /api/family-schema-visualization/{family_code}
 * Get typecode schema visualization for a family
 */
export async function getFamilySchemaVisualization(
  familyCode: string
): Promise<FamilySchemaVisualization> {
  return fetchApi<FamilySchemaVisualization>(`/family-schema-visualization/${familyCode}`);
}
