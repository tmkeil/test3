import React from 'react';
import type { FamilySchemaVisualization, GroupSchema, SchemaPattern } from '../api/client';

interface SchemaVisualizationProps {
  data: FamilySchemaVisualization;
  onClose: () => void;
}

const SchemaPatternTable: React.FC<{ pattern: SchemaPattern }> = ({ pattern }) => {
  return (
    <div className="mb-6 bg-gray-50 p-4 rounded-lg">
      <div className="mb-2 flex items-center gap-4">
        <span className="text-sm font-medium text-gray-600">
          Schema-Muster: <span className="font-mono font-bold text-gray-900">{pattern.pattern_string}</span>
        </span>
        <span className="text-xs text-gray-500">
          ({pattern.count} {pattern.count === 1 ? 'Code' : 'Codes'})
        </span>
      </div>

      {/* Segmente mit Beispielwerten */}
      <div className="mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          {pattern.segment_examples.map((example, idx) => (
            <React.Fragment key={idx}>
              <div className="bg-white border border-gray-300 rounded px-3 py-2 shadow-sm">
                <div className="font-mono text-lg font-semibold text-blue-700">{example}</div>
                {pattern.segment_names[idx] && (
                  <div className="text-xs text-gray-500 mt-1">{pattern.segment_names[idx]}</div>
                )}
              </div>
              {idx < pattern.segment_examples.length - 1 && (
                <span className="text-gray-400 font-bold">-</span>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Vollständiger Beispiel-Code */}
      <div className="text-sm text-gray-600">
        Beispiel: <span className="font-mono font-medium text-gray-900">{pattern.example_code}</span>
      </div>
    </div>
  );
};

const GroupSchemaSection: React.FC<{ group: GroupSchema }> = ({ group }) => {
  return (
    <div className="mb-8">
      <h3 className="text-lg font-semibold text-gray-800 mb-4 pb-2 border-b border-gray-300">
        {group.group_name}
      </h3>
      {group.patterns.map((pattern, idx) => (
        <SchemaPatternTable key={idx} pattern={pattern} />
      ))}
    </div>
  );
};

export const SchemaVisualization: React.FC<SchemaVisualizationProps> = ({ data, onClose }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
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
        <div className="flex-1 overflow-y-auto p-6">
          {data.groups.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p className="text-lg mb-2">Keine Schema-Visualisierung verfügbar</p>
              <p className="text-sm">
                {data.has_group_names
                  ? 'Diese Produktfamilie hat keine Typecodes mit group_name.'
                  : 'Diese Produktfamilie hat zu viele verschiedene Schemas (>5) ohne group_name Gruppierung.'}
              </p>
            </div>
          ) : (
            <>
              {data.has_group_names && (
                <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm text-blue-800">
                    Diese Produktfamilie ist in <strong>{data.groups.length}</strong>{' '}
                    {data.groups.length === 1 ? 'Gruppe' : 'Gruppen'} unterteilt.
                  </p>
                </div>
              )}

              {data.groups.map((group, idx) => (
                <GroupSchemaSection key={idx} group={group} />
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="bg-gray-100 px-6 py-4 border-t border-gray-300">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">
              Zeigt die verschiedenen Typeschlüssel-Muster dieser Produktfamilie
            </p>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              Schließen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
