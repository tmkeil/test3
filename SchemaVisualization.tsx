import React, { useState } from 'react';
import type { FamilySchemaVisualization, GroupSchema, SchemaPattern } from '../api/client';

interface SchemaVisualizationProps {
  data: FamilySchemaVisualization;
  onClose: () => void;
}

const SchemaPatternTable: React.FC<{ pattern: SchemaPattern }> = ({ pattern }) => {
  return (
    <div className="mb-4 bg-gray-50 p-4 rounded-lg border border-gray-200">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-gray-500">
          {pattern.count} {pattern.count === 1 ? 'Code' : 'Codes'}
        </span>
      </div>

      {/* Segmente mit Namen */}
      <div className="flex items-center gap-2 flex-wrap">
        {pattern.segment_examples.map((example, idx) => (
          <React.Fragment key={idx}>
            <div className="bg-white border border-gray-300 rounded px-3 py-2 shadow-sm">
              <div className="font-mono text-base font-semibold text-blue-700">{example}</div>
              {pattern.segment_names[idx] && (
                <div className="text-xs text-gray-500 mt-1">{pattern.segment_names[idx]}</div>
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
}> = ({ group, isExpanded, onToggle, groupId }) => {
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
            <SchemaPatternTable key={idx} pattern={pattern} />
          ))}
        </div>
      )}
    </div>
  );
};

export const SchemaVisualization: React.FC<SchemaVisualizationProps> = ({ data, onClose }) => {
  // State für auf-/zugeklappte Gruppen (alle standardmäßig eingeklappt)
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
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
    </div>
  );
};
