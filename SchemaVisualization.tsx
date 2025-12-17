import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { 
  previewSegmentNameUpdate, 
  updateSegmentName, 
  createOrUpdateSubsegments,
  getSubsegments,
  deleteSubsegments
} from '../api/client';
import type { 
  FamilySchemaVisualization, 
  GroupSchema, 
  SchemaPattern, 
  SegmentNamePreviewResponse,
  SubSegmentDefinition,
  SubSegmentResponse 
} from '../api/client';

interface SchemaVisualizationProps {
  data: FamilySchemaVisualization;
  onClose: () => void;
}

interface EditModalState {
  familyCode: string;
  groupName: string;
  level: number;
  levelLabel: string;
  patternString: string;  // Aktuelles Pattern für Schema-Filterung
}

interface SubSegmentModalState {
  familyCode: string;
  groupName: string;
  level: number;
  segmentExample: string;  // z.B. "M312"
  patternString: string;
  currentSubsegments: SubSegmentDefinition[];
  existingId?: number;  // Wenn bereits vorhanden
}

const SchemaPatternTable: React.FC<{ 
  pattern: SchemaPattern;
  familyCode: string;
  groupName: string;
  isAdmin: boolean;
  onEditSegment: (level: number, levelLabel: string, patternString: string) => void;
  onEditSubsegments: (level: number, segmentExample: string, patternString: string) => void;
}> = ({ pattern, familyCode, groupName, isAdmin, onEditSegment, onEditSubsegments }) => {
  return (
    <div className="mb-4 bg-gray-50 p-4 rounded-lg border border-gray-200">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-gray-500">
          {pattern.count} {pattern.count === 1 ? 'Code' : 'Codes'}
        </span>
        <span className="text-xs font-mono text-gray-400">
          Schema: {pattern.pattern_string}
        </span>
      </div>

      {/* Segmente mit Namen */}
      <div className="flex items-center gap-2 flex-wrap">
        {pattern.segment_examples.map((example, idx) => (
          <React.Fragment key={idx}>
            <div className="bg-white border border-gray-300 rounded px-3 py-2 shadow-sm relative group">
              <div className="font-mono text-base font-semibold text-blue-700">{example}</div>
              {pattern.segment_names[idx] && (
                <div className="text-xs text-gray-500 mt-1">{pattern.segment_names[idx]}</div>
              )}
              
              {/* Sub-Segmente anzeigen */}
              {pattern.segment_subsegments[idx] && pattern.segment_subsegments[idx]!.length > 0 && (
                <div className="mt-2 pt-2 border-t border-gray-200">
                  <div className="flex gap-1 text-xs">
                    {pattern.segment_subsegments[idx]!.map((subseg, subIdx) => {
                      const chars = example.substring(subseg.start, subseg.end);
                      return (
                        <div key={subIdx} className="flex flex-col items-center">
                          <span className="font-mono bg-blue-100 px-1 rounded">{chars}</span>
                          <span className="text-[10px] text-gray-500 mt-0.5">{subseg.name}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              
              {/* Edit Buttons - nur für Admins sichtbar */}
              {isAdmin && (
                <div className="absolute -top-2 -right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => onEditSegment(idx, pattern.segment_names[idx] || `Level ${idx}`, pattern.pattern_string)}
                    className="bg-blue-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs hover:bg-blue-700"
                    title="Namen für alle Codes auf diesem Level bearbeiten"
                  >
                    ✎
                  </button>
                  <button
                    onClick={() => onEditSubsegments(idx, example, pattern.pattern_string)}
                    className="bg-purple-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs hover:bg-purple-700"
                    title="Sub-Segmente (Character-Ebene) bearbeiten"
                  >
                    ⚡
                  </button>
                </div>
              )}
            </div>
            {idx < pattern.segment_examples.length - 1 && (
              <span className="text-gray-400 font-bold text-lg">-</span>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

const GroupSchemaSection: React.FC<{ 
  group: GroupSchema; 
  isExpanded: boolean; 
  onToggle: () => void;
  groupId: string;
  familyCode: string;
  isAdmin: boolean;
  onEditSegment: (groupName: string, level: number, levelLabel: string, patternString: string) => void;
  onEditSubsegments: (groupName: string, level: number, segmentExample: string, patternString: string) => void;
}> = ({ group, isExpanded, onToggle, groupId, familyCode, isAdmin, onEditSegment, onEditSubsegments }) => {
  return (
    <div id={groupId} className="mb-6 bg-white rounded-lg border border-gray-300 shadow-sm">
      {/* Header - klickbar */}
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-xl">{isExpanded ? '▼' : '▶'}</span>
          <h3 className="text-lg font-semibold text-gray-800">
            {group.group_name}
          </h3>
          <span className="text-sm text-gray-500">
            ({group.patterns.length} {group.patterns.length === 1 ? 'Schema' : 'Schemas'})
          </span>
        </div>
      </button>

      {/* Content - aufklappbar */}
      {isExpanded && (
        <div className="px-4 pb-4">
          {group.patterns.map((pattern, idx) => (
            <SchemaPatternTable 
              key={idx} 
              pattern={pattern}
              familyCode={familyCode}
              groupName={group.group_name}
              isAdmin={isAdmin}
              onEditSegment={(level, levelLabel, patternString) => 
                onEditSegment(group.group_name, level, levelLabel, patternString)
              }
              onEditSubsegments={(level, segmentExample, patternString) =>
                onEditSubsegments(group.group_name, level, segmentExample, patternString)
              }
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const SchemaVisualization: React.FC<SchemaVisualizationProps> = ({ data, onClose }) => {
  const { user } = useAuth();
  const isAdmin = user?.is_admin || false;

  // State für auf-/zugeklappte Gruppen (alle standardmäßig eingeklappt)
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  
  // Edit Modal State
  const [editModal, setEditModal] = useState<EditModalState | null>(null);
  const [newName, setNewName] = useState('');
  const [preview, setPreview] = useState<SegmentNamePreviewResponse | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [usePatternFilter, setUsePatternFilter] = useState(false);  // Schema-Filter aktiviert?
  
  // Sub-Segment Modal State
  const [subSegmentModal, setSubSegmentModal] = useState<SubSegmentModalState | null>(null);
  const [isLoadingSubsegments, setIsLoadingSubsegments] = useState(false);
  const [isSavingSubsegments, setIsSavingSubsegments] = useState(false);

  const toggleGroup = (index: number) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const scrollToGroup = (index: number) => {
    const element = document.getElementById(`group-${index}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Gruppe automatisch aufklappen wenn zugeklappt
      if (!expandedGroups.has(index)) {
        toggleGroup(index);
      }
    }
  };

  const handleEditSegment = (groupName: string, level: number, levelLabel: string, patternString: string) => {
    setEditModal({
      familyCode: data.family_code,
      groupName,
      level,
      levelLabel,
      patternString
    });
    setNewName('');
    setPreview(null);
    setUsePatternFilter(false);
  };

  const handlePreview = async () => {
    if (!editModal) return;
    
    setIsLoadingPreview(true);
    try {
      const result = await previewSegmentNameUpdate({
        family_code: editModal.familyCode,
        group_name: editModal.groupName,
        level: editModal.level,
        new_name: newName,
        pattern_string: usePatternFilter ? editModal.patternString : undefined
      });
      setPreview(result);
    } catch (error) {
      console.error('Fehler beim Preview:', error);
      alert('Fehler beim Laden der Vorschau');
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleUpdate = async () => {
    if (!editModal || !preview) return;
    
    setIsUpdating(true);
    try {
      const result = await updateSegmentName({
        family_code: editModal.familyCode,
        group_name: editModal.groupName,
        level: editModal.level,
        new_name: newName,
        pattern_string: usePatternFilter ? editModal.patternString : undefined
      });
      
      alert(`Erfolgreich! ${result.updated_count} Node(s) aktualisiert`);
      setEditModal(null);
      setPreview(null);
      
      // Reload data
      window.location.reload();
    } catch (error) {
      console.error('Fehler beim Update:', error);
      alert('Fehler beim Aktualisieren');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleEditSubsegments = async (groupName: string, level: number, segmentExample: string, patternString: string) => {
    setIsLoadingSubsegments(true);
    try {
      // Versuche existierende Sub-Segmente zu laden
      const existing = await getSubsegments(data.family_code, groupName, level, patternString);
      
      const currentSubsegments = existing.length > 0 
        ? existing[0].subsegments 
        : [];
      
      setSubSegmentModal({
        familyCode: data.family_code,
        groupName,
        level,
        segmentExample,
        patternString,
        currentSubsegments,
        existingId: existing.length > 0 ? existing[0].id : undefined
      });
    } catch (error) {
      console.error('Fehler beim Laden der Sub-Segmente:', error);
      // Auch bei Fehler Modal öffnen (neue Definition)
      setSubSegmentModal({
        familyCode: data.family_code,
        groupName,
        level,
        segmentExample,
        patternString,
        currentSubsegments: []
      });
    } finally {
      setIsLoadingSubsegments(false);
    }
  };

  const handleSaveSubsegments = async (subsegments: SubSegmentDefinition[]) => {
    if (!subSegmentModal) return;
    
    setIsSavingSubsegments(true);
    try {
      await createOrUpdateSubsegments({
        family_code: subSegmentModal.familyCode,
        group_name: subSegmentModal.groupName,
        level: subSegmentModal.level,
        pattern_string: subSegmentModal.patternString,
        subsegments
      });
      
      alert('Sub-Segmente erfolgreich gespeichert!');
      setSubSegmentModal(null);
      
      // Reload data
      window.location.reload();
    } catch (error) {
      console.error('Fehler beim Speichern:', error);
      alert('Fehler beim Speichern der Sub-Segmente');
    } finally {
      setIsSavingSubsegments(false);
    }
  };

  const handleDeleteSubsegments = async () => {
    if (!subSegmentModal?.existingId) return;
    
    if (!confirm('Sub-Segment-Definition wirklich löschen?')) return;
    
    try {
      await deleteSubsegments(subSegmentModal.existingId);
      alert('Sub-Segmente gelöscht!');
      setSubSegmentModal(null);
      window.location.reload();
    } catch (error) {
      console.error('Fehler beim Löschen:', error);
      alert('Fehler beim Löschen der Sub-Segmente');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-[90%] max-w-[1800px] max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Typeschlüssel-Visualisierung</h2>
            <p className="text-blue-100 text-sm mt-1">
              Produktfamilie: <span className="font-mono font-semibold">{data.family_code}</span>
              {data.family_label && <span className="ml-2">({data.family_label})</span>}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-blue-800 rounded-full transition-colors text-2xl leading-none"
            aria-label="Schließen"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {data.groups.length === 0 ? (
            <div className="text-center py-12 text-gray-500 px-6">
              <p className="text-lg mb-2">Keine Schema-Visualisierung verfügbar</p>
              <p className="text-sm">
                {data.has_group_names
                  ? 'Diese Produktfamilie hat keine Typecodes mit group_name.'
                  : 'Diese Produktfamilie hat zu viele verschiedene Schemas (>5) ohne group_name Gruppierung.'}
              </p>
            </div>
          ) : (
            <div className="flex">
              {/* Inhaltsverzeichnis - Sidebar */}
              {data.groups.length > 1 && (
                <div className="w-64 bg-gray-50 border-r border-gray-300 p-4 overflow-y-auto">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase">Gruppen</h3>
                  <nav className="space-y-1">
                    {data.groups.map((group, idx) => (
                      <button
                        key={idx}
                        onClick={() => scrollToGroup(idx)}
                        className="w-full text-left px-3 py-2 text-sm rounded hover:bg-blue-100 hover:text-blue-700 transition-colors"
                      >
                        <div className="font-medium truncate">{group.group_name}</div>
                        <div className="text-xs text-gray-500">
                          {group.patterns.length} {group.patterns.length === 1 ? 'Schema' : 'Schemas'}
                        </div>
                      </button>
                    ))}
                  </nav>
                </div>
              )}

              {/* Hauptinhalt */}
              <div className="flex-1 p-6">
                {data.has_group_names && (
                  <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <p className="text-sm text-blue-800">
                      Diese Produktfamilie ist in <strong>{data.groups.length}</strong>{' '}
                      {data.groups.length === 1 ? 'Gruppe' : 'Gruppen'} unterteilt.
                    </p>
                  </div>
                )}

                {data.groups.map((group, idx) => (
                  <GroupSchemaSection
                    key={idx}
                    group={group}
                    isExpanded={expandedGroups.has(idx)}
                    onToggle={() => toggleGroup(idx)}
                    groupId={`group-${idx}`}
                    familyCode={data.family_code}
                    isAdmin={isAdmin}
                    onEditSegment={handleEditSegment}
                    onEditSubsegments={handleEditSubsegments}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-gray-100 px-6 py-3 border-t border-gray-300 flex items-center justify-between">
          <p className="text-xs text-gray-600">
            Zeigt die verschiedenen Typeschlüssel-Muster dieser Produktfamilie
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-sm"
          >
            Schließen
          </button>
        </div>
      </div>

      {/* Edit Modal */}
      {editModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl">
            {/* Header */}
            <div className="bg-blue-600 text-white px-6 py-4 rounded-t-lg">
              <h3 className="text-xl font-bold">Segment-Namen bearbeiten</h3>
              <p className="text-blue-100 text-sm mt-1">
                Alle Nodes auf <span className="font-mono font-semibold">Level {editModal.level}</span> ({editModal.levelLabel}) in Gruppe "{editModal.groupName}"
              </p>
            </div>

            {/* Content */}
            <div className="p-6">
              {/* Input */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Neuer Name für alle Nodes auf diesem Level:
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Neuer Name..."
                />
              </div>

              {/* Schema-Filter Checkbox */}
              <div className="mb-4">
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={usePatternFilter}
                    onChange={(e) => {
                      setUsePatternFilter(e.target.checked);
                      setPreview(null);  // Preview zurücksetzen
                    }}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span>
                    Nur Codes mit diesem Schema-Muster bearbeiten
                    {usePatternFilter && (
                      <span className="ml-2 font-mono text-xs bg-blue-100 px-2 py-0.5 rounded">
                        {editModal?.patternString}
                      </span>
                    )}
                  </span>
                </label>
                <p className="text-xs text-gray-500 mt-1 ml-6">
                  {usePatternFilter 
                    ? 'Nur Nodes mit genau diesem Schema-Muster werden aktualisiert' 
                    : 'Alle Nodes auf diesem Level in dieser Gruppe werden aktualisiert'}
                </p>
              </div>

              {/* Preview Button */}
              <button
                onClick={handlePreview}
                disabled={isLoadingPreview || !newName}
                className="w-full mb-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
              >
                {isLoadingPreview ? 'Lade Vorschau...' : 'Vorschau anzeigen'}
              </button>

              {/* Preview Results */}
              {preview && (
                <div className="mb-4 p-4 bg-gray-50 rounded border border-gray-300">
                  <p className="font-semibold mb-2">
                    ✓ {preview.affected_count} Node(s) werden aktualisiert
                  </p>
                  {preview.sample_nodes.length > 0 && (
                    <div>
                      <p className="text-sm text-gray-600 mb-2">Beispiele (erste 10):</p>
                      <div className="space-y-1 max-h-60 overflow-y-auto">
                        {preview.sample_nodes.map(node => (
                          <div key={node.id} className="text-xs bg-white p-2 rounded border border-gray-200">
                            <span className="font-mono text-blue-700">{node.code}</span>
                            <span className="text-gray-500 ml-2">
                              ({node.current_name || 'kein Name'} → {newName})
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="bg-gray-100 px-6 py-4 rounded-b-lg flex justify-end gap-3">
              <button
                onClick={() => {
                  setEditModal(null);
                  setPreview(null);
                }}
                className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-200 transition-colors"
              >
                Abbrechen
              </button>
              <button
                onClick={handleUpdate}
                disabled={!preview || isUpdating}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400 transition-colors"
              >
                {isUpdating ? 'Aktualisiere...' : 'Aktualisieren'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sub-Segment Modal */}
      {subSegmentModal && (
        <SubSegmentEditor
          segmentExample={subSegmentModal.segmentExample}
          initialSubsegments={subSegmentModal.currentSubsegments}
          onSave={handleSaveSubsegments}
          onDelete={subSegmentModal.existingId ? handleDeleteSubsegments : undefined}
          onClose={() => setSubSegmentModal(null)}
          isSaving={isSavingSubsegments}
        />
      )}
    </div>
  );
};

// ============================================================
// Sub-Segment Editor Component
// ============================================================

interface SubSegmentEditorProps {
  segmentExample: string;
  initialSubsegments: SubSegmentDefinition[];
  onSave: (subsegments: SubSegmentDefinition[]) => void;
  onDelete?: () => void;
  onClose: () => void;
  isSaving: boolean;
}

const SubSegmentEditor: React.FC<SubSegmentEditorProps> = ({
  segmentExample,
  initialSubsegments,
  onSave,
  onDelete,
  onClose,
  isSaving
}) => {
  const [subsegments, setSubsegments] = useState<SubSegmentDefinition[]>(
    initialSubsegments.length > 0 ? initialSubsegments : []
  );

  const addSubsegment = () => {
    const lastEnd = subsegments.length > 0 
      ? Math.max(...subsegments.map(s => s.end)) 
      : 0;
    
    if (lastEnd >= segmentExample.length) {
      alert('Bereits das gesamte Segment abgedeckt!');
      return;
    }
    
    setSubsegments([
      ...subsegments,
      { start: lastEnd, end: Math.min(lastEnd + 1, segmentExample.length), name: '' }
    ]);
  };

  const updateSubsegment = (index: number, field: keyof SubSegmentDefinition, value: string | number) => {
    const updated = [...subsegments];
    updated[index] = { ...updated[index], [field]: value };
    setSubsegments(updated);
  };

  const removeSubsegment = (index: number) => {
    setSubsegments(subsegments.filter((_, i) => i !== index));
  };

  const validateAndSave = () => {
    // Validierung
    for (let i = 0; i < subsegments.length; i++) {
      const sub = subsegments[i];
      
      if (!sub.name.trim()) {
        alert(`Sub-Segment ${i + 1}: Name fehlt!`);
        return;
      }
      
      if (sub.start >= sub.end) {
        alert(`Sub-Segment ${i + 1}: Start muss kleiner als End sein!`);
        return;
      }
      
      if (sub.start < 0 || sub.end > segmentExample.length) {
        alert(`Sub-Segment ${i + 1}: Position außerhalb des Segments!`);
        return;
      }
      
      // Überlappungsprüfung
      for (let j = i + 1; j < subsegments.length; j++) {
        const other = subsegments[j];
        if (!(sub.end <= other.start || other.end <= sub.start)) {
          alert(`Sub-Segmente ${i + 1} und ${j + 1} überlappen sich!`);
          return;
        }
      }
    }
    
    onSave(subsegments);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-purple-600 text-white px-6 py-4">
          <h3 className="text-xl font-bold">Sub-Segmente bearbeiten (Character-Ebene)</h3>
          <p className="text-purple-100 text-sm mt-1">
            Segment: <span className="font-mono font-semibold text-lg">{segmentExample}</span>
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Visual Representation */}
          <div className="mb-6 p-4 bg-gray-50 rounded border border-gray-300">
            <p className="text-sm font-medium text-gray-700 mb-2">Vorschau:</p>
            <div className="flex gap-1">
              {segmentExample.split('').map((char, idx) => {
                const sub = subsegments.find(s => s.start <= idx && idx < s.end);
                return (
                  <div
                    key={idx}
                    className={`px-2 py-1 font-mono text-sm border-2 rounded ${
                      sub 
                        ? 'bg-blue-100 border-blue-400' 
                        : 'bg-white border-gray-300'
                    }`}
                    title={sub?.name || 'Nicht zugeordnet'}
                  >
                    {char}
                  </div>
                );
              })}
            </div>
            {subsegments.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {subsegments.map((sub, idx) => (
                  <div key={idx} className="text-xs bg-blue-100 px-2 py-1 rounded">
                    <span className="font-mono font-semibold">
                      {segmentExample.substring(sub.start, sub.end)}
                    </span>
                    <span className="text-gray-600 ml-1">= {sub.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Sub-Segment List */}
          <div className="space-y-3 mb-4">
            {subsegments.map((sub, idx) => (
              <div key={idx} className="p-3 bg-white border border-gray-300 rounded">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-sm font-medium text-gray-700">#{idx + 1}</span>
                  <span className="font-mono bg-gray-100 px-2 py-1 rounded text-sm">
                    {segmentExample.substring(sub.start, sub.end)}
                  </span>
                  <button
                    onClick={() => removeSubsegment(idx)}
                    className="ml-auto text-red-600 hover:text-red-800 text-sm"
                  >
                    ✕ Entfernen
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Start (0-basiert)</label>
                    <input
                      type="number"
                      min={0}
                      max={segmentExample.length - 1}
                      value={sub.start}
                      onChange={(e) => updateSubsegment(idx, 'start', parseInt(e.target.value))}
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">End (exklusiv)</label>
                    <input
                      type="number"
                      min={1}
                      max={segmentExample.length}
                      value={sub.end}
                      onChange={(e) => updateSubsegment(idx, 'end', parseInt(e.target.value))}
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Name</label>
                    <input
                      type="text"
                      value={sub.name}
                      onChange={(e) => updateSubsegment(idx, 'name', e.target.value)}
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-purple-500"
                      placeholder="z.B. 'range'"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Add Button */}
          <button
            onClick={addSubsegment}
            className="w-full py-2 border-2 border-dashed border-gray-300 rounded hover:border-purple-500 hover:bg-purple-50 transition-colors text-sm text-gray-600 hover:text-purple-700"
          >
            + Sub-Segment hinzufügen
          </button>

          {/* Info */}
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded text-xs text-blue-800">
            <p className="font-semibold mb-1">ℹ️ Hinweis:</p>
            <p>Start ist 0-basiert (erstes Zeichen = 0), End ist exklusiv (wird nicht mehr mitgezählt).</p>
            <p className="mt-1">Beispiel für "M312": M=[0,1], 31=[1,3], 2=[3,4]</p>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-gray-100 px-6 py-4 flex justify-between">
          <div>
            {onDelete && (
              <button
                onClick={onDelete}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors text-sm"
              >
                Löschen
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-200 transition-colors"
            >
              Abbrechen
            </button>
            <button
              onClick={validateAndSave}
              disabled={isSaving || subsegments.length === 0}
              className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:bg-gray-400 transition-colors"
            >
              {isSaving ? 'Speichere...' : 'Speichern'}
            </button>
          </div>
        </div>
      </div>
