import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useQuery, QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { useAuth } from './contexts/AuthContext';
import { ChangePasswordModal } from './components/ChangePasswordModal';
import { CodeHints } from './components/CodeHints';
import { SuccessorWarning } from './components/SuccessorWarning';
import { OptionCard } from './components/OptionCard';
import { 
  fetchProductFamilies, 
  fetchFamilyGroups,
  fetchGroupMaxLevel,
  fetchAvailableOptions,
  fetchDerivedGroupName,
  fetchMaxLevel,
  checkNodeCode,
  decodeTypecode,
  searchCodeAllOccurrences,
  suggestCodes,
  checkCodeExists,
  bulkFilterNodes,
  bulkUpdateNodes,
  getAllNodeIdsByCodeLevel,
  findNodeIdByPath,
  fetchConstraintsForLevel,
  createConstraint,
  updateConstraint,
  deleteConstraint,
  validateCodeAgainstConstraints,
  fetchProductSuccessor,
  createFamily,
  updateFamily,
  deleteFamily,
  previewFamilyDeletion,
  deleteNode,
  previewNodeDeletion,
  type CreateFamilyRequest,
  type UpdateFamilyRequest,
  type DeleteFamilyPreview,
  type DeleteNodePreview,
  createSuccessorBulk,
  type Node,
  type NodePicture,
  type NodeLink,
  type AvailableOption,
  type Selection,
  type NodeCheckResult,
  type TypecodeDecodeResult,
  type CodeSearchResult,
  type CodeOccurrence,
  type BulkFilterRequest,
  type Constraint,
  type ConstraintCondition,
  type ConstraintCode,
  type CreateConstraintRequest,
} from './api/client';
import './App.css';

// Query Client für React Query
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5 * 60 * 1000, // 5 Minuten
    },
  },
});

// ============================================================
// Image & Links Components
// ============================================================

interface ImageModalProps {
  pictures: NodePicture[];
  onClose: () => void;
  initialIndex?: number;
}

interface LinksListProps {
  links: NodeLink[];
  onClose: () => void;
}

const LinksList: React.FC<LinksListProps> = ({ links, onClose }) => {
  return createPortal(
    <div 
      className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div 
        className="relative bg-white rounded-lg max-w-2xl max-h-[80vh] w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b">
          <h3 className="text-lg font-semibold">🔗 Links ({links.length})</h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl font-bold"
          >
            ×
          </button>
        </div>

        {/* Links Liste */}
        <div className="p-4 overflow-y-auto max-h-[calc(80vh-80px)]">
          <div className="space-y-3">
            {links.map((link, idx) => (
              <a
                key={idx}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block p-4 bg-gray-50 hover:bg-gray-100 rounded-lg border border-gray-200 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="font-medium text-blue-600 hover:text-blue-800 flex items-center gap-2">
                      {link.title}
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </div>
                    {link.description && (
                      <p className="text-sm text-gray-600 mt-1">{link.description}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-2 break-all">{link.url}</p>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

const ImageModal: React.FC<ImageModalProps> = ({ pictures, onClose, initialIndex = 0 }) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [zoomLevel, setZoomLevel] = useState(1); // 1 = 100%, 1.5 = 150%, etc.
  const [panPosition, setPanPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const currentPicture = pictures[currentIndex];

  const zoomLevels = [1, 1.5, 2, 3]; // 100%, 150%, 200%, 300%

  const handlePrevious = () => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : pictures.length - 1));
    resetZoom();
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev < pictures.length - 1 ? prev + 1 : 0));
    resetZoom();
  };

  const resetZoom = () => {
    setZoomLevel(1);
    setPanPosition({ x: 0, y: 0 });
  };

  const handleImageClick = () => {
    const currentLevelIndex = zoomLevels.indexOf(zoomLevel);
    const nextLevelIndex = (currentLevelIndex + 1) % zoomLevels.length;
    const newZoom = zoomLevels[nextLevelIndex];
    setZoomLevel(newZoom);
    if (newZoom === 1) {
      setPanPosition({ x: 0, y: 0 });
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -1 : 1;
    const currentLevelIndex = zoomLevels.indexOf(zoomLevel);
    let newLevelIndex = currentLevelIndex + delta;
    
    if (newLevelIndex < 0) newLevelIndex = 0;
    if (newLevelIndex >= zoomLevels.length) newLevelIndex = zoomLevels.length - 1;
    
    const newZoom = zoomLevels[newLevelIndex];
    setZoomLevel(newZoom);
    if (newZoom === 1) {
      setPanPosition({ x: 0, y: 0 });
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoomLevel > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - panPosition.x, y: e.clientY - panPosition.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && zoomLevel > 1) {
      setPanPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'ArrowLeft') handlePrevious();
    if (e.key === 'ArrowRight') handleNext();
    if (e.key === '+' || e.key === '=') {
      const currentLevelIndex = zoomLevels.indexOf(zoomLevel);
      if (currentLevelIndex < zoomLevels.length - 1) {
        setZoomLevel(zoomLevels[currentLevelIndex + 1]);
      }
    }
    if (e.key === '-') {
      const currentLevelIndex = zoomLevels.indexOf(zoomLevel);
      if (currentLevelIndex > 0) {
        setZoomLevel(zoomLevels[currentLevelIndex - 1]);
      }
    }
    if (e.key === '0') {
      resetZoom();
    }
  };

  return createPortal(
    <div 
      className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50"
      onClick={onClose}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <div 
        className="relative bg-white rounded-lg max-w-4xl max-h-[90vh] w-full mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b">
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500">
              Bild {currentIndex + 1} von {pictures.length}
            </span>
            {currentPicture.description && (
              <span className="text-sm font-medium">{currentPicture.description}</span>
            )}
            <span className="text-sm text-gray-500">
              {Math.round(zoomLevel * 100)}%
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const currentLevelIndex = zoomLevels.indexOf(zoomLevel);
                if (currentLevelIndex > 0) {
                  setZoomLevel(zoomLevels[currentLevelIndex - 1]);
                  if (zoomLevels[currentLevelIndex - 1] === 1) setPanPosition({ x: 0, y: 0 });
                }
              }}
              disabled={zoomLevel === 1}
              className="px-3 py-1 text-sm bg-gray-200 hover:bg-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              title="Zoom Out (- oder Mausrad)"
            >
              −
            </button>
            <button
              onClick={resetZoom}
              className="px-3 py-1 text-sm bg-gray-200 hover:bg-gray-300 rounded"
              title="Reset Zoom (0)"
            >
              100%
            </button>
            <button
              onClick={() => {
                const currentLevelIndex = zoomLevels.indexOf(zoomLevel);
                if (currentLevelIndex < zoomLevels.length - 1) {
                  setZoomLevel(zoomLevels[currentLevelIndex + 1]);
                }
              }}
              disabled={zoomLevel === zoomLevels[zoomLevels.length - 1]}
              className="px-3 py-1 text-sm bg-gray-200 hover:bg-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              title="Zoom In (+ oder Mausrad)"
            >
              +
            </button>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 text-2xl font-bold ml-2"
            >
              ×
            </button>
          </div>
        </div>

        {/* Image Container */}
        <div 
          className="relative bg-gray-100 overflow-hidden" 
          style={{ height: 'calc(90vh - 200px)' }}
          onWheel={handleWheel}
        >
          <img
            src={`http://localhost:8000${currentPicture.url}`}
            alt={currentPicture.description || 'Bild'}
            className={`w-full h-full object-contain transition-transform ${
              zoomLevel > 1 ? 'cursor-move' : 'cursor-zoom-in'
            }`}
            style={{ 
              transform: `scale(${zoomLevel}) translate(${panPosition.x / zoomLevel}px, ${panPosition.y / zoomLevel}px)`,
              transformOrigin: 'center center'
            }}
            onClick={handleImageClick}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            draggable={false}
          />

          {/* Navigation Arrows */}
          {pictures.length > 1 && (
            <>
              <button
                onClick={handlePrevious}
                className="absolute left-4 top-1/2 transform -translate-y-1/2 bg-white bg-opacity-75 hover:bg-opacity-100 rounded-full p-2 shadow-lg"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                onClick={handleNext}
                className="absolute right-4 top-1/2 transform -translate-y-1/2 bg-white bg-opacity-75 hover:bg-opacity-100 rounded-full p-2 shadow-lg"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </>
          )}
        </div>

        {/* Thumbnail Navigation */}
        {pictures.length > 1 && (
          <div className="flex gap-2 p-4 overflow-x-auto border-t bg-gray-50" style={{ maxHeight: '120px' }}>
            {pictures.map((pic, idx) => (
              <button
                key={idx}
                onClick={() => { setCurrentIndex(idx); resetZoom(); }}
                className={`flex-shrink-0 w-20 h-20 border-2 rounded overflow-hidden ${
                  idx === currentIndex ? 'border-blue-500' : 'border-gray-300'
                }`}
              >
                <img
                  src={`http://localhost:8000${pic.url}`}
                  alt={pic.description || `Thumbnail ${idx + 1}`}
                  className="w-full h-full object-cover"
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

interface InfoIconProps {
  pictures: NodePicture[];
  onClick: () => void;
  className?: string;
}

const InfoIcon: React.FC<InfoIconProps> = ({ pictures, onClick, className = '' }) => {
  if (!pictures || pictures.length === 0) return null;

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-full transition-colors ${className}`}
      title={`${pictures.length} Bild${pictures.length > 1 ? 'er' : ''} ansehen`}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
      <span>{pictures.length}</span>
    </button>
  );
};

interface LinkIconProps {
  links: NodeLink[];
  onClick: () => void;
  className?: string;
}

const LinkIcon: React.FC<LinkIconProps> = ({ links, onClick, className = '' }) => {
  if (!links || links.length === 0) return null;

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-600 bg-green-50 hover:bg-green-100 rounded-full transition-colors ${className}`}
      title={`${links.length} Link${links.length > 1 ? 's' : ''} ansehen`}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
      </svg>
      <span>{links.length}</span>
    </button>
  );
};

interface GroupSelectorProps {
  level: number;
  groupName: string;
  options: AvailableOption[];
  selectedOption?: AvailableOption;
  onSelectionChange: (option: AvailableOption) => void;
  isLoading: boolean;
  familyCode?: string;
  onAddNode?: () => void; // Callback für Add Node Button
  isAddNodeDisabled?: boolean; // Ob Add Node Button disabled ist
  previousSelections?: Record<number, AvailableOption>; // Für erweiterte Suche
  user?: { username: string; role: 'admin' | 'user' } | null; // Current user for role-based UI
}

const GroupSelector: React.FC<GroupSelectorProps> = ({
  level,
  groupName,
  options,
  selectedOption,
  onSelectionChange,
  isLoading,
  familyCode,
  onAddNode,
  isAddNodeDisabled = false,
  previousSelections = {},
  user
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredOption, setHoveredOption] = useState<AvailableOption | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAdvancedSearchOpen, setIsAdvancedSearchOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<AvailableOption | null>(null);
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const [isConstraintsOpen, setIsConstraintsOpen] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [imageModalPictures, setImageModalPictures] = useState<NodePicture[]>([]);
  const [showLinksModal, setShowLinksModal] = useState(false);
  const [linksModalLinks, setLinksModalLinks] = useState<NodeLink[]>([]);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [selectedNameFilters, setSelectedNameFilters] = useState<Set<string>>(new Set());

  // Auto-focus search when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  const formatOptionDisplay = (option: AvailableOption): string => {
    // Labels werden nur in Hover-Boxen angezeigt, nicht in den Dropdown-Optionen
    return option.code || '';
  };

  // Sammle alle einzigartigen Name-Attribute aus den verfügbaren Optionen
  const uniqueNames = React.useMemo(() => {
    const names = new Set<string>();
    options.forEach(opt => {
      if (opt.name && opt.name.trim()) {
        // Wenn mehrere Names (kommasepariert), splitte sie
        opt.name.split(',').forEach(n => {
          const trimmed = n.trim();
          if (trimmed) names.add(trimmed);
        });
      }
    });
    return Array.from(names).sort();
  }, [options]);

  // Sammle nur Names von KOMPATIBLEN Optionen (für Anzeige neben Gruppennamen)
  const compatibleNames = React.useMemo(() => {
    const names = new Set<string>();
    options.filter(opt => opt.is_compatible).forEach(opt => {
      if (opt.name && opt.name.trim()) {
        opt.name.split(',').forEach(n => {
          const trimmed = n.trim();
          if (trimmed) names.add(trimmed);
        });
      }
    });
    return Array.from(names).sort();
  }, [options]);

  // Filter options based on search term only
  const filterBySearchTerm = (opts: AvailableOption[]) => {
    if (!searchTerm.trim()) return opts;
    const search = searchTerm.toLowerCase();
    return opts.filter(opt => 
      opt.code.toLowerCase().includes(search) ||
      opt.label?.toLowerCase().includes(search) ||
      opt.label_en?.toLowerCase().includes(search)
    );
  };

  const handleOptionSelect = (option: AvailableOption) => {
    onSelectionChange(option);
    setIsOpen(false);
    setHoveredOption(null);
    setSearchTerm(''); // Clear search when closing
    setSelectedNameFilters(new Set()); // Clear name filters when closing
  };

  // Gruppiere Optionen nach parent_pattern
  const groupByPattern = (opts: AvailableOption[]) => {
    const groups = new Map<number | null, AvailableOption[]>();
    opts.forEach(opt => {
      const pattern = opt.parent_pattern ?? null;
      if (!groups.has(pattern)) {
        groups.set(pattern, []);
      }
      groups.get(pattern)!.push(opt);
    });
    return groups;
  };

  // Prüfe ob eine Option den Name-Filter erfüllt
  const matchesNameFilter = (opt: AvailableOption): boolean => {
    if (selectedNameFilters.size === 0) return true; // Keine Filter aktiv
    if (!opt.name) return false;
    const optionNames = opt.name.split(',').map(n => n.trim());
    return optionNames.some(name => selectedNameFilters.has(name));
  };

  // ALLE Optionen (kompatible UND inkompatible) sind auswählbar!
  // Wenn Name-Filter aktiv sind, werden Optionen die nicht matchen als inkompatibel behandelt
  let compatibleOptions = options.filter(opt => opt.is_compatible && matchesNameFilter(opt));
  let incompatibleOptions = options.filter(opt => !opt.is_compatible || !matchesNameFilter(opt));
  
  // Wende Such-Filter an
  compatibleOptions = filterBySearchTerm(compatibleOptions);
  incompatibleOptions = filterBySearchTerm(incompatibleOptions);
  
  const hasOptions = options.length > 0;

  // Gruppiere nach Pattern
  const compatibleByPattern = groupByPattern(compatibleOptions);
  const incompatibleByPattern = groupByPattern(incompatibleOptions);

  return (
    <div className="mb-4 relative min-h-[60px]">
      <label className="block text-sm font-medium text-gray-700 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span>{groupName}</span>
          {compatibleNames.length > 0 && (
            <span className="text-xs text-gray-500 font-normal">
              ({compatibleNames.join(' | ')})
            </span>
          )}
        </div>
      </label>

      <div className="flex gap-4 items-start">
        {/* Custom Dropdown */}
        <div className="flex-1 relative dropdown-container">
          <button
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-left bg-white flex justify-between items-center disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
            onClick={() => setIsOpen(!isOpen)}
            disabled={isLoading || !hasOptions}
          >
            <span>
              {isLoading ? (
                'Loading...'
              ) : !hasOptions ? (
                'No options available (select previous level first)'
              ) : selectedOption ? (
                formatOptionDisplay(selectedOption)
              ) : (
                `Please select... (${compatibleOptions.length} compatible, ${incompatibleOptions.length} incompatible)`
              )}
            </span>
            <span className="text-gray-400">
              {isOpen ? '▲' : '▼'}
            </span>
          </button>

          {isOpen && !isLoading && (
            <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg">
              {/* Suchfeld ganz oben */}
              <div className="p-3 border-b border-gray-200 bg-white rounded-t-lg">
                <div className="mb-2">
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search options..."
                    className="w-full px-4 py-3 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 hover:bg-white"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                
                {/* Buttons in einer Reihe unter dem Suchfeld */}
                <div className="flex gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsOpen(false);
                      setIsAdvancedSearchOpen(true);
                    }}
                    className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium text-sm whitespace-nowrap"
                  >
                    🔍 Erweitert
                  </button>
                  {user?.role === 'admin' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsOpen(false);
                        setIsBulkEditOpen(true);
                      }}
                      className="flex-1 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors font-medium text-sm whitespace-nowrap"
                    >
                      ✏️ Edit
                    </button>
                  )}
                  {user?.role === 'admin' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsOpen(false);
                        setIsConstraintsOpen(true);
                      }}
                      className="flex-1 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium text-sm whitespace-nowrap"
                    >
                      ⚠️ Constraints
                    </button>
                  )}
                  {user?.role === 'admin' && familyCode && (
                    <button
                      onClick={(e) => {
                        if (!isAddNodeDisabled && onAddNode) {
                          e.stopPropagation();
                          setIsOpen(false);
                          onAddNode();
                        }
                      }}
                      disabled={isAddNodeDisabled}
                      className={`flex-1 px-4 py-2 rounded-lg transition-colors font-medium text-sm whitespace-nowrap ${
                        isAddNodeDisabled
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          : 'bg-green-600 text-white hover:bg-green-700'
                      }`}
                    >
                      ➕ Node
                    </button>
                  )}
                </div>
              </div>
              
              {/* Name-Filter Chips (wenn es mehrere unique names gibt) */}
              {uniqueNames.length > 0 && (
                <div className="px-3 py-2 border-b border-gray-200 bg-gray-50">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-gray-600 whitespace-nowrap">Filter:</span>
                      {selectedNameFilters.size > 0 && (
                        <span className="bg-blue-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
                          {selectedNameFilters.size}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 overflow-x-auto hover:overflow-x-scroll" style={{ scrollbarWidth: 'thin' }}>
                      <div className="flex gap-2 pb-1">
                        {/* "Alle" Chip zum Zurücksetzen */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedNameFilters(new Set());
                          }}
                          className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors shadow-sm ${
                            selectedNameFilters.size === 0
                              ? 'bg-blue-600 text-white shadow-blue-300'
                              : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
                          }`}
                        >
                          {selectedNameFilters.size === 0 ? '✓ ' : ''}Alle
                        </button>
                        
                        {/* Individual Name Chips */}
                        {uniqueNames.map(name => (
                          <button
                            key={name}
                            onClick={(e) => {
                              e.stopPropagation();
                              const newFilters = new Set(selectedNameFilters);
                              if (newFilters.has(name)) {
                                newFilters.delete(name);
                              } else {
                                newFilters.add(name);
                              }
                              setSelectedNameFilters(newFilters);
                            }}
                            className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors shadow-sm ${
                              selectedNameFilters.has(name)
                                ? 'bg-blue-600 text-white shadow-blue-300'
                                : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
                            }`}
                          >
                            {selectedNameFilters.has(name) && '✓ '}
                            {name}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Optionen-Liste darunter */}
              <div className="overflow-y-auto max-h-80 p-2">
                {/* Kompatible Optionen - gruppiert nach Pattern */}
                {Array.from(compatibleByPattern.entries()).map(([pattern, opts]) => (
                  <div key={`pattern-compat-${pattern}`} className="mb-2 last:mb-0">
                    {opts.map((option, index) => (
                      <OptionCard
                        key={`${level}-${option.code}-${option.position}-${index}`}
                        option={option}
                        level={level}
                        index={index}
                        isSelected={selectedOption?.code === option.code}
                        isCompatible={true}
                        onSelect={handleOptionSelect}
                        onEdit={(opt) => {
                          setEditingNode(opt);
                          setIsEditModalOpen(true);
                        }}
                        onMouseEnter={setHoveredOption}
                        onMouseLeave={() => setHoveredOption(null)}
                        formatDisplay={formatOptionDisplay}
                      />
                    ))}
                  </div>
                ))}
              
                {/* Inkompatible Optionen - grau und nach Pattern gruppiert */}
                {Array.from(incompatibleByPattern.entries()).map(([pattern, opts]) => (
                  <div key={`pattern-incomp-${pattern}`} className="mb-2 last:mb-0">
                    {opts.map((option, index) => (
                      <OptionCard
                        key={`${level}-incomp-${option.code}-${index}`}
                        option={option}
                        level={level}
                        index={index}
                        isSelected={selectedOption?.code === option.code}
                        isCompatible={false}
                        onSelect={handleOptionSelect}
                        onEdit={(opt) => {
                          setEditingNode(opt);
                          setIsEditModalOpen(true);
                        }}
                        onMouseEnter={setHoveredOption}
                        onMouseLeave={() => setHoveredOption(null)}
                        formatDisplay={formatOptionDisplay}
                      />
                    ))}
                  </div>
                ))}
                
                {/* Keine Ergebnisse */}
                {compatibleOptions.length === 0 && incompatibleOptions.length === 0 && searchTerm && (
                  <div className="px-4 py-6 text-center text-gray-400 text-sm">
                    No options found for "{searchTerm}"
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Hover Info Panel - Immer sichtbar, dynamische Höhe */}
        <div className="w-80 flex-shrink-0">
          <div className="bg-gray-50 border border-gray-200 rounded-md p-3 shadow-sm min-h-[160px] max-h-[400px] flex flex-col overflow-y-auto">
            {(hoveredOption || selectedOption) ? (
              <div className="text-sm flex-1">
                <div className="font-semibold text-gray-900 mb-1 flex items-center justify-between">
                  <span>
                    {(hoveredOption || selectedOption)?.code}
                    {hoveredOption && !selectedOption && (
                      <span className="text-blue-600 ml-2">(Preview)</span>
                    )}
                    {selectedOption && !hoveredOption && (
                      <span className="text-green-600 ml-2">(Selected)</span>
                    )}
                  </span>
                  <InfoIcon
                    pictures={(hoveredOption || selectedOption)?.pictures || []}
                    onClick={() => {
                      const pictures = (hoveredOption || selectedOption)?.pictures || [];
                      if (pictures.length > 0) {
                        setImageModalPictures(pictures);
                        setShowImageModal(true);
                      }
                    }}
                  />
                  <LinkIcon
                    links={(hoveredOption || selectedOption)?.links || []}
                    onClick={() => {
                      const links = (hoveredOption || selectedOption)?.links || [];
                      if (links.length > 0) {
                        setLinksModalLinks(links);
                        setShowLinksModal(true);
                      }
                    }}
                    className="ml-1"
                  />
                </div>

                {/* Name anzeigen */}
                {(hoveredOption || selectedOption)?.name && (
                  <div className="mb-2">
                    <span className="text-xs font-medium text-gray-600">Name:</span>
                    <div className="mt-1">
                      <span className="bg-purple-100 text-purple-800 text-xs font-medium px-2 py-1 rounded">
                        {(hoveredOption || selectedOption)?.name}
                      </span>
                    </div>
                  </div>
                )}

                <div className="text-gray-700 mb-2 whitespace-pre-line">
                  {(hoveredOption || selectedOption)?.label ||
                    (hoveredOption || selectedOption)?.label_en ||
                    'No label available'}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-center text-gray-400 text-sm">
                Hover over an option for details
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Image Modal */}
      {showImageModal && imageModalPictures.length > 0 && (
        <ImageModal
          pictures={imageModalPictures}
          onClose={() => setShowImageModal(false)}
        />
      )}

      {/* Links Modal */}
      {showLinksModal && linksModalLinks.length > 0 && (
        <LinksList
          links={linksModalLinks}
          onClose={() => setShowLinksModal(false)}
        />
      )}

      {/* Advanced Search Modal */}
      <AdvancedSearchModal
        isOpen={isAdvancedSearchOpen}
        onClose={() => setIsAdvancedSearchOpen(false)}
        level={level}
        familyCode={familyCode}
        previousSelections={previousSelections}
        onSelect={(option) => {
          handleOptionSelect(option);
          setIsAdvancedSearchOpen(false);
        }}
      />

      {/* Edit Node Modal */}
      <EditNodeModal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setEditingNode(null);
        }}
        node={editingNode}
        onSaved={() => {
          // Refresh options by triggering parent to refetch
          window.location.reload(); // Simple solution for now
        }}
        familyCode={familyCode || ''}
        parentSelections={previousSelections}
        level={level}
      />

      {/* Bulk Edit Modal */}
      {familyCode && (
        <BulkEditModal
          isOpen={isBulkEditOpen}
          onClose={() => setIsBulkEditOpen(false)}
          level={level}
          familyCode={familyCode}
          parentSelections={previousSelections}
        />
      )}

      {/* Constraints Modal */}
      {familyCode && (
        <ConstraintsModal
          isOpen={isConstraintsOpen}
          onClose={() => setIsConstraintsOpen(false)}
          level={level}
          familyCode={familyCode}
        />
      )}
    </div>
  );
};

// ============================================================
// Advanced Search Modal
// ============================================================
interface AdvancedSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  level: number;
  onSelect: (option: AvailableOption) => void;
  familyCode?: string;
  previousSelections?: Record<number, AvailableOption>;
}

const AdvancedSearchModal: React.FC<AdvancedSearchModalProps> = ({ 
  isOpen, 
  onClose, 
  level, 
  onSelect,
  familyCode,
  previousSelections = {}
}) => {
  const [pattern, setPattern] = useState<string>('');
  const [prefix, setPrefix] = useState('');
  const [label, setLabel] = useState('');
  const [results, setResults] = useState<AvailableOption[]>([]);
  const [hoveredOption, setHoveredOption] = useState<AvailableOption | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [imageModalPictures, setImageModalPictures] = useState<NodePicture[]>([]);
  const [showLinksModal, setShowLinksModal] = useState(false);
  const [linksModalLinks, setLinksModalLinks] = useState<NodeLink[]>([]);

  const handleSearch = async () => {
    setIsSearching(true);
    try {
      // Baue previous_selections Array MIT IDs!
      const allSelections: Selection[] = [];
      
      // Familie als Level 0
      if (familyCode) {
        allSelections.push({
          code: familyCode,
          level: 0,
          ids: []  // Backend findet Familie-IDs
        });
      }
      
      // Alle bisherigen Selections MIT ihren IDs!
      Object.entries(previousSelections).forEach(([lvl, sel]) => {
        const lvlNum = parseInt(lvl);
        if (lvlNum !== level) {  // Nicht das aktuelle Level
          console.log(`Adding selection from level ${lvlNum}:`, sel);
          allSelections.push({
            code: sel.code,
            level: lvlNum,
            ids: sel.ids && sel.ids.length > 0 ? sel.ids : []  // Verwende die tatsächlichen IDs!
          });
        }
      });

      console.log('All selections being sent to /api/options/search:', allSelections);

      // POST Request mit Suchfiltern
      const filters: any = {};
      if (pattern) filters.pattern = parseInt(pattern);
      if (prefix) filters.code_prefix = prefix;  // Umbenennen zu code_prefix
      if (label) filters.label_search = label;  // Umbenennen zu label_search

      const response = await fetch(`http://localhost:8000/api/options/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_level: level,
          previous_selections: allSelections,
          ...filters
        })
      });
      
      const data = await response.json();
      setResults(data || []);
    } catch (error) {
      console.error('Advanced search failed:', error);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handleOptionClick = (option: AvailableOption) => {
    onSelect(option);
    onClose();
  };

  const handleClose = () => {
    setPattern('');
    setPrefix('');
    setLabel('');
    setResults([]);
    onClose();
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 bg-black/60 grid place-items-center z-50" onClick={handleClose}>
      <div 
        className="bg-white border border-gray-300 rounded-xl w-[min(900px,92vw)] max-h-[85vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-800">
            🔍 Erweiterte Suche - Level {level}
          </h2>
          <button
            onClick={handleClose}
            className="text-gray-500 hover:text-gray-700 text-3xl font-bold leading-none"
          >
            ×
          </button>
        </div>

        {/* Filter Form */}
        <div className="p-6 border-b border-gray-100">
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Pattern (Codelänge)
              </label>
              <input
                type="number"
                placeholder="z.B. 3 für ABC"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                onKeyPress={handleKeyPress}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Prefix (Beginnt mit)
              </label>
              <input
                type="text"
                placeholder="z.B. A"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                onKeyPress={handleKeyPress}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Label (Suche in Beschreibung)
              </label>
              <input
                type="text"
                placeholder="z.B. Turbo"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onKeyPress={handleKeyPress}
              />
            </div>
          </div>
          <button
            onClick={handleSearch}
            disabled={isSearching}
            className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed font-medium transition-colors"
          >
            {isSearching ? 'Suche läuft...' : 'Filter anwenden'}
          </button>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-hidden flex">
          {/* Results List */}
          <div className="flex-1 overflow-y-auto p-4">
            {results.length > 0 ? (
              <div className="space-y-4">
                {/* Kompatible Optionen */}
                {results.filter(opt => opt.is_compatible).length > 0 && (
                  <div>
                    <div className="text-sm font-semibold text-green-700 mb-2 px-2">
                      ✓ Kompatibel ({results.filter(opt => opt.is_compatible).length})
                    </div>
                    <div className="space-y-1">
                      {results.filter(opt => opt.is_compatible).map((option, index) => (
                        <div
                          key={`${option.code}-compatible-${index}`}
                          className="px-4 py-3 cursor-pointer hover:bg-blue-50 rounded-lg border border-transparent hover:border-blue-200 transition-colors"
                          onMouseEnter={() => setHoveredOption(option)}
                          onMouseLeave={() => setHoveredOption(null)}
                          onClick={() => handleOptionClick(option)}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-semibold text-gray-900">
                              {option.code}
                            </span>
                            <InfoIcon
                              pictures={option.pictures || []}
                              onClick={() => {
                                const pictures = option.pictures || [];
                                if (pictures.length > 0) {
                                  setImageModalPictures(pictures);
                                  setShowImageModal(true);
                                }
                              }}
                            />
                            <LinkIcon
                              links={option.links || []}
                              onClick={() => {
                                const links = option.links || [];
                                if (links.length > 0) {
                                  setLinksModalLinks(links);
                                  setShowLinksModal(true);
                                }
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Inkompatible Optionen */}
                {results.filter(opt => !opt.is_compatible).length > 0 && (
                  <div>
                    <div className="text-sm font-semibold text-red-700 mb-2 px-2">
                      ✗ Inkompatibel ({results.filter(opt => !opt.is_compatible).length})
                    </div>
                    <div className="space-y-1">
                      {results.filter(opt => !opt.is_compatible).map((option, index) => (
                        <div
                          key={`${option.code}-incompatible-${index}`}
                          className="px-4 py-3 cursor-pointer hover:bg-gray-100 rounded-lg border border-transparent hover:border-gray-300 transition-colors opacity-60"
                          onMouseEnter={() => setHoveredOption(option)}
                          onMouseLeave={() => setHoveredOption(null)}
                          onClick={() => handleOptionClick(option)}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-semibold text-gray-600">
                              {option.code}
                            </span>
                            <InfoIcon
                              pictures={option.pictures || []}
                              onClick={() => {
                                const pictures = option.pictures || [];
                                if (pictures.length > 0) {
                                  setImageModalPictures(pictures);
                                  setShowImageModal(true);
                                }
                              }}
                            />
                            <LinkIcon
                              links={option.links || []}
                              onClick={() => {
                                const links = option.links || [];
                                if (links.length > 0) {
                                  setLinksModalLinks(links);
                                  setShowLinksModal(true);
                                }
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-400">
                {isSearching ? 'Suche läuft...' : 'Keine Ergebnisse. Bitte Filter anwenden.'}
              </div>
            )}
          </div>

          {/* Label Preview Box */}
          <div className="w-80 border-l border-gray-200 p-4">
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 min-h-[160px]">
              {hoveredOption ? (
                <div>
                  <div className="font-mono font-bold text-gray-900 mb-2">
                    {hoveredOption.code}
                  </div>
                  {hoveredOption.label && (
                    <div className="text-sm text-gray-700 mb-2">
                      <span className="font-medium">Label:</span>
                      <div className="mt-1 whitespace-pre-line">{hoveredOption.label}</div>
                    </div>
                  )}
                  {hoveredOption.label_en && (
                    <div className="text-sm text-gray-700">
                      <span className="font-medium">Label EN:</span>
                      <div className="mt-1 whitespace-pre-line">{hoveredOption.label_en}</div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-center text-gray-400 text-sm">
                  Bewegen Sie die Maus über eine Option für Details
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Image Modal */}
      {showImageModal && imageModalPictures.length > 0 && (
        <ImageModal
          pictures={imageModalPictures}
          onClose={() => setShowImageModal(false)}
        />
      )}

      {/* Links Modal */}
      {showLinksModal && linksModalLinks.length > 0 && (
        <LinksList
          links={linksModalLinks}
          onClose={() => setShowLinksModal(false)}
        />
      )}
    </div>,
    document.body
  );
};

// ============================================================
// Code Checker Komponente
// ============================================================
interface TypecodeDecoderModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const TypecodeDecoderModal: React.FC<TypecodeDecoderModalProps> = ({ isOpen, onClose }) => {
  const [searchCode, setSearchCode] = useState('');
  const [checkResult, setCheckResult] = useState<NodeCheckResult | null>(null);
  const [decodeResult, setDecodeResult] = useState<TypecodeDecodeResult | null>(null);
  const [codeSearchResult, setCodeSearchResult] = useState<CodeSearchResult | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [imageModalPictures, setImageModalPictures] = useState<NodePicture[]>([]);
  const [showLinksModal, setShowLinksModal] = useState(false);
  const [linksModalLinks, setLinksModalLinks] = useState<NodeLink[]>([]);

  const handleSearch = async () => {
    if (!searchCode.trim()) return;
    
    setIsChecking(true);
    
    try {
      const trimmed = searchCode.trim();
      const parts = trimmed.split(/[\s_-]+/);
      
      // Wenn nur ein Teil (einzelner Code): Verwende die neue search-code API
      if (parts.length === 1) {
        const searchRes = await searchCodeAllOccurrences(trimmed);
        setCodeSearchResult(searchRes);
        setCheckResult(null);
        setDecodeResult(null);
      } else {
        // Wenn mehrere Teile (vollständiger Typecode): Verwende alte APIs
        const [checkRes, decodeRes] = await Promise.all([
          checkNodeCode(trimmed),
          decodeTypecode(trimmed)
        ]);
        
        setCheckResult(checkRes);
        setDecodeResult(decodeRes);
        setCodeSearchResult(null);
      }
    } catch (error) {
      console.error('Search failed:', error);
      setCheckResult({ exists: false, families: [] });
      setDecodeResult(null);
      setCodeSearchResult(null);
    } finally {
      setIsChecking(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handleClose = () => {
    setSearchCode('');
    setCheckResult(null);
    setDecodeResult(null);
    setCodeSearchResult(null);
    onClose();
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 bg-black/60 grid place-items-center z-50" onClick={handleClose}>
      <div 
        className="bg-white border border-gray-300 rounded-xl w-[min(1200px,92vw)] max-h-[85vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-800">
            🔍Produktcode Checker & Entschlüsseler
          </h2>
          <button
            onClick={handleClose}
            className="text-gray-500 hover:text-gray-700 text-3xl font-bold leading-none"
          >
            ×
          </button>
        </div>

        {/* Search */}
        <div className="p-6 border-b border-gray-100">
          <div className="flex gap-3">
            <input
              type="text"
              placeholder="Produktcode eingeben (z.B. 'BCC M313 * OP123' oder 'XYZ123')..."
              className="flex-1 px-4 py-3 text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              value={searchCode}
              onChange={(e) => setSearchCode(e.target.value)}
              onKeyPress={handleKeyPress}
              autoFocus
            />
            <button
              onClick={handleSearch}
              disabled={!searchCode.trim() || isChecking}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed font-medium transition-colors"
            >
              {isChecking ? 'Analysiere...' : 'Prüfen & Entschlüsseln'}
            </button>
          </div>
          <p className="mt-2 text-sm text-gray-500">
            💡 Tipp: Verwende <code className="bg-gray-100 px-2 py-0.5 rounded">*</code> als Wildcard für beliebige Codes (z.B. <code className="bg-gray-100 px-2 py-0.5 rounded">BCC M313 * OP123</code>)
          </p>
        </div>

        {/* Results */}
        <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
          {/* Basic Check Result */}
          {checkResult && (
            <div className={`p-6 rounded-lg border-2 ${
              checkResult.exists 
                ? 'bg-green-50 border-green-300' 
                : 'bg-red-50 border-red-300'
            }`}>
              <div className="flex items-center gap-3 mb-4">
                <span className={`text-xl font-bold ${
                  checkResult.exists ? 'text-green-800' : 'text-red-800'
                }`}>
                  {checkResult.exists ? '✅ Code existiert' : '❌ Code nicht gefunden'}
                </span>
                {checkResult.product_type && (
                  <span className={`px-3 py-1 text-sm font-medium rounded-full ${
                    checkResult.product_type === 'complete_product'
                      ? 'bg-blue-100 text-blue-800'
                      : checkResult.product_type === 'product_family'
                      ? 'bg-purple-100 text-purple-800'
                      : checkResult.product_type === 'level_code'
                      ? 'bg-yellow-100 text-yellow-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}>
                    {checkResult.product_type === 'complete_product' && 'Vollständiges Produkt'}
                    {checkResult.product_type === 'product_family' && 'Produktfamilie'}
                    {checkResult.product_type === 'level_code' && 'Level-Code'}
                    {checkResult.product_type === 'partial_code' && 'Teilcode'}
                  </span>
                )}
              </div>
              
              {checkResult.exists && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-base">
                  <div>
                    <span className="font-medium text-gray-700">Level:</span>
                    <span className="ml-2 text-gray-900">{checkResult.level}</span>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Vollständig:</span>
                    <span className={`ml-2 font-medium ${
                      checkResult.is_complete_product ? 'text-green-600' : 'text-orange-600'
                    }`}>
                      {checkResult.is_complete_product ? 'Ja' : 'Nein'}
                    </span>
                  </div>
                  <div className="md:col-span-1">
                    <span className="font-medium text-gray-700">Produktfamilien:</span>
                    <span className="ml-2 text-gray-900">
                      {checkResult.families.length > 0 ? checkResult.families.join(', ') : 'Keine'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Detailed Decode Result */}
          {decodeResult && decodeResult.exists && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
              <h3 className="text-xl font-semibold text-gray-800 mb-4 flex items-center gap-2">
                Code-Aufschlüsselung
              </h3>
              
              {/* Original Input */}
              <div className="mb-5">
                {decodeResult.normalized_code && decodeResult.normalized_code !== decodeResult.original_input && (
                  <>
                    <span className="text-base font-medium text-gray-700">Normalisiert:</span>
                    <span className="ml-3 font-mono text-green-600 bg-green-50 px-3 py-1 rounded text-lg">
                      {decodeResult.normalized_code.split(' ').join('-')}
                    </span>
                  </>
                )}
              </div>

              {/* Group Name (Produktattribut) */}
              {decodeResult.group_name && (
                <div className="mb-5 bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <span className="font-medium text-blue-700">Produktfamilie:</span>
                  <span className="ml-2 text-blue-900">{decodeResult.group_name}</span>
                </div>
              )}

              {/* Path Segments */}
              <div className="space-y-4">
                <h4 className="font-medium text-gray-800 text-lg">Pfad-Segmente:</h4>
                <div className="space-y-3">
                  {decodeResult.path_segments.map((segment, index) => (
                    <div key={index} className="bg-white border border-gray-300 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <span className="bg-blue-100 text-blue-800 text-sm font-medium px-3 py-1 rounded">
                            Level {segment.level}
                          </span>
                          <span className="font-mono font-bold text-gray-800 text-lg">
                            {segment.code}
                          </span>
                          <InfoIcon
                            pictures={segment.pictures || []}
                            onClick={() => {
                              const pictures = segment.pictures || [];
                              if (pictures.length > 0) {
                                setImageModalPictures(pictures);
                                setShowImageModal(true);
                              }
                            }}
                          />
                          <LinkIcon
                            links={segment.links || []}
                            onClick={() => {
                              const links = segment.links || [];
                              console.log('LinkIcon clicked, links:', links);
                              if (links.length > 0) {
                                setLinksModalLinks(links);
                                setShowLinksModal(true);
                              }
                            }}
                          />
                        </div>
                        {segment.position_start && segment.position_end && (
                          <span className="text-sm text-gray-500">
                            Position {segment.position_start}-{segment.position_end}
                          </span>
                        )}
                      </div>

                      {segment.name && (
                        <div className="mb-2">
                          <span className="text-gray-600 font-medium">Name:</span>
                          <span className="ml-2 text-gray-900">{segment.name}</span>
                        </div>
                      )}
                      
                      {(segment.label || segment.label_en) && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-base">
                          {segment.label && (
                            <div>
                              <span className="text-gray-600 font-medium">Label:</span>
                              <div className="ml-2 text-gray-900 whitespace-pre-line">{segment.label}</div>
                            </div>
                          )}
                          {segment.label_en && (
                            <div>
                              <span className="text-gray-600 font-medium">Label EN:</span>
                              <div className="ml-2 text-gray-900 whitespace-pre-line">{segment.label_en}</div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* No Results Message */}
          {searchCode && checkResult && !checkResult.exists && (
            <div className="text-center py-8">
              <p className="text-gray-500 text-lg">
                Keine Treffer für "<span className="font-mono">{searchCode}</span>" gefunden.
              </p>
            </div>
          )}

          {/* Code Search Result (für einzelne Codes) */}
          {codeSearchResult && (
            <div className={`p-6 rounded-lg border-2 ${
              codeSearchResult.exists 
                ? 'bg-green-50 border-green-300' 
                : 'bg-red-50 border-red-300'
            }`}>
              <div className="flex items-center gap-3 mb-4">
                <span className={`text-xl font-bold ${
                  codeSearchResult.exists ? 'text-green-800' : 'text-red-800'
                }`}>
                  {codeSearchResult.exists ? '✅ Code gefunden' : '❌ Code nicht gefunden'}
                </span>
                <span className="px-3 py-1 text-sm font-medium rounded-full bg-blue-100 text-blue-800">
                  Codesegment
                </span>
              </div>

              {codeSearchResult.exists && codeSearchResult.occurrences.length > 0 && (
                <div className="space-y-4">
                  <div className="mb-4">
                    <span className="text-gray-700 font-medium">Code:</span>
                    <span className="ml-2 font-mono font-bold text-xl text-gray-900">{codeSearchResult.code}</span>
                  </div>

                  <div className="mb-2 text-sm text-gray-600">
                    Dieser Code kommt an <span className="font-semibold">{codeSearchResult.occurrences.length}</span> verschiedenen Stellen vor:
                  </div>

                  {/* Gruppiert nach Familie */}
                  {(() => {
                    // Gruppiere occurrences nach Familie
                    const byFamily = codeSearchResult.occurrences.reduce((acc, occ) => {
                      if (!acc[occ.family]) {
                        acc[occ.family] = [];
                      }
                      acc[occ.family].push(occ);
                      return acc;
                    }, {} as Record<string, CodeOccurrence[]>);

                    return Object.entries(byFamily).map(([family, occs]) => (
                      <div key={family} className="bg-white border border-gray-300 rounded-lg p-4 mb-3">
                        <div className="flex items-center gap-2 mb-3">
                          <span className="bg-purple-100 text-purple-800 text-sm font-semibold px-3 py-1 rounded">
                            Produktfamilie: {family}
                          </span>
                          {occs.length > 1 && (
                            <span className="text-xs text-gray-500">
                              ({occs.length} Level)
                            </span>
                          )}
                        </div>

                        {/* Levels innerhalb dieser Familie */}
                        <div className="space-y-3 ml-4">
                          {occs.map((occ) => (
                            <div key={`${family}-${occ.level}`} className="border-l-4 border-blue-300 pl-4 py-2 bg-gray-50 rounded">
                              <div className="flex items-center gap-3 mb-2">
                                <span className="bg-blue-100 text-blue-800 text-sm font-medium px-3 py-1 rounded">
                                  Level {occ.level}
                                </span>
                                <span className="text-xs text-gray-500">
                                  {occ.node_count} {occ.node_count === 1 ? 'Node' : 'Nodes'}
                                </span>
                              </div>

                              {/* Names */}
                              {occ.names.length > 0 && (
                                <div className="mb-2">
                                  <span className="text-sm font-medium text-gray-700">Namen:</span>
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {occ.names.map((name, idx) => (
                                      <span key={idx} className="bg-purple-100 text-purple-800 text-xs font-medium px-2 py-1 rounded">
                                        {name}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Labels DE */}
                              {occ.labels_de.length > 0 && (
                                <div className="mb-2">
                                  <span className="text-sm font-medium text-gray-700">Labels (DE):</span>
                                  <div className="mt-1 space-y-1">
                                    {occ.labels_de.map((label, idx) => (
                                      <div key={idx} className="text-sm text-gray-900 ml-2 whitespace-pre-line">
                                        • {label}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Labels EN */}
                              {occ.labels_en.length > 0 && (
                                <div>
                                  <span className="text-sm font-medium text-gray-700">Labels (EN):</span>
                                  <div className="mt-1 space-y-1">
                                    {occ.labels_en.map((label, idx) => (
                                      <div key={idx} className="text-sm text-gray-900 ml-2 whitespace-pre-line">
                                        • {label}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              )}

              {!codeSearchResult.exists && (
                <div className="text-center py-8">
                  <p className="text-gray-500 text-lg">
                    Der Code "<span className="font-mono font-bold">{codeSearchResult.code}</span>" existiert nicht in der Datenbank.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Image Modal */}
      {showImageModal && imageModalPictures.length > 0 && (
        <ImageModal
          pictures={imageModalPictures}
          onClose={() => setShowImageModal(false)}
        />
      )}

      {/* Links Modal */}
      {showLinksModal && linksModalLinks.length > 0 && (
        <LinksList
          links={linksModalLinks}
          onClose={() => setShowLinksModal(false)}
        />
      )}
    </div>,
    document.body
  );
};

// ============================================================
// Source Path Selector Component (für Deep Copy)
// ============================================================
interface SourcePathSelectorProps {
  startLevel: number;
  familyCode: string;
  initialCode: string;
  initialIds: number[];
  selections: Record<number, AvailableOption>;
  onSelectionChange: (level: number, option: AvailableOption | null) => void;
}

const SourcePathSelector: React.FC<SourcePathSelectorProps> = ({
  startLevel,
  familyCode,
  initialCode,
  initialIds,
  selections,
  onSelectionChange
}) => {
  console.log('🎯 SourcePathSelector render:', { 
    startLevel, 
    initialCode, 
    initialIds, 
    initialIdsLength: initialIds?.length,
    selections 
  });
  
  // Bestimme maximales Level basierend auf Selektionen, mindestens startLevel + 1
  const maxSelectedLevel = Math.max(startLevel + 1, ...Object.keys(selections).map(k => parseInt(k)));
  
  // Rendere Level-Selektoren vom startLevel+1 bis zum maxSelectedLevel
  const renderLevelSelectors = () => {
    const selectors = [];
    
    console.log('📝 renderLevelSelectors: maxSelectedLevel=', maxSelectedLevel);
    
    for (let lvl = startLevel + 1; lvl <= maxSelectedLevel + 1; lvl++) {
      const parentIds = lvl === startLevel + 1 
        ? initialIds 
        : (selections[lvl - 1]?.ids || []);
      
      console.log(`  Level ${lvl}: parentIds=`, parentIds, 'shouldShow=', lvl === startLevel + 1 || selections[lvl - 1]);
      
      // Zeige immer mindestens den ersten Selektor
      // Für weitere Selektoren: Nur zeigen wenn Parent ausgewählt wurde
      if (lvl === startLevel + 1 || selections[lvl - 1]) {
        selectors.push(
          <SourceLevelSelector
            key={lvl}
            level={lvl}
            familyCode={familyCode}
            parentLevel={lvl - 1}
            parentIds={parentIds}
            selectedOption={selections[lvl]}
            onSelect={(option) => onSelectionChange(lvl, option)}
          />
        );
      }
      
      // Stoppe wenn kein nächstes Level ausgewählt wurde (aber nicht beim ersten)
      if (lvl > startLevel + 1 && !selections[lvl]) break;
    }
    
    console.log(`📊 Rendered ${selectors.length} selectors`);
    return selectors;
  };
  
  if (initialIds.length === 0) {
    console.log('❌ No initialIds, returning null');
    return null;
  }
  
  return (
    <div className="space-y-3 bg-purple-50 border border-purple-200 rounded-lg p-3">
      <div className="text-sm font-medium text-purple-900">
        🎯 Pfad-Auswahl für Deep Copy
      </div>
      <div className="text-xs text-purple-700 mb-2">
        Wähle den genauen Pfad aus, der kopiert werden soll:
      </div>
      {renderLevelSelectors()}
    </div>
  );
};

// Source Level Selector für einen einzelnen Level im Source-Pfad
interface SourceLevelSelectorProps {
  level: number;
  familyCode: string;
  parentLevel: number;
  parentIds: number[];
  selectedOption?: AvailableOption;
  onSelect: (option: AvailableOption | null) => void;
}

const SourceLevelSelector: React.FC<SourceLevelSelectorProps> = ({
  level,
  familyCode,
  parentIds,
  selectedOption,
  onSelect
}) => {
  console.log(`🔽 SourceLevelSelector[${level}]: parentIds=`, parentIds, 'count=', parentIds.length);
  
  // Query für Children basierend auf parent IDs
  const childrenQuery = useQuery({
    queryKey: ['source-children', level, parentIds],
    queryFn: async () => {
      console.log(`  🌐 Fetching children for level ${level}, parentIds:`, parentIds);
      if (parentIds.length === 0) return [];
      
      // Hole alle Children für alle Parent-IDs
      const allChildren: AvailableOption[] = [];
      const seenCodes = new Set<string>();
      
      for (const parentId of parentIds) {
        const response = await fetch(`http://localhost:8000/api/nodes/by-id/${parentId}/children`);
        const children = await response.json();
        console.log(`    Got ${children.length} children for parent ${parentId}:`, children);
        
        // Fasse gleiche Codes zusammen
        children.forEach((child: AvailableOption) => {
          if (!seenCodes.has(child.code)) {
            seenCodes.add(child.code);
            // Sammle alle IDs für diesen Code
            const sameCodeChildren = children.filter((c: AvailableOption) => c.code === child.code);
            child.ids = sameCodeChildren.map((c: AvailableOption) => c.id!);
            // Setze auch 'id' auf die erste ID (wichtig für sourceId Logik!)
            child.id = child.ids && child.ids.length > 0 ? child.ids[0] : child.id;
            allChildren.push(child);
          }
        });
      }
      
      console.log(`  ✅ Aggregated ${allChildren.length} unique codes for level ${level}`);
      return allChildren;
    },
    enabled: parentIds.length > 0,
    staleTime: 0,
  });
  
  const options = childrenQuery.data || [];
  
  console.log(`  Selector state for level ${level}:`, {
    isFetching: childrenQuery.isFetching,
    optionsCount: options.length,
    willReturn: options.length === 0 && !childrenQuery.isFetching ? 'null' : 'select'
  });
  
  if (options.length === 0 && !childrenQuery.isFetching) {
    console.log(`  ❌ No options for level ${level}, returning null`);
    return null; // Keine Children = Ende des Pfads
  }
  
  console.log(`  ✅ Rendering select for level ${level} with ${options.length} options`);
  
  return (
    <div>
      <label className="block text-xs font-medium text-purple-700 mb-1">
        Level {level}
      </label>
      <select
        value={selectedOption?.code || ''}
        onChange={(e) => {
          const selected = options.find(opt => opt.code === e.target.value);
          onSelect(selected || null);
        }}
        className="w-full px-3 py-2 text-sm border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white"
      >
        <option value="">-- Optional auswählen --</option>
        {options.map((option) => (
          <option key={option.code} value={option.code}>
            {option.code} {option.label ? `- ${option.label}` : ''}
            {option.ids && option.ids.length > 1 ? ` (${option.ids.length} Pfade)` : ''}
          </option>
        ))}
      </select>
      {childrenQuery.isFetching && (
        <div className="text-xs text-purple-600 mt-1">Lädt...</div>
      )}
    </div>
  );
};

// ============================================================
// Smart Add Node Modal Component
// ============================================================
interface SmartAddNodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  familyCode: string;
  level: number;
  parentSelections: Record<number, AvailableOption>;
}

const SmartAddNodeModal: React.FC<SmartAddNodeModalProps> = ({ 
  isOpen, 
  onClose, 
  familyCode, 
  level, 
  parentSelections 
}) => {
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [labelEn, setLabelEn] = useState('');
  const [name, setName] = useState('');
  const [groupName, setGroupName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{success: boolean; message: string} | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [parentId, setParentId] = useState<number | null>(null);
  
  // Deep Copy States
  const [copyChildren, setCopyChildren] = useState(false);
  const [sourceNodeSearch, setSourceNodeSearch] = useState('');
  const [selectedSourceNode, setSelectedSourceNode] = useState<any>(null);
  const [showSourceSuggestions, setShowSourceSuggestions] = useState(false);
  const [sourcePathSelections, setSourcePathSelections] = useState<Record<number, AvailableOption>>({}); // Level -> selected option im Source-Pfad
  const [maxSourceLevel, setMaxSourceLevel] = useState<number>(level); // Bis zu welchem Level soll kopiert werden

  // Query for code suggestions
  const suggestionsQuery = useQuery({
    queryKey: ['code-suggestions', code, familyCode, level],
    queryFn: () => suggestCodes(code, familyCode, level, 10),
    enabled: code.length > 0 && isOpen,
    staleTime: 0,
  });

  // Query for code existence check
  const existsQuery = useQuery({
    queryKey: ['code-exists', code, familyCode, level, parentId],
    queryFn: () => {
      console.log(`🔍 Checking code existence: code="${code}", level=${level}, parentId=${parentId}`);
      return checkCodeExists(code, familyCode, level, parentId || undefined);
    },
    enabled: code.length > 0 && isOpen,
    staleTime: 0,
  });

  // Query for constraint validation
  const constraintQuery = useQuery({
    queryKey: ['constraint-validation', code, level, parentSelections],
    queryFn: async () => {
      const prevSelections: Record<number, string> = {};
      Object.entries(parentSelections).forEach(([lvl, opt]) => {
        prevSelections[parseInt(lvl)] = opt.code;
      });
      console.log(`🔍 Validating constraints: code="${code}", level=${level}, prevSelections=`, prevSelections);
      return validateCodeAgainstConstraints(code, level, prevSelections);
    },
    enabled: code.length > 0 && isOpen,
    staleTime: 0,
  });

  const suggestions = suggestionsQuery.data?.suggestions || [];
  const codeExists = existsQuery.data?.exists || false;
  const constraintValidation = constraintQuery.data;
  const hasConstraintViolation = constraintValidation && !constraintValidation.is_valid;
  
  // Debug logging
  useEffect(() => {
    if (code.length > 0) {
      console.log(`📊 State: code="${code}", codeExists=${codeExists}, existsQuery.data=`, existsQuery.data, 'parentId=', parentId);
    }
  }, [code, codeExists, existsQuery.data, parentId]);
  
  // Query for source node suggestions (autocomplete)
  const sourceNodesQuery = useQuery({
    queryKey: ['source-nodes', level, sourceNodeSearch, familyCode],
    queryFn: async () => {
      const response = await fetch(
        `http://localhost:8000/api/nodes/autocomplete?level=${level}&search=${encodeURIComponent(sourceNodeSearch)}&family=${encodeURIComponent(familyCode)}`
      );
      return response.json();
    },
    enabled: copyChildren && isOpen, // Load immediately when checkbox is checked
    staleTime: 0,
  });
  
  const sourceNodeSuggestions = sourceNodesQuery.data || [];
  
  // Query for subtree info (preview) - berechnet basierend auf sourcePathSelections
  const subtreeInfoQuery = useQuery({
    queryKey: ['subtree-info', selectedSourceNode?.ids, sourcePathSelections, maxSourceLevel],
    queryFn: async () => {
      // Verwende die ID des tiefsten ausgewählten Levels
      let nodeId: number | null = null;
      
      // Finde die tiefste Auswahl im Source-Pfad
      for (let lvl = maxSourceLevel; lvl >= level; lvl--) {
        if (sourcePathSelections[lvl]?.id) {
          nodeId = sourcePathSelections[lvl].id!;
          break;
        }
      }
      
      // Fallback: Verwende erste ID vom selectedSourceNode
      if (!nodeId && selectedSourceNode?.ids?.[0]) {
        nodeId = selectedSourceNode.ids[0];
      }
      
      if (!nodeId) return null;
      
      const response = await fetch(`http://localhost:8000/api/nodes/${nodeId}/subtree-info`);
      return response.json();
    },
    enabled: !!selectedSourceNode && selectedSourceNode.ids && selectedSourceNode.ids.length > 0 && copyChildren && isOpen,
    staleTime: 0,
  });
  
  const subtreeInfo = subtreeInfoQuery.data;

  // Reset form when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setCode('');
      setLabel('');
      setLabelEn('');
      setName('');
      setGroupName('');
      setResult(null);
      setShowSuggestions(false);
      setCopyChildren(false);
      setSourceNodeSearch('');
      setSelectedSourceNode(null);
      setShowSourceSuggestions(false);
      setParentId(null);
      setSourcePathSelections({});
      setMaxSourceLevel(level);
    } else {
      // Load parent ID when modal opens
      getParentId().then(id => setParentId(id));
    }
  }, [isOpen]);

  // Determine parent_id from selections
  const getParentId = async (): Promise<number | null> => {
    console.log(`getParentId called for level ${level}, familyCode: ${familyCode}`);
    
    if (level === 1) {
      // Level 1 nodes need the family as parent
      try {
        const url = `http://localhost:8000/api/nodes/search?level=0&prefix=${encodeURIComponent(familyCode)}`;
        console.log('Fetching family ID from:', url);
        const response = await fetch(url);
        const data = await response.json();
        console.log('Family search response:', data);
        if (data.options && data.options.length > 0) {
          console.log('Found family ID:', data.options[0].id);
          return data.options[0].id;
        }
      } catch (error) {
        console.error('Error fetching family ID:', error);
      }
      console.warn('No family found, returning null');
      return null;
    }

    // For level 2+, get parent from selections (level - 1)
    const parentOption = parentSelections[level - 1];
    console.log(`Parent selection for level ${level - 1}:`, parentOption);
    
    if (!parentOption) {
      console.error(`No parent selection found for level ${level}`);
      return null;
    }

    // Fetch parent node ID by code and level
    try {
      const parentLevel = level - 1;
      const url = `http://localhost:8000/api/nodes/search?level=${parentLevel}&prefix=${encodeURIComponent(parentOption.code)}&family=${encodeURIComponent(familyCode)}`;
      console.log('Fetching parent ID from:', url);
      const response = await fetch(url);
      const data = await response.json();
      console.log('Parent search response:', data);
      if (data.options && data.options.length > 0) {
        console.log('Found parent ID:', data.options[0].id);
        return data.options[0].id;
      }
    } catch (error) {
      console.error('Error fetching parent ID:', error);
    }
    console.warn('No parent found, returning null');
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (codeExists) {
      setResult({ success: false, message: 'Code existiert bereits auf diesem Level!' });
      return;
    }

    setIsSubmitting(true);
    setResult(null);

    try {
      const parent_id = await getParentId();
      
      const requestData = {
        code: code.trim(),
        name: name.trim() || "",
        label: label.trim() || "",
        label_en: labelEn.trim() || null,
        group_name: groupName.trim() || null,
        level,
        parent_id,
        position: 0,
        pattern: null,
      };
      
      console.log('Creating node with data:', requestData);

      // Wähle Endpoint basierend auf copyChildren Flag
      const endpoint = copyChildren && selectedSourceNode 
        ? 'http://localhost:8000/api/nodes/with-children' 
        : 'http://localhost:8000/api/nodes';
      
      // Verwende die ID des tiefsten ausgewählten Levels im Source-Pfad
      let sourceId: number | null = null;
      for (let lvl = maxSourceLevel; lvl >= level; lvl--) {
        if (sourcePathSelections[lvl]?.id) {
          sourceId = sourcePathSelections[lvl].id!;
          console.log(`✅ Using sourceId from level ${lvl}:`, sourceId, sourcePathSelections[lvl]);
          break;
        }
      }
      
      // Fallback: Verwende erste ID vom selectedSourceNode
      if (!sourceId && selectedSourceNode?.ids?.[0]) {
        sourceId = selectedSourceNode.ids[0];
        console.log(`⚠️ Fallback: Using first ID from selectedSourceNode:`, sourceId);
      }
      
      console.log('📦 Final sourceId for Deep Copy:', sourceId);
      console.log('📦 All sourcePathSelections:', sourcePathSelections);
      
      const bodyData = copyChildren && selectedSourceNode && sourceId
        ? { ...requestData, source_node_id: sourceId }
        : requestData;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyData)
      });

      if (!response.ok) {
        let errorMessage = 'Failed to create node';
        try {
          const error = await response.json();
          // Handle FastAPI validation errors
          if (error.detail) {
            if (Array.isArray(error.detail)) {
              // Pydantic validation errors
              errorMessage = error.detail.map((err: any) => 
                `${err.loc.join('.')}: ${err.msg}`
              ).join(', ');
            } else if (typeof error.detail === 'string') {
              errorMessage = error.detail;
            } else {
              errorMessage = JSON.stringify(error.detail);
            }
          }
        } catch {
          errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      const responseData = await response.json();
      const message = copyChildren && responseData.nodes_created 
        ? `Node erstellt mit ${responseData.nodes_created - 1} kopierten Children!`
        : 'Node erfolgreich erstellt!';
      
      setResult({ success: true, message });
      
      // Invalidate queries to refresh UI
      queryClient.invalidateQueries({ queryKey: ['families'] });
      queryClient.invalidateQueries({ queryKey: ['product-families'] });
      // Invalidate all level-options from this level and above
      for (let i = level; i <= 20; i++) {
        queryClient.invalidateQueries({ queryKey: ['level-options', i] });
      }
      
      // Close modal after brief success message
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (error) {
      console.error('Create node error:', error);
      setResult({ 
        success: false, 
        message: error instanceof Error ? error.message : 'Fehler beim Erstellen des Nodes'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setCode(suggestion);
    setShowSuggestions(false);
  };

  if (!isOpen) return null;

  return createPortal(
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Node Hinzufügen</h2>
            <p className="text-sm text-gray-600 mt-1">
              Familie: <span className="font-mono font-semibold">{familyCode}</span> · 
              Level: <span className="font-semibold">{level}</span>
              {level > 1 && parentSelections[level - 1] && (
                <> · Parent: <span className="font-mono font-semibold">{parentSelections[level - 1].code}</span></>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Code Field (Required) with Suggestions and Validation */}
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Code * 
              {codeExists && <span className="ml-2 text-red-600 text-xs">⚠ Code existiert bereits</span>}
              {hasConstraintViolation && !codeExists && (
                <span className="ml-2 text-amber-600 text-xs">⚠ Verstößt gegen Constraint</span>
              )}
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                codeExists ? 'border-red-500 bg-red-50' : 
                hasConstraintViolation ? 'border-amber-500 bg-amber-50' : 
                'border-gray-300'
              }`}
              placeholder="z.B. XB150"
              required
              autoFocus
            />
            
            {/* Constraint Violation Warning */}
            {hasConstraintViolation && constraintValidation && (
              <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm">
                <div className="flex items-start gap-2">
                  <span className="text-amber-600 font-semibold">⚠️</span>
                  <div className="flex-1">
                    <p className="text-amber-800 font-medium">{constraintValidation.message}</p>
                    {constraintValidation.violated_constraints.map((constraint, idx) => (
                      <div key={idx} className="mt-2 text-xs text-amber-700">
                        <strong>Regel {constraint.id}:</strong> {constraint.description || 'Keine Beschreibung'}
                        <button
                          type="button"
                          onClick={() => {
                            // Öffne Constraints-Modal und zeige diese Regel
                            alert(`TODO: Öffne Constraints-Modal für Regel ${constraint.id}`);
                          }}
                          className="ml-2 text-blue-600 hover:text-blue-800 underline"
                        >
                          Regel anzeigen
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            
            {/* Suggestions Dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs text-gray-600 font-medium">
                  Ähnliche Codes:
                </div>
                {suggestions.map((suggestion, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSuggestionClick(suggestion)}
                    className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm font-mono transition-colors border-b border-gray-100 last:border-b-0"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
            
            {/* Loading Indicator */}
            {suggestionsQuery.isFetching && (
              <div className="absolute right-3 top-9 text-gray-400">
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
            )}
          </div>

          {/* Code Hints - zeigt Struktur basierend auf Parent Node */}
          {code.length > 0 && parentId && (
            <CodeHints 
              nodeId={parentId}
              partialCode={code}
              className="mt-3"
            />
          )}

          {/* Optional Fields */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Label</label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Deutsches Label"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Label EN</label>
              <input
                type="text"
                value={labelEn}
                onChange={(e) => setLabelEn(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="English Label"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Interner Name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Gruppe</label>
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Group Name"
              />
            </div>
          </div>

          {/* Deep Copy Section */}
          <div className="border-t border-gray-200 pt-4">
            <div className="flex items-center mb-3">
              <input
                type="checkbox"
                id="copyChildren"
                checked={copyChildren}
                onChange={(e) => {
                  setCopyChildren(e.target.checked);
                  if (!e.target.checked) {
                    setSelectedSourceNode(null);
                    setSourceNodeSearch('');
                  }
                }}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <label htmlFor="copyChildren" className="ml-2 text-sm font-medium text-gray-700">
                Children von anderem Node kopieren (Deep Copy)
              </label>
            </div>

            {copyChildren && (
              <div className="ml-6 space-y-3">
                {/* Source Node Autocomplete */}
                <div className="relative">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Quell-Node (gleicher Level)
                  </label>
                  <input
                    type="text"
                    value={selectedSourceNode ? `${selectedSourceNode.code} - ${selectedSourceNode.label || 'Kein Label'}` : sourceNodeSearch}
                    onChange={(e) => {
                      setSourceNodeSearch(e.target.value);
                      setSelectedSourceNode(null);
                      setShowSourceSuggestions(true);
                    }}
                    onFocus={() => setShowSourceSuggestions(true)}
                    onBlur={() => {
                      // Delay to allow click on suggestion
                      setTimeout(() => setShowSourceSuggestions(false), 200);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Suche nach Code oder Label..."
                  />

                  {/* Source Node Suggestions */}
                  {showSourceSuggestions && !selectedSourceNode && sourceNodeSuggestions.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                      <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs text-gray-600 font-medium">
                        Verfügbare Nodes ({sourceNodeSuggestions.length} Codes):
                      </div>
                      {sourceNodeSuggestions.map((node: any, index: number) => (
                        <button
                          key={`${node.code}-${index}`}
                          type="button"
                          onClick={() => {
                            setSelectedSourceNode(node);
                            setShowSourceSuggestions(false);
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-blue-50 transition-colors border-b border-gray-100 last:border-b-0"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-mono font-semibold text-sm text-gray-900">{node.code || 'NULL'}</div>
                              <div className="text-xs text-gray-600">{node.label || node.label_en || 'Kein Label'}</div>
                            </div>
                            {node.ids && node.ids.length > 1 && (
                              <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                                {node.ids.length} Pfade
                              </span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Loading Indicator */}
                  {sourceNodesQuery.isFetching && (
                    <div className="absolute right-3 top-9 text-gray-400">
                      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    </div>
                  )}
                </div>

                {/* Schrittweise Level-Auswahl für Deep Copy Pfad */}
                {selectedSourceNode && selectedSourceNode.code && (() => {
                  console.log('🔍 SourcePathSelector Debug:', {
                    selectedSourceNode,
                    code: selectedSourceNode.code,
                    ids: selectedSourceNode.ids,
                    idsLength: selectedSourceNode.ids?.length
                  });
                  return (
                    <SourcePathSelector
                      startLevel={level}
                      familyCode={familyCode}
                      initialCode={selectedSourceNode.code}
                      initialIds={selectedSourceNode.ids || []}
                      selections={sourcePathSelections}
                      onSelectionChange={(lvl: number, option: AvailableOption | null) => {
                        const newSelections = { ...sourcePathSelections };
                        if (option) {
                          newSelections[lvl] = option;
                          // Setze maxSourceLevel auf das höchste ausgewählte Level
                          setMaxSourceLevel(Math.max(lvl, maxSourceLevel));
                          // Lösche alle Selektionen nach diesem Level
                          Object.keys(newSelections).forEach(key => {
                            const keyNum = parseInt(key);
                            if (keyNum > lvl) {
                              delete newSelections[keyNum];
                            }
                          });
                        } else {
                          delete newSelections[lvl];
                        }
                        setSourcePathSelections(newSelections);
                      }}
                    />
                  );
                })()}

                {/* Preview - Subtree Info */}
                {selectedSourceNode && subtreeInfo && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <div className="text-sm text-blue-900">
                      <div className="font-semibold mb-1">📋 Preview:</div>
                      <div>
                        Wird <span className="font-bold">{subtreeInfo.descendant_count}</span> Nodes kopieren
                        {subtreeInfo.tree_depth > 0 && (
                          <span> ({subtreeInfo.tree_depth} Levels tief)</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* No children warning */}
                {selectedSourceNode && subtreeInfo && subtreeInfo.descendant_count === 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
                    ⚠️ Dieser Node hat keine Children zum Kopieren
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Result Message */}
          {result && (
            <div className={`p-4 rounded-lg ${result.success ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
              <p className="font-medium">{result.message}</p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
              disabled={isSubmitting}
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !code.trim() || codeExists || hasConstraintViolation}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
            >
              {isSubmitting ? 'Erstelle...' : 'Node Erstellen'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};

// ============================================================
// Edit Node Modal Component
// ============================================================
interface EditNodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  node: AvailableOption | null;
  onSaved: () => void;
  familyCode: string;
  parentSelections: Record<number, AvailableOption>;
  level: number;
}

// Helper function to parse labels into table format
const parseLabel = (labelText: string | null | undefined): { title: string; description: string }[] => {
  if (!labelText) return [];
  
  console.log('parseLabel input:', labelText);
  
  // Normalisiere mehrere \n zu \n\n (2 oder mehr -> genau 2)
  const normalized = labelText.replace(/\n{2,}/g, '\n\n');
  
  // Splitte bei \n\n um Einträge zu trennen
  const blocks = normalized.split('\n\n').filter(block => block.trim().length > 0);
  
  console.log('parseLabel blocks:', blocks);
  
  const entries: { title: string; description: string }[] = [];
  
  for (const block of blocks) {
    const trimmedBlock = block.trim();
    
    // Check if block contains a colon (title: description format)
    const colonIndex = trimmedBlock.indexOf(':');
    if (colonIndex > 0) {
      entries.push({
        title: trimmedBlock.substring(0, colonIndex).trim(),
        description: trimmedBlock.substring(colonIndex + 1).trim()
      });
    } else {
      // Kein Doppelpunkt gefunden - verwende den ganzen Block als Description
      entries.push({
        title: '',
        description: trimmedBlock
      });
    }
  }
  
  console.log('parseLabel result:', entries);
  return entries;
};

// Convert entries back to label format
const entriesToLabel = (entries: { title: string; description: string }[]): string => {
  return entries.map(entry => `${entry.title}: ${entry.description}`).join('\n\n');
};

const EditNodeModal: React.FC<EditNodeModalProps> = ({ isOpen, onClose, node, onSaved, familyCode, parentSelections, level }) => {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [groupName, setGroupName] = useState('');
  const [labelEntries, setLabelEntries] = useState<{ title: string; description: string }[]>([]);
  const [labelEnEntries, setLabelEnEntries] = useState<{ title: string; description: string }[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{success: boolean; message: string} | null>(null);
  const [updateAllWithCode, setUpdateAllWithCode] = useState(true);
  const [pictures, setPictures] = useState<NodePicture[]>([]);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showImageModal, setShowImageModal] = useState(false);
  const [imageModalIndex, setImageModalIndex] = useState(0);
  const [links, setLinks] = useState<NodeLink[]>([]);
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const [newLinkTitle, setNewLinkTitle] = useState('');
  const [newLinkDescription, setNewLinkDescription] = useState('');
  const [isAddingLink, setIsAddingLink] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [showLinksModal, setShowLinksModal] = useState(false);

  // Load node data when modal opens
  useEffect(() => {
    if (isOpen && node) {
      setCode(node.code || '');
      setName(node.name || '');
      setGroupName(node.group_name || '');
      setLabelEntries(parseLabel(node.label));
      setLabelEnEntries(parseLabel(node.label_en));
      setPictures(node.pictures || []);
      setLinks(node.links || []);
      setResult(null);
      setUploadError(null);
      setLinkError(null);
    }
  }, [isOpen, node]);

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !node?.id) return;

    setIsUploadingImage(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('description', `Uploaded ${new Date().toLocaleDateString()}`);

      const response = await fetch(`http://localhost:8000/api/nodes/${node.id}/upload-image`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Upload fehlgeschlagen');
      }

      const newPicture: NodePicture = await response.json();
      setPictures([...pictures, newPicture]);
      
      // Reset file input
      event.target.value = '';
    } catch (error) {
      console.error('Image upload error:', error);
      setUploadError(error instanceof Error ? error.message : 'Fehler beim Hochladen');
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handleImageDelete = async (filename: string) => {
    if (!node?.id || !confirm('Bild wirklich löschen?')) return;

    try {
      const response = await fetch(`http://localhost:8000/api/nodes/${node.id}/images/${filename}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Löschen fehlgeschlagen');
      }

      setPictures(pictures.filter(p => !p.url.endsWith(filename)));
    } catch (error) {
      console.error('Image delete error:', error);
      setUploadError(error instanceof Error ? error.message : 'Fehler beim Löschen');
    }
  };

  const handleLinkAdd = async () => {
    if (!node?.id || !newLinkUrl.trim() || !newLinkTitle.trim()) {
      setLinkError('URL und Titel sind erforderlich');
      return;
    }

    setIsAddingLink(true);
    setLinkError(null);

    try {
      const formData = new FormData();
      formData.append('url', newLinkUrl.trim());
      formData.append('title', newLinkTitle.trim());
      if (newLinkDescription.trim()) {
        formData.append('description', newLinkDescription.trim());
      }

      const response = await fetch(`http://localhost:8000/api/nodes/${node.id}/links`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Link hinzufügen fehlgeschlagen');
      }

      const newLink: NodeLink = await response.json();
      setLinks([...links, newLink]);
      
      // Reset form
      setNewLinkUrl('');
      setNewLinkTitle('');
      setNewLinkDescription('');
    } catch (error) {
      console.error('Link add error:', error);
      setLinkError(error instanceof Error ? error.message : 'Fehler beim Hinzufügen');
    } finally {
      setIsAddingLink(false);
    }
  };

  const handleLinkDelete = async (url: string) => {
    if (!node?.id || !confirm('Link wirklich löschen?')) return;

    try {
      const response = await fetch(`http://localhost:8000/api/nodes/${node.id}/links?url=${encodeURIComponent(url)}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Löschen fehlgeschlagen');
      }

      setLinks(links.filter(l => l.url !== url));
    } catch (error) {
      console.error('Link delete error:', error);
      setLinkError(error instanceof Error ? error.message : 'Fehler beim Löschen');
    }
  };

  const handleSave = async () => {
    if (!node) return;
    
    setIsSubmitting(true);
    setResult(null);

    try {
      let nodeIds: number[];
      
      if (updateAllWithCode) {
        // Hole ALLE IDs mit diesem Code und Level (unabhängig von Kompatibilität!)
        const allIdsResponse = await getAllNodeIdsByCodeLevel(node.code, node.level);
        nodeIds = allIdsResponse.ids;
      } else {
        // Finde die spezifische Node-ID basierend auf Parent-Pfad
        const parentCodesArray: string[] = [];
        for (let i = 1; i < level; i++) {
          if (parentSelections[i]) {
            parentCodesArray.push(parentSelections[i].code);
          }
        }
        
        const result = await findNodeIdByPath(
          node.code,
          level,
          familyCode,
          parentCodesArray
        );
        
        if (result.found && result.node_id) {
          nodeIds = [result.node_id];
        } else {
          throw new Error(`Keine Node gefunden für Code ${node.code} mit dem aktuellen Pfad`);
        }
      }
      
      console.log('EditNodeModal - Saving node:', {
        code: node.code,
        level: node.level,
        update_mode: updateAllWithCode ? 'all' : 'specific',
        node_ids: nodeIds,
        ids_count: nodeIds.length
      });
      
      if (!nodeIds || nodeIds.length === 0) {
        throw new Error('Keine Nodes mit diesem Code gefunden');
      }

      // Verwende Bulk-Update um ALLE Nodes mit diesem Code zu aktualisieren
      // Sende immer alle Felder (auch leere Strings zum Löschen)
      const updates: any = {
        name: name.trim(),
        label: entriesToLabel(labelEntries),
        label_en: entriesToLabel(labelEnEntries),
        group_name: groupName.trim(),
      };
      
      console.log('Updates to send:', updates);
      
      const response = await bulkUpdateNodes({
        node_ids: nodeIds,
        updates
      });

      console.log('Update response:', response);

      setResult({ 
        success: true, 
        message: `${response.updated_count} Node(s) erfolgreich aktualisiert!` 
      });
      
      // Notify parent and close
      setTimeout(() => {
        onSaved();
        onClose();
      }, 1500);
    } catch (error) {
      console.error('Update node error:', error);
      setResult({ 
        success: false, 
        message: error instanceof Error ? error.message : 'Fehler beim Aktualisieren'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen || !node) return null;

  return createPortal(
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex justify-between items-start mb-3">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Node Bearbeiten</h2>
              <p className="text-sm text-gray-600 mt-1">
                Code: <span className="font-mono font-semibold">{node.code}</span>
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          {/* Update Scope Toggle */}
          <div className="flex items-center gap-3 bg-gray-50 px-4 py-3 rounded-lg">
            <span className="text-sm font-medium text-gray-700">Update-Bereich:</span>
            <button
              onClick={() => setUpdateAllWithCode(!updateAllWithCode)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                updateAllWithCode 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              🌐 Alle Nodes mit Code "{node.code}"
            </button>
            <button
              onClick={() => setUpdateAllWithCode(!updateAllWithCode)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                !updateAllWithCode 
                  ? 'bg-green-600 text-white' 
                  : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              🎯 Nur dieser spezifische Node
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Basic Fields */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Code
                <span className="text-xs text-gray-500 ml-2">(nicht änderbar)</span>
              </label>
              <input
                type="text"
                value={code}
                disabled
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-100 cursor-not-allowed text-gray-600"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Group Name</label>
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Label (German) Table */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-gray-700">Label (Deutsch)</label>
              <button
                onClick={() => setLabelEntries([...labelEntries, { title: '', description: '' }])}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                + Zeile hinzufügen
              </button>
            </div>
            <div className="border border-gray-300 rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 w-1/3">Titel</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-700">Beschreibung</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {labelEntries.map((entry, idx) => (
                    <tr key={idx} className="border-t border-gray-200">
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={entry.title}
                          onChange={(e) => {
                            const newEntries = [...labelEntries];
                            newEntries[idx].title = e.target.value;
                            setLabelEntries(newEntries);
                          }}
                          className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <textarea
                          value={entry.description}
                          onChange={(e) => {
                            const newEntries = [...labelEntries];
                            newEntries[idx].description = e.target.value;
                            setLabelEntries(newEntries);
                          }}
                          rows={2}
                          className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-2">
                        <button
                          onClick={() => setLabelEntries(labelEntries.filter((_, i) => i !== idx))}
                          className="text-red-600 hover:text-red-800 p-1"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Label EN Table */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-gray-700">Label (English)</label>
              <button
                onClick={() => setLabelEnEntries([...labelEnEntries, { title: '', description: '' }])}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                + Add Row
              </button>
            </div>
            <div className="border border-gray-300 rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 w-1/3">Title</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-700">Description</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {labelEnEntries.map((entry, idx) => (
                    <tr key={idx} className="border-t border-gray-200">
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={entry.title}
                          onChange={(e) => {
                            const newEntries = [...labelEnEntries];
                            newEntries[idx].title = e.target.value;
                            setLabelEnEntries(newEntries);
                          }}
                          className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <textarea
                          value={entry.description}
                          onChange={(e) => {
                            const newEntries = [...labelEnEntries];
                            newEntries[idx].description = e.target.value;
                            setLabelEnEntries(newEntries);
                          }}
                          rows={2}
                          className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-2">
                        <button
                          onClick={() => setLabelEnEntries(labelEnEntries.filter((_, i) => i !== idx))}
                          className="text-red-600 hover:text-red-800 p-1"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pictures Section */}
          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">🖼️ Bilder</h3>
            
            {/* Upload Error */}
            {uploadError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
                {uploadError}
              </div>
            )}

            {/* Current Pictures */}
            {pictures.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
                {pictures.map((picture, idx) => (
                  <div key={idx} className="relative group border border-gray-200 rounded-lg overflow-hidden">
                    <img
                      src={`http://localhost:8000${picture.url}`}
                      alt={picture.description || 'Bild'}
                      className="w-full h-32 object-cover cursor-pointer hover:opacity-75 transition-opacity"
                      onClick={() => {
                        setImageModalIndex(idx);
                        setShowImageModal(true);
                      }}
                    />
                    <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-all flex items-center justify-center">
                      <button
                        onClick={() => handleImageDelete(picture.url.split('/').pop() || '')}
                        className="opacity-0 group-hover:opacity-100 bg-red-600 text-white px-3 py-1 rounded-lg text-sm font-medium hover:bg-red-700 transition-all"
                      >
                        Löschen
                      </button>
                    </div>
                    {picture.description && (
                      <div className="p-2 bg-gray-50 text-xs text-gray-700 truncate">
                        {picture.description}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Upload Button */}
            <div>
              <label className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded-lg cursor-pointer transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span className="font-medium text-gray-700">
                  {isUploadingImage ? 'Lädt hoch...' : 'Bild hochladen'}
                </span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
                  onChange={handleImageUpload}
                  disabled={isUploadingImage || !node?.id}
                  className="hidden"
                />
              </label>
              <p className="text-xs text-gray-500 mt-2">
                Erlaubt: PNG, JPG, GIF, WEBP • Max 10MB
              </p>
            </div>
          </div>

          {/* Links Section */}
          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">🔗 Links</h3>
            
            {/* Link Error */}
            {linkError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
                {linkError}
              </div>
            )}

            {/* Current Links */}
            {links.length > 0 && (
              <div className="space-y-2 mb-4">
                {links.map((link, idx) => (
                  <div key={idx} className="border border-gray-200 rounded-lg p-3 hover:bg-gray-50 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 break-all"
                        >
                          {link.title}
                          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                        {link.description && (
                          <p className="text-sm text-gray-600 mt-1">{link.description}</p>
                        )}
                        <p className="text-xs text-gray-400 mt-1 break-all">{link.url}</p>
                      </div>
                      <button
                        onClick={() => handleLinkDelete(link.url)}
                        className="px-2 py-1 text-sm text-red-600 hover:bg-red-50 rounded transition-colors flex-shrink-0"
                      >
                        Löschen
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add Link Form */}
            <div className="space-y-3 border border-gray-200 rounded-lg p-4 bg-gray-50">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">URL *</label>
                <input
                  type="url"
                  value={newLinkUrl}
                  onChange={(e) => setNewLinkUrl(e.target.value)}
                  placeholder="https://example.com/..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  disabled={isAddingLink || !node?.id}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Titel *</label>
                <input
                  type="text"
                  value={newLinkTitle}
                  onChange={(e) => setNewLinkTitle(e.target.value)}
                  placeholder="z.B. Technisches Datenblatt"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  disabled={isAddingLink || !node?.id}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Beschreibung (optional)</label>
                <textarea
                  value={newLinkDescription}
                  onChange={(e) => setNewLinkDescription(e.target.value)}
                  placeholder="z.B. PDF mit allen technischen Spezifikationen"
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                  disabled={isAddingLink || !node?.id}
                />
              </div>
              <button
                onClick={handleLinkAdd}
                disabled={isAddingLink || !node?.id || !newLinkUrl.trim() || !newLinkTitle.trim()}
                className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isAddingLink ? 'Fügt hinzu...' : 'Link hinzufügen'}
              </button>
            </div>
          </div>

          {/* Result Message */}
          {result && (
            <div className={`p-4 rounded-lg ${result.success ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
              <p className="font-medium">{result.message}</p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
              disabled={isSubmitting}
            >
              Abbrechen
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
            >
              {isSubmitting ? 'Speichert...' : 'Speichern'}
            </button>
          </div>
        </div>

        {/* Image Modal */}
        {showImageModal && pictures.length > 0 && (
          <ImageModal
            pictures={pictures}
            onClose={() => setShowImageModal(false)}
            initialIndex={imageModalIndex}
          />
        )}

        {showLinksModal && links.length > 0 && (
          <LinksList
            links={links}
            onClose={() => setShowLinksModal(false)}
          />
        )}
      </div>
    </div>,
    document.body
  );
};

// ============================================================
// Constraints Modal Component
// ============================================================
interface ConstraintsModalProps {
  isOpen: boolean;
  onClose: () => void;
  level: number;
  familyCode: string;
}

const ConstraintsModal: React.FC<ConstraintsModalProps> = ({ isOpen, onClose, level, familyCode }) => {
  const [constraints, setConstraints] = useState<Constraint[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [editingConstraint, setEditingConstraint] = useState<Constraint | null>(null);
  
  // Editor States
  const [editorMode, setEditorMode] = useState<'allow' | 'deny'>('deny');
  const [editorDescription, setEditorDescription] = useState('');
  const [editorConditions, setEditorConditions] = useState<ConstraintCondition[]>([]);
  const [editorCodes, setEditorCodes] = useState<ConstraintCode[]>([]);

  // Load constraints when modal opens
  useEffect(() => {
    if (isOpen) {
      loadConstraints();
    }
  }, [isOpen, level]);

  const loadConstraints = async () => {
    setIsLoading(true);
    try {
      const data = await fetchConstraintsForLevel(level);
      setConstraints(data);
    } catch (error) {
      console.error('Failed to load constraints:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEdit = (constraint: Constraint) => {
    setEditingConstraint(constraint);
    setEditorMode(constraint.mode);
    setEditorDescription(constraint.description || '');
    setEditorConditions([...constraint.conditions]);
    setEditorCodes([...constraint.codes]);
    setShowEditor(true);
  };

  const handleDelete = async (constraintId: number) => {
    if (!confirm('Constraint wirklich löschen?')) return;
    
    try {
      await deleteConstraint(constraintId);
      await loadConstraints();
    } catch (error) {
      console.error('Failed to delete constraint:', error);
      alert('Fehler beim Löschen der Constraint');
    }
  };

  const handleSave = async () => {
    try {
      const request: CreateConstraintRequest = {
        level,
        mode: editorMode,
        description: editorDescription || null,
        conditions: editorConditions,
        codes: editorCodes
      };

      if (editingConstraint?.id) {
        await updateConstraint(editingConstraint.id, request);
      } else {
        await createConstraint(request);
      }

      setShowEditor(false);
      setEditingConstraint(null);
      await loadConstraints();
    } catch (error) {
      console.error('Failed to save constraint:', error);
      alert('Fehler beim Speichern der Constraint');
    }
  };

  const handleNewConstraint = () => {
    setEditingConstraint(null);
    setEditorMode('deny');
    setEditorDescription('');
    setEditorConditions([]);
    setEditorCodes([]);
    setShowEditor(true);
  };

  const addCondition = () => {
    setEditorConditions([...editorConditions, {
      condition_type: 'prefix',
      target_level: Math.max(1, level - 1),
      value: ''
    }]);
  };

  const removeCondition = (index: number) => {
    setEditorConditions(editorConditions.filter((_, i) => i !== index));
  };

  const addCode = (codeType: 'single' | 'range') => {
    setEditorCodes([...editorCodes, {
      code_type: codeType,
      code_value: ''
    }]);
  };

  const removeCode = (index: number) => {
    setEditorCodes(editorCodes.filter((_, i) => i !== index));
  };

  if (!isOpen) return null;

  return createPortal(
    <div 
      className="fixed inset-0 bg-black/60 grid place-items-center z-50 p-4"
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">⚠️ Constraints - Level {level}</h2>
            <p className="text-sm text-gray-600 mt-1">
              Regeln für erlaubte/verbotene Codes • Familie {familyCode}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl font-bold w-8 h-8 flex items-center justify-center"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {showEditor ? (
            /* Constraint Editor */
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold">
                  {editingConstraint ? 'Constraint bearbeiten' : 'Neue Constraint'}
                </h3>
                <button
                  onClick={() => setShowEditor(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ← Zurück zur Liste
                </button>
              </div>

              {/* Mode */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Modus</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={editorMode === 'allow'}
                      onChange={() => setEditorMode('allow')}
                      className="w-4 h-4"
                    />
                    <span>Allow (Whitelist - nur diese Codes erlaubt)</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={editorMode === 'deny'}
                      onChange={() => setEditorMode('deny')}
                      className="w-4 h-4"
                    />
                    <span>Deny (Blacklist - diese Codes verboten)</span>
                  </label>
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Beschreibung</label>
                <textarea
                  value={editorDescription}
                  onChange={(e) => setEditorDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  rows={2}
                  placeholder="z.B. 'Nur C-Codes für kurze Level-2-Codes'"
                />
              </div>

              {/* Conditions */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Bedingungen (müssen ALLE erfüllt sein)
                  </label>
                  <button
                    onClick={addCondition}
                    className="text-sm text-blue-600 hover:text-blue-800"
                  >
                    + Bedingung hinzufügen
                  </button>
                </div>
                {editorConditions.map((cond, idx) => (
                  <div key={idx} className="flex gap-2 mb-2 items-start">
                    <select
                      value={cond.target_level}
                      onChange={(e) => {
                        const newConds = [...editorConditions];
                        newConds[idx].target_level = parseInt(e.target.value);
                        setEditorConditions(newConds);
                      }}
                      className="px-2 py-1 border border-gray-300 rounded"
                    >
                      {Array.from({ length: level }, (_, i) => i).map(lvl => (
                        <option key={lvl} value={lvl}>Level {lvl}</option>
                      ))}
                    </select>
                    
                    <select
                      value={cond.condition_type}
                      onChange={(e) => {
                        const newConds = [...editorConditions];
                        newConds[idx].condition_type = e.target.value as any;
                        setEditorConditions(newConds);
                      }}
                      className="px-2 py-1 border border-gray-300 rounded"
                    >
                      <option value="exact_code">Exakter Code</option>
                      <option value="prefix">Prefix</option>
                      <option value="pattern">Pattern (Länge)</option>
                    </select>
                    
                    <input
                      type="text"
                      value={cond.value}
                      onChange={(e) => {
                        const newConds = [...editorConditions];
                        newConds[idx].value = e.target.value;
                        setEditorConditions(newConds);
                      }}
                      placeholder={
                        cond.condition_type === 'pattern' ? 'z.B. 4-6 oder 5' :
                        cond.condition_type === 'prefix' ? 'z.B. C oder AB' :
                        'z.B. ABC123'
                      }
                      className="flex-1 px-2 py-1 border border-gray-300 rounded"
                    />
                    
                    <button
                      onClick={() => removeCondition(idx)}
                      className="px-2 py-1 text-red-600 hover:text-red-800"
                    >
                      🗑️
                    </button>
                  </div>
                ))}
                {editorConditions.length === 0 && (
                  <p className="text-sm text-gray-500 italic">
                    Keine Bedingungen = Constraint gilt immer für dieses Level
                  </p>
                )}
              </div>

              {/* Codes */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-medium text-gray-700">
                    {editorMode === 'allow' ? 'Erlaubte Codes' : 'Verbotene Codes'}
                  </label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => addCode('single')}
                      className="text-sm text-blue-600 hover:text-blue-800"
                    >
                      + Einzelner Code
                    </button>
                    <button
                      onClick={() => addCode('range')}
                      className="text-sm text-blue-600 hover:text-blue-800"
                    >
                      + Range
                    </button>
                  </div>
                </div>
                {editorCodes.map((code, idx) => (
                  <div key={idx} className="flex gap-2 mb-2 items-start">
                    <span className="px-2 py-1 text-sm bg-gray-100 rounded">
                      {code.code_type === 'single' ? '📝 Single' : '📊 Range'}
                    </span>
                    <input
                      type="text"
                      value={code.code_value}
                      onChange={(e) => {
                        const newCodes = [...editorCodes];
                        newCodes[idx].code_value = e.target.value;
                        setEditorCodes(newCodes);
                      }}
                      placeholder={
                        code.code_type === 'single' 
                          ? 'z.B. C010' 
                          : 'z.B. C010-C020, A-Z, PS001-PS999'
                      }
                      className="flex-1 px-2 py-1 border border-gray-300 rounded"
                    />
                    <button
                      onClick={() => removeCode(idx)}
                      className="px-2 py-1 text-red-600 hover:text-red-800"
                    >
                      🗑️
                    </button>
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-4 border-t">
                <button
                  onClick={() => setShowEditor(false)}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                >
                  Abbrechen
                </button>
                <button
                  onClick={handleSave}
                  disabled={editorCodes.length === 0}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300"
                >
                  💾 Speichern
                </button>
              </div>
            </div>
          ) : (
            /* Constraints List */
            <div>
              <div className="flex justify-between items-center mb-4">
                <p className="text-sm text-gray-600">
                  {constraints.length} Constraint(s) definiert
                </p>
                <button
                  onClick={handleNewConstraint}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                >
                  + Neue Constraint
                </button>
              </div>

              {isLoading ? (
                <p className="text-center text-gray-500 py-8">Laden...</p>
              ) : constraints.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 rounded-lg">
                  <p className="text-gray-500 mb-4">Keine Constraints definiert</p>
                  <button
                    onClick={handleNewConstraint}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    Erste Constraint erstellen
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {constraints.map((constraint) => (
                    <div
                      key={constraint.id}
                      className="border border-gray-300 rounded-lg p-4 hover:bg-gray-50"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-1 text-xs font-semibold rounded ${
                            constraint.mode === 'allow' 
                              ? 'bg-green-100 text-green-800' 
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {constraint.mode === 'allow' ? '✅ ALLOW' : '🚫 DENY'}
                          </span>
                          <span className="text-sm text-gray-600">
                            ID: {constraint.id}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleEdit(constraint)}
                            className="text-sm text-blue-600 hover:text-blue-800"
                          >
                            ✏️ Bearbeiten
                          </button>
                          <button
                            onClick={() => handleDelete(constraint.id!)}
                            className="text-sm text-red-600 hover:text-red-800"
                          >
                            🗑️ Löschen
                          </button>
                        </div>
                      </div>

                      {constraint.description && (
                        <p className="text-sm text-gray-700 mb-2">{constraint.description}</p>
                      )}

                      <div className="text-xs text-gray-600 space-y-1">
                        {constraint.conditions.length > 0 && (
                          <div>
                            <strong>Bedingungen:</strong> {constraint.conditions.map(c => 
                              `Level ${c.target_level} ${c.condition_type}="${c.value}"`
                            ).join(' UND ')}
                          </div>
                        )}
                        <div>
                          <strong>{constraint.mode === 'allow' ? 'Erlaubte' : 'Verbotene'} Codes:</strong>{' '}
                          {constraint.codes.map(c => c.code_value).join(', ')}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

// ============================================================
// Bulk Edit Modal Component
// ============================================================
interface BulkEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  level: number;
  familyCode: string;
  parentSelections: Record<number, AvailableOption>;
}

const BulkEditModal: React.FC<BulkEditModalProps> = ({ isOpen, onClose, level, familyCode, parentSelections }) => {
  // Filter States
  const [filterCode, setFilterCode] = useState('');
  const [filterCodePrefix, setFilterCodePrefix] = useState('');
  const [filterGroupName, setFilterGroupName] = useState('');
  const [filterName, setFilterName] = useState('');
  const [filterPattern, setFilterPattern] = useState('');
  const [filterCodeContentPos, setFilterCodeContentPos] = useState('');
  const [filterCodeContentValue, setFilterCodeContentValue] = useState('');
  
  // Neue erweiterte Filter States
  const [filterParentLevelPatterns, setFilterParentLevelPatterns] = useState<Record<number, string>>({});  // z.B. "3" oder "2-4"
  const [filterParentLevelPatternsType, setFilterParentLevelPatternsType] = useState<Record<number, '' | 'alphabetic' | 'numeric' | 'alphanumeric'>>({});  // Pattern-Typ
  const [filterParentLevelOptions, setFilterParentLevelOptions] = useState<Record<number, string>>({});  // Nur noch für exakte Codes
  const [filterAllowedFrom, setFilterAllowedFrom] = useState('');
  const [filterAllowedTo, setFilterAllowedTo] = useState('');
  const [filterAllowedType, setFilterAllowedType] = useState<'' | 'alphabetic' | 'numeric' | 'alphanumeric'>('');  // '' = any/disabled
  
  // Results & Selection States
  const [filteredNodes, setFilteredNodes] = useState<AvailableOption[]>([]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<number>>(new Set());
  const [isFiltering, setIsFiltering] = useState(false);
  
  // Compatibility States
  const [compatibleNodes, setCompatibleNodes] = useState<AvailableOption[]>([]);
  const [incompatibleNodes, setIncompatibleNodes] = useState<AvailableOption[]>([]);
  
  // Edit States
  const [showEditForm, setShowEditForm] = useState(false);
  const [editName, setEditName] = useState('');
  const [editLabelEntries, setEditLabelEntries] = useState<{ title: string; description: string }[]>([]);
  const [editLabelEnEntries, setEditLabelEnEntries] = useState<{ title: string; description: string }[]>([]);
  const [editGroupName, setEditGroupName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{success: boolean; message: string} | null>(null);
  const [updateAllWithCode, setUpdateAllWithCode] = useState(true);

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setFilterCode('');
      setFilterCodePrefix('');
      setFilterGroupName('');
      setFilterName('');
      setFilterPattern('');
      setFilterCodeContentPos('');
      setFilterCodeContentValue('');
      setFilterParentLevelPatterns({});
      setFilterParentLevelPatternsType({});
      setFilterParentLevelOptions({});
      setFilterAllowedFrom('');
      setFilterAllowedTo('');
      setFilterAllowedType('');  // Reset zu '' = any/disabled
      setFilteredNodes([]);
      setSelectedNodeIds(new Set());
      setShowEditForm(false);
      setResult(null);
    }
  }, [isOpen]);

  const handleFilter = async () => {
    setIsFiltering(true);
    setResult(null);
    
    try {
      const filters: BulkFilterRequest = {
        level,
        family_code: familyCode
      };
      
      if (filterCode.trim()) filters.code = filterCode.trim();
      if (filterCodePrefix.trim()) filters.code_prefix = filterCodePrefix.trim();
      if (filterGroupName.trim()) filters.group_name = filterGroupName.trim();
      if (filterName.trim()) filters.name = filterName.trim();
      if (filterPattern.trim()) filters.pattern = filterPattern.trim();  // String: "3" oder "2-4"
      
      if (filterCodeContentValue.trim()) {
        filters.code_content = {
          position: filterCodeContentPos.trim() ? parseInt(filterCodeContentPos) : undefined,
          value: filterCodeContentValue.trim()
        };
      }
      
      // Parent Level Patterns (mit Länge UND Pattern-Type)
      const parentPatterns: Record<number, any> = {};
      Object.entries(filterParentLevelPatterns).forEach(([levelStr, lengthStr]) => {
        const levelNum = parseInt(levelStr);
        if (!isNaN(levelNum) && lengthStr.trim()) {
          const patternType = filterParentLevelPatternsType[levelNum] || '';
          
          parentPatterns[levelNum] = {
            length: lengthStr.trim(),  // "3" oder "2-4"
            type: patternType  // "" | "alphabetic" | "numeric" | "alphanumeric"
          };
        }
      });
      if (Object.keys(parentPatterns).length > 0) {
        filters.parent_level_patterns = parentPatterns;
      }
      
      // Parent Level Options (NUR noch exakte Codes!)
      const parentOptions: Record<number, string[]> = {};
      Object.entries(filterParentLevelOptions).forEach(([levelStr, optionsStr]) => {
        const levelNum = parseInt(levelStr);
        if (!isNaN(levelNum) && optionsStr.trim()) {
          // Split by comma and trim
          const options = optionsStr.split(',').map(o => o.trim()).filter(o => o.length > 0);
          if (options.length > 0) {
            parentOptions[levelNum] = options;
          }
        }
      });
      if (Object.keys(parentOptions).length > 0) {
        filters.parent_level_options = parentOptions;
      }
      
      // Allowed Pattern
      // Nur senden wenn ein Pattern-Typ ausgewählt wurde (nicht '' = any)
      if (filterAllowedType) {
        filters.allowed_pattern = {
          from: filterAllowedFrom.trim() ? parseInt(filterAllowedFrom) : 0,  // Default: 0 = vom Start
          to: filterAllowedTo.trim() ? parseInt(filterAllowedTo) : undefined,  // undefined = bis Ende
          allowed: filterAllowedType
        };
      }
      
      const response = await bulkFilterNodes(filters);
      
      // Trenne Nodes basierend auf is_compatible Flag aus Backend-Response
      const compatible: AvailableOption[] = [];
      const incompatible: AvailableOption[] = [];
      
      for (const node of response.nodes) {
        // Nutze is_compatible aus der Backend-Response
        // Das Backend hat bereits alle erweiterten Filter geprüft
        if (node.is_compatible) {
          compatible.push(node);
        } else {
          incompatible.push(node);
        }
      }
      
      setCompatibleNodes(compatible);
      setIncompatibleNodes(incompatible);
      setFilteredNodes([...compatible, ...incompatible]);
      
      // Alle gefilterten Nodes standardmäßig auswählen
      const allIds = new Set(response.nodes.map(n => n.id!));
      setSelectedNodeIds(allIds);
    } catch (error) {
      console.error('Filter error:', error);
      setResult({ success: false, message: `Fehler beim Filtern: ${error}` });
    } finally {
      setIsFiltering(false);
    }
  };
  
  // Neue Funktion: Filter basierend auf tatsächlicher Parent-Auswahl
  const handleFilterByPath = async () => {
    setIsFiltering(true);
    setResult(null);
    
    try {
      const filters: BulkFilterRequest = {
        level,
        family_code: familyCode
      };
      
      // Nur aktuelle Level Filter (KEINE Parent-Level-Filter aus Modal!)
      if (filterCode.trim()) filters.code = filterCode.trim();
      if (filterCodePrefix.trim()) filters.code_prefix = filterCodePrefix.trim();
      if (filterGroupName.trim()) filters.group_name = filterGroupName.trim();
      if (filterName.trim()) filters.name = filterName.trim();
      if (filterPattern.trim()) filters.pattern = filterPattern.trim();  // String: "3" oder "2-4"
      
      if (filterCodeContentValue.trim()) {
        filters.code_content = {
          position: filterCodeContentPos.trim() ? parseInt(filterCodeContentPos) : undefined,
          value: filterCodeContentValue.trim()
        };
      }
      
      // Allowed Pattern
      if (filterAllowedType) {
        filters.allowed_pattern = {
          from: filterAllowedFrom.trim() ? parseInt(filterAllowedFrom) : 0,
          to: filterAllowedTo.trim() ? parseInt(filterAllowedTo) : undefined,
          allowed: filterAllowedType
        };
      }
      
      const response = await bulkFilterNodes(filters);
      
      // Jetzt manuell nach parentSelections filtern
      const compatible: AvailableOption[] = [];
      const incompatible: AvailableOption[] = [];
      
      for (const node of response.nodes) {
        // Backend hat bereits current-level Filter angewendet (is_compatible Flag)
        // Wir müssen zusätzlich den Parent-Path prüfen
        let isCompatible = node.is_compatible;  // Start mit Backend-Result
        
        if (isCompatible) {
          // Nur wenn Backend sagt "kompatibel", prüfe auch den Parent-Path
          const pathCodes: string[] = [];
          for (let i = 1; i < level; i++) {
            if (parentSelections[i]) {
              pathCodes.push(parentSelections[i].code);
            }
          }
          
          // Prüfe ob die Node zu diesem spezifischen Pfad kompatibel ist
          isCompatible = await checkCompatibility(node.code, level, familyCode, pathCodes);
        }
        
        if (isCompatible) {
          compatible.push(node);
        } else {
          incompatible.push(node);
        }
      }
      
      setCompatibleNodes(compatible);
      setIncompatibleNodes(incompatible);
      setFilteredNodes([...compatible, ...incompatible]);
      
      // Alle kompatiblen Nodes standardmäßig auswählen
      const compatibleIds = new Set(compatible.map(n => n.id!));
      setSelectedNodeIds(compatibleIds);
    } catch (error) {
      console.error('Filter error:', error);
      setResult({ success: false, message: `Fehler beim Filtern: ${error}` });
    } finally {
      setIsFiltering(false);
    }
  };
  
  // Hilfsfunktion um Kompatibilität zu prüfen
  const checkCompatibility = async (code: string, nodeLevel: number, family: string, pathCodes: string[]): Promise<boolean> => {
    try {
      // Baue vollständigen Typecode
      const fullTypecode = [family, ...pathCodes, code].join(' ');
      const result = await decodeTypecode(fullTypecode);
      return result.exists;
    } catch {
      return false;
    }
  };

  const toggleNodeSelection = (nodeId: number) => {
    const newSelection = new Set(selectedNodeIds);
    if (newSelection.has(nodeId)) {
      newSelection.delete(nodeId);
    } else {
      newSelection.add(nodeId);
    }
    setSelectedNodeIds(newSelection);
  };

  const selectAll = () => {
    const allIds = new Set(filteredNodes.map(n => n.id!));
    setSelectedNodeIds(allIds);
  };

  const deselectAll = () => {
    setSelectedNodeIds(new Set());
  };
  
  const toggleIncompatible = () => {
    const incompatibleIds = new Set(incompatibleNodes.map(n => n.id!));
    const newSelection = new Set(selectedNodeIds);
    
    // Prüfe ob mindestens eine inkompatible Node ausgewählt ist
    const hasAnyIncompatibleSelected = Array.from(incompatibleIds).some(id => newSelection.has(id));
    
    if (hasAnyIncompatibleSelected) {
      // Entferne alle inkompatiblen
      incompatibleIds.forEach(id => newSelection.delete(id));
    } else {
      // Füge alle inkompatiblen hinzu
      incompatibleIds.forEach(id => newSelection.add(id));
    }
    
    setSelectedNodeIds(newSelection);
  };

  const handleBulkUpdate = async () => {
    if (selectedNodeIds.size === 0) {
      setResult({ success: false, message: 'Keine Nodes ausgewählt' });
      return;
    }

    setIsSubmitting(true);
    setResult(null);

    try {
      const updates: any = {};
      
      if (editName.trim()) updates.append_name = editName.trim();
      if (editLabelEntries.length > 0) updates.append_label = entriesToLabel(editLabelEntries);
      if (editLabelEnEntries.length > 0) updates.append_label_en = entriesToLabel(editLabelEnEntries);
      if (editGroupName.trim()) updates.append_group_name = editGroupName.trim();

      if (Object.keys(updates).length === 0) {
        setResult({ success: false, message: 'Keine Änderungen angegeben' });
        setIsSubmitting(false);
        return;
      }

      // Sammle Node-IDs basierend auf Update-Modus
      const allNodeIds: number[] = [];
      
      if (updateAllWithCode) {
        // Modus: Alle Nodes mit gleichem Code
        filteredNodes.forEach(node => {
          if (selectedNodeIds.has(node.id!)) {
            // Füge ALLE IDs dieses Codes hinzu
            if (node.ids && node.ids.length > 0) {
              allNodeIds.push(...node.ids);
            }
          }
        });
      } else {
        // Modus: Nur spezifische Nodes basierend auf Parent-Pfad
        for (const node of filteredNodes) {
          if (selectedNodeIds.has(node.id!)) {
            // Baue Parent-Codes Array
            const parentCodesArray: string[] = [];
            for (let i = 1; i < level; i++) {
              if (parentSelections[i]) {
                parentCodesArray.push(parentSelections[i].code);
              }
            }
            
            // Finde die spezifische Node-ID für diesen Pfad
            try {
              const result = await findNodeIdByPath(
                node.code,
                level,
                familyCode,
                parentCodesArray
              );
              
              if (result.found && result.node_id) {
                allNodeIds.push(result.node_id);
              } else {
                console.warn(`Keine Node-ID gefunden für Code ${node.code} mit Pfad`, parentCodesArray);
              }
            } catch (error) {
              console.error(`Fehler beim Finden der Node-ID für ${node.code}:`, error);
            }
          }
        }
      }

      console.log('Sending bulk update:', {
        update_mode: updateAllWithCode ? 'all' : 'specific',
        node_ids: allNodeIds,
        updates
      });

      const response = await bulkUpdateNodes({
        node_ids: allNodeIds,
        updates
      });

      setResult({ 
        success: true, 
        message: `${response.updated_count} Nodes erfolgreich aktualisiert!` 
      });

      // Reset edit form after successful update
      setTimeout(() => {
        setEditName('');
        setEditLabelEntries([]);
        setEditLabelEnEntries([]);
        setEditGroupName('');
        setShowEditForm(false);
        
        // Refresh filter to show updated data
        handleFilter();
      }, 2000);
      
    } catch (error) {
      console.error('Bulk update error:', error);
      console.error('Error details:', error instanceof Error ? error.message : String(error));
      setResult({ 
        success: false, 
        message: `Fehler beim Aktualisieren: ${error instanceof Error ? error.message : String(error)}` 
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div 
      className="fixed inset-0 bg-black/60 grid place-items-center z-50 p-4"
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex justify-between items-start mb-3">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Gruppenbearbeitung</h2>
              <p className="text-sm text-gray-600 mt-1">
                Level {level} • Familie {familyCode}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-2xl font-bold w-8 h-8 flex items-center justify-center"
            >
              ×
            </button>
          </div>
          
          {/* Update Scope Toggle */}
          <div className="flex items-center gap-3 bg-gray-50 px-4 py-3 rounded-lg">
            <span className="text-sm font-medium text-gray-700">Update-Bereich:</span>
            <button
              onClick={() => setUpdateAllWithCode(!updateAllWithCode)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                updateAllWithCode 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              🌐 Alle Nodes mit gleichem Code
            </button>
            <button
              onClick={() => setUpdateAllWithCode(!updateAllWithCode)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                !updateAllWithCode 
                  ? 'bg-green-600 text-white' 
                  : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              🎯 Nur gefilterte spezifische Nodes
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Filter Section */}
          <div className="bg-gray-50 rounded-lg p-4">
            <h3 className="text-lg font-semibold mb-4 text-gray-800">🔍 Filter</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Code Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Code (exakt)
                </label>
                <input
                  type="text"
                  value={filterCode}
                  onChange={(e) => setFilterCode(e.target.value)}
                  placeholder="z.B. ABC123"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* Code Prefix */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Code-Prefix
                </label>
                <input
                  type="text"
                  value={filterCodePrefix}
                  onChange={(e) => setFilterCodePrefix(e.target.value)}
                  placeholder="z.B. ABC"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* Pattern (Code Length) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Pattern (Länge)
                </label>
                <input
                  type="text"
                  value={filterPattern}
                  onChange={(e) => setFilterPattern(e.target.value)}
                  placeholder="Exakt: 6 oder Range: 2-4"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* Group Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Group Name
                </label>
                <input
                  type="text"
                  value={filterGroupName}
                  onChange={(e) => setFilterGroupName(e.target.value)}
                  placeholder="z.B. Standard"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name
                </label>
                <input
                  type="text"
                  value={filterName}
                  onChange={(e) => setFilterName(e.target.value)}
                  placeholder="Teilstring"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* Code Content Filter */}
            <div className="mt-4 pt-4 border-t border-gray-200">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Code-Content (ab Position)
              </label>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <input
                    type="number"
                    value={filterCodeContentPos}
                    onChange={(e) => setFilterCodeContentPos(e.target.value)}
                    placeholder="Position (z.B. 3)"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <input
                    type="text"
                    value={filterCodeContentValue}
                    onChange={(e) => setFilterCodeContentValue(e.target.value)}
                    placeholder="Wert (z.B. XY)"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Sucht nach Codes, die ab der angegebenen Position den Wert enthalten
              </p>
            </div>

            {/* Erweiterte Filter: Allowed Pattern */}
            <div className="mt-4 pt-4 border-t border-gray-200">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                🔤 Code-Pattern (aktuelles Level)
              </label>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <input
                    type="number"
                    value={filterAllowedFrom}
                    onChange={(e) => setFilterAllowedFrom(e.target.value)}
                    placeholder="Von Position (0 = Start)"
                    disabled={!filterAllowedType}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
                  />
                </div>
                <div>
                  <input
                    type="number"
                    value={filterAllowedTo}
                    onChange={(e) => setFilterAllowedTo(e.target.value)}
                    placeholder="Bis Position (leer = Ende)"
                    disabled={!filterAllowedType}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
                  />
                </div>
                <div>
                  <select
                    value={filterAllowedType}
                    onChange={(e) => setFilterAllowedType(e.target.value as '' | 'alphabetic' | 'numeric' | 'alphanumeric')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">Alle (kein Filter)</option>
                    <option value="alphanumeric">Alphanumerisch</option>
                    <option value="alphabetic">Alphabetisch</option>
                    <option value="numeric">Numerisch</option>
                  </select>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Wähle Pattern-Typ um zu filtern. Standardmäßig werden alle Codes angezeigt (vom gesamten Code).
              </p>
            </div>

            {/* Erweiterte Filter: Parent Level Patterns */}
            {level > 1 && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  📏 Parent-Level Pattern
                </label>
                <div className="space-y-3">
                  {Array.from({ length: level - 1 }, (_, i) => i + 1).map((lvl) => (
                    <div key={lvl} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-600 font-medium min-w-[70px]">Level {lvl}:</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={filterParentLevelPatterns[lvl] || ''}
                          onChange={(e) => setFilterParentLevelPatterns(prev => ({
                            ...prev,
                            [lvl]: e.target.value
                          }))}
                          placeholder="Länge: 3 oder Range: 2-4"
                          className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                        />
                        <select
                          value={filterParentLevelPatternsType[lvl] || ''}
                          onChange={(e) => setFilterParentLevelPatternsType(prev => ({
                            ...prev,
                            [lvl]: e.target.value as '' | 'alphabetic' | 'numeric' | 'alphanumeric'
                          }))}
                          className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                        >
                          <option value="">Alle Zeichen</option>
                          <option value="alphanumeric">Alphanumerisch</option>
                          <option value="alphabetic">Alphabetisch</option>
                          <option value="numeric">Numerisch</option>
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  <strong>Länge:</strong> Exakt (z.B. "3") oder Range (z.B. "2-4")<br />
                  <strong>Pattern:</strong> Optional - Zeichentyp des Parent-Codes
                </p>
              </div>
            )}

            {/* Erweiterte Filter: Parent Level Options */}
            {level > 1 && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  🎯 Parent-Level Optionen (exakte Codes)
                </label>
                <div className="space-y-2">
                  {Array.from({ length: level - 1 }, (_, i) => i + 1).map((lvl) => (
                    <div key={lvl} className="grid grid-cols-3 gap-4 items-center">
                      <span className="text-sm text-gray-600">Level {lvl}:</span>
                      <input
                        type="text"
                        value={filterParentLevelOptions[lvl] || ''}
                        onChange={(e) => setFilterParentLevelOptions(prev => ({
                          ...prev,
                          [lvl]: e.target.value
                        }))}
                        placeholder="ABC, DEF, GHI"
                        className="col-span-2 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Exakte Codes oder Prefix mit * (z.B. "M1*, M345, GP*" - Komma-getrennt)
                </p>
              </div>
            )}

            {/* Filter Buttons */}
            <div className="mt-4 space-y-2">
              <button
                onClick={handleFilter}
                disabled={isFiltering}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
              >
                {isFiltering ? '🔄 Filtert...' : '🔍 Filtern (mit Parent-Level Filtern)'}
              </button>
              
              {level > 1 && (
                <button
                  onClick={handleFilterByPath}
                  disabled={isFiltering}
                  className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
                  title="Filtert nur nach den aktuell in der UI ausgewählten Parent-Optionen, ohne die Parent-Level Filter im Modal zu berücksichtigen"
                >
                  {isFiltering ? '🔄 Filtert...' : '🌳 Filter für aktuelle Auswahl'}
                </button>
              )}
            </div>
          </div>

          {/* Results Section */}
          {filteredNodes.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-gray-800">
                  📋 Ergebnisse ({compatibleNodes.length} kompatibel, {incompatibleNodes.length} inkompatibel)
                </h3>
                <div className="flex gap-2">
                  <button
                    onClick={selectAll}
                    className="text-sm px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                  >
                    Alle auswählen
                  </button>
                  <button
                    onClick={deselectAll}
                    className="text-sm px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                  >
                    Alle abwählen
                  </button>
                  {incompatibleNodes.length > 0 && (
                    <button
                      onClick={toggleIncompatible}
                      className="text-sm px-3 py-1 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg transition-colors"
                    >
                      Inkompatible umschalten
                    </button>
                  )}
                </div>
              </div>

              <div className="max-h-96 overflow-y-auto space-y-2">
                {/* Kompatible Nodes */}
                {compatibleNodes.length > 0 && (
                  <div className="mb-4">
                    <div className="text-sm font-semibold text-green-700 mb-2 px-2">
                      ✓ Kompatibel ({compatibleNodes.length})
                    </div>
                    {compatibleNodes.map((node) => (
                      <div
                        key={node.id}
                        className="flex items-center gap-3 p-3 bg-green-50 rounded-lg hover:bg-green-100 transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={selectedNodeIds.has(node.id!)}
                          onChange={() => toggleNodeSelection(node.id!)}
                          className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 cursor-pointer"
                        />
                        <div className="flex-1">
                          <div className="font-mono font-semibold text-gray-900">{node.code}</div>
                          {node.label && (
                            <div className="text-sm text-gray-600">{node.label}</div>
                          )}
                          <div className="text-xs text-gray-500 mt-1 flex gap-4">
                            {node.name && <span>Name: {node.name}</span>}
                            {node.group_name && <span>Group: {node.group_name}</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                
                {/* Inkompatible Nodes */}
                {incompatibleNodes.length > 0 && (
                  <div>
                    <div className="text-sm font-semibold text-gray-500 mb-2 px-2">
                      ⚠ Inkompatibel zu vorherigen Auswahlen ({incompatibleNodes.length})
                    </div>
                    {incompatibleNodes.map((node) => (
                      <div
                        key={node.id}
                        className="flex items-center gap-3 p-3 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors opacity-60"
                      >
                        <input
                          type="checkbox"
                          checked={selectedNodeIds.has(node.id!)}
                          onChange={() => toggleNodeSelection(node.id!)}
                          className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 cursor-pointer"
                        />
                        <div className="flex-1">
                          <div className="font-mono font-semibold text-gray-700">{node.code}</div>
                          {node.label && (
                            <div className="text-sm text-gray-500">{node.label}</div>
                          )}
                          <div className="text-xs text-gray-400 mt-1 flex gap-4">
                            {node.name && <span>Name: {node.name}</span>}
                            {node.group_name && <span>Group: {node.group_name}</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-4 pt-4 border-t border-gray-200">
                <p className="text-sm text-gray-600 mb-2">
                  <span className="font-semibold">{selectedNodeIds.size}</span> von {filteredNodes.length} Nodes ausgewählt
                </p>
                <button
                  onClick={() => setShowEditForm(!showEditForm)}
                  disabled={selectedNodeIds.size === 0}
                  className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
                >
                  ✏️ Ausgewählte Nodes bearbeiten
                </button>
              </div>
            </div>
          )}

          {/* Edit Form */}
          {showEditForm && selectedNodeIds.size > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <h3 className="text-lg font-semibold mb-4 text-gray-800">
                ✏️ {selectedNodeIds.size} Nodes bearbeiten
                <span className="text-sm font-normal text-gray-600 ml-2">(Werte werden an bestehende angehängt)</span>
              </h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Name <span className="text-xs text-gray-500">(wird mit Leerzeichen angehängt)</span>
                  </label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="z.B. 'zusätzlicher Name'"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                </div>

                {/* Label (German) Table */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Label (Deutsch) <span className="text-xs text-gray-500">(wird hinzugefügt, nicht ersetzt)</span>
                    </label>
                    <button
                      onClick={() => setEditLabelEntries([...editLabelEntries, { title: '', description: '' }])}
                      className="text-sm text-green-600 hover:text-green-800"
                    >
                      + Zeile hinzufügen
                    </button>
                  </div>
                  {editLabelEntries.length > 0 && (
                    <div className="border border-gray-300 rounded-lg overflow-hidden">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 w-1/3">Titel</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-700">Beschreibung</th>
                            <th className="w-10"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {editLabelEntries.map((entry, idx) => (
                            <tr key={idx} className="border-t border-gray-200">
                              <td className="px-3 py-2">
                                <input
                                  type="text"
                                  value={entry.title}
                                  onChange={(e) => {
                                    const newEntries = [...editLabelEntries];
                                    newEntries[idx].title = e.target.value;
                                    setEditLabelEntries(newEntries);
                                  }}
                                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-green-500"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <textarea
                                  value={entry.description}
                                  onChange={(e) => {
                                    const newEntries = [...editLabelEntries];
                                    newEntries[idx].description = e.target.value;
                                    setEditLabelEntries(newEntries);
                                  }}
                                  rows={2}
                                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-green-500"
                                />
                              </td>
                              <td className="px-2">
                                <button
                                  onClick={() => setEditLabelEntries(editLabelEntries.filter((_, i) => i !== idx))}
                                  className="text-red-600 hover:text-red-800 p-1"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Label EN Table */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Label (English) <span className="text-xs text-gray-500">(will be added, not replaced)</span>
                    </label>
                    <button
                      onClick={() => setEditLabelEnEntries([...editLabelEnEntries, { title: '', description: '' }])}
                      className="text-sm text-green-600 hover:text-green-800"
                    >
                      + Add Row
                    </button>
                  </div>
                  {editLabelEnEntries.length > 0 && (
                    <div className="border border-gray-300 rounded-lg overflow-hidden">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 w-1/3">Title</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-700">Description</th>
                            <th className="w-10"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {editLabelEnEntries.map((entry, idx) => (
                            <tr key={idx} className="border-t border-gray-200">
                              <td className="px-3 py-2">
                                <input
                                  type="text"
                                  value={entry.title}
                                  onChange={(e) => {
                                    const newEntries = [...editLabelEnEntries];
                                    newEntries[idx].title = e.target.value;
                                    setEditLabelEnEntries(newEntries);
                                  }}
                                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-green-500"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <textarea
                                  value={entry.description}
                                  onChange={(e) => {
                                    const newEntries = [...editLabelEnEntries];
                                    newEntries[idx].description = e.target.value;
                                    setEditLabelEnEntries(newEntries);
                                  }}
                                  rows={2}
                                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-green-500"
                                />
                              </td>
                              <td className="px-2">
                                <button
                                  onClick={() => setEditLabelEnEntries(editLabelEnEntries.filter((_, i) => i !== idx))}
                                  className="text-red-600 hover:text-red-800 p-1"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Group Name <span className="text-xs text-gray-500">(wird mit Leerzeichen angehängt)</span>
                  </label>
                  <input
                    type="text"
                    value={editGroupName}
                    onChange={(e) => setEditGroupName(e.target.value)}
                    placeholder="z.B. 'zusätzliche Gruppe'"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() => setShowEditForm(false)}
                    className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
                  >
                    Abbrechen
                  </button>
                  <button
                    onClick={handleBulkUpdate}
                    disabled={isSubmitting}
                    className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
                  >
                    {isSubmitting ? '💾 Speichert...' : `💾 ${selectedNodeIds.size} Nodes aktualisieren`}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Result Message */}
          {result && (
            <div className={`p-4 rounded-lg ${result.success ? 'bg-green-100 border border-green-400 text-green-800' : 'bg-red-100 border border-red-400 text-red-800'}`}>
              <p className="font-medium">{result.message}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors font-medium"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

// ============================================================
// Add Node Modal Komponente
// ============================================================
interface AddNodeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const AddNodeModal: React.FC<AddNodeModalProps> = ({ isOpen, onClose }) => {
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    label: '',
    label_en: '',
    level: 1,
    parent_id: '' as string,
    position: 0,
    group_name: ''
  });
  
  // Pattern wird automatisch aus Code-Länge berechnet
  const calculatedPattern = formData.code.trim().length > 0 ? formData.code.trim().length : null;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{success: boolean; message: string} | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setResult(null);

    try {
      const response = await fetch('http://localhost:8000/api/nodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          parent_id: formData.parent_id ? parseInt(formData.parent_id) : null,
          pattern: calculatedPattern  // Automatisch aus Code-Länge berechnet
        })
      });

      const data = await response.json();
      
      if (response.ok) {
        setResult({ success: true, message: `Node created with ID ${data.node_id}!` });
        
        // Invalidate queries to refresh UI
        queryClient.invalidateQueries({ queryKey: ['families'] });
        queryClient.invalidateQueries({ queryKey: ['product-families'] });
        for (let i = formData.level; i <= 20; i++) {
          queryClient.invalidateQueries({ queryKey: ['level-options', i] });
        }
        
        setTimeout(() => {
          onClose();
          setFormData({ code: '', name: '', label: '', label_en: '', level: 1, parent_id: '', position: 0, group_name: '' });
        }, 2000);
      } else {
        setResult({ success: false, message: data.detail || 'Failed to create node' });
      }
    } catch (error) {
      setResult({ success: false, message: `Error: ${error}` });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 bg-black/60 grid place-items-center z-50" onClick={onClose}>
      <div 
        className="bg-white border border-gray-300 rounded-xl w-[min(800px,92vw)] max-h-[90vh] overflow-y-auto flex flex-col shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-gray-900">➕ Add New Node</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-2xl">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Code</label>
              <input
                type="text"
                value={formData.code}
                onChange={(e) => setFormData({...formData, code: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g. TEST123"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({...formData, name: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g. Test Node"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Label *</label>
              <input
                type="text"
                value={formData.label}
                onChange={(e) => setFormData({...formData, label: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="German label"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Label EN</label>
              <input
                type="text"
                value={formData.label_en}
                onChange={(e) => setFormData({...formData, label_en: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="English label"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Level *</label>
              <input
                type="number"
                value={formData.level}
                onChange={(e) => setFormData({...formData, level: parseInt(e.target.value)})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                min="0"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Parent ID</label>
              <input
                type="number"
                value={formData.parent_id}
                onChange={(e) => setFormData({...formData, parent_id: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Leave empty for root"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Position</label>
              <input
                type="number"
                value={formData.position}
                onChange={(e) => setFormData({...formData, position: parseInt(e.target.value)})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                min="0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Pattern
                <span className="text-xs text-gray-500 ml-2">(auto: {calculatedPattern || 'N/A'})</span>
              </label>
              <input
                type="text"
                value={calculatedPattern || ''}
                disabled
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-100 cursor-not-allowed text-gray-600"
                placeholder="Wird aus Code-Länge berechnet"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Group Name</label>
              <input
                type="text"
                value={formData.group_name}
                onChange={(e) => setFormData({...formData, group_name: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Optional"
              />
            </div>
          </div>

          {result && (
            <div className={`p-3 rounded-lg ${result.success ? 'bg-green-50 border border-green-300 text-green-800' : 'bg-red-50 border border-red-300 text-red-800'}`}>
              {result.message}
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium transition-colors"
            >
              {isSubmitting ? 'Creating...' : 'Create Node'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};

const VariantenbaumConfigurator: React.FC = () => {
  const { user, logout } = useAuth();
  const [selectedFamily, setSelectedFamily] = useState<Node | null>(null);
  const [selections, setSelections] = useState<Record<number, AvailableOption>>({});
  const [pathSpecificSelections, setPathSpecificSelections] = useState<Record<number, AvailableOption>>({});
  const [maxVisibleLevel, setMaxVisibleLevel] = useState<number>(4); // Dynamisch basierend auf max-level
  const [isFamilyDropdownOpen, setIsFamilyDropdownOpen] = useState(false);
  const [familySearchTerm, setFamilySearchTerm] = useState('');
  const [isAddNodeModalOpen, setIsAddNodeModalOpen] = useState(false);
  const [isTypecodeModalOpen, setIsTypecodeModalOpen] = useState(false);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string | null>(null);
  const [addNodeContext, setAddNodeContext] = useState<{ level: number; familyCode: string } | null>(null);
  const [showResultImageModal, setShowResultImageModal] = useState(false);
  const [resultImageModalPictures, setResultImageModalPictures] = useState<NodePicture[]>([]);
  const [showResultLinksModal, setShowResultLinksModal] = useState(false);
  const [resultLinksModalLinks, setResultLinksModalLinks] = useState<NodeLink[]>([]);
  const [showBannerDetailModal, setShowBannerDetailModal] = useState(false);
  const [bannerDetailSelection, setBannerDetailSelection] = useState<{ level: number; option: AvailableOption } | null>(null);
  const [isSuccessorSelectionMode, setIsSuccessorSelectionMode] = useState(false);
  const [sourceSelectionForSuccessor, setSourceSelectionForSuccessor] = useState<{
    nodeIds: number[];  // ALL filtered node IDs (from ids array)
    code: string;
    label: string;
  } | null>(null);
  const [showCreateFamilyModal, setShowCreateFamilyModal] = useState(false);
  const [showEditFamilyModal, setShowEditFamilyModal] = useState(false);
  const [showDeleteFamilyModal, setShowDeleteFamilyModal] = useState(false);
  const [showDeleteNodeModal, setShowDeleteNodeModal] = useState(false);
  const [editingFamily, setEditingFamily] = useState<Node | null>(null);
  const [deletingFamily, setDeletingFamily] = useState<Node | null>(null);
  const [deletingNode, setDeletingNode] = useState<{ id: number; code: string; level: number } | null>(null);
  const [deletePreview, setDeletePreview] = useState<DeleteFamilyPreview | null>(null);
  const [deleteNodePreview, setDeleteNodePreview] = useState<DeleteNodePreview | null>(null);
  const [familyFormData, setFamilyFormData] = useState<CreateFamilyRequest>({
    code: '',
    label: null,
    label_en: null,
  });
  const [editFamilyFormData, setEditFamilyFormData] = useState<UpdateFamilyRequest>({
    label: '',
    label_en: null,
  });
  const familySearchInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus für Produktfamilien-Suchfeld
  useEffect(() => {
    if (isFamilyDropdownOpen && familySearchInputRef.current) {
      familySearchInputRef.current.focus();
    }
  }, [isFamilyDropdownOpen]);

  // Populate edit form when editing family
  useEffect(() => {
    if (editingFamily) {
      setEditFamilyFormData({
        label: editingFamily.label || '',
        label_en: editingFamily.label_en || null,
      });
    }
  }, [editingFamily]);

  // Query 1: Get Product Families
  const { data: families, isLoading: familiesLoading } = useQuery({
    queryKey: ['product-families'],
    queryFn: fetchProductFamilies,
  });

  // Query 2: Get available groups for selected family
  const { data: availableGroups } = useQuery({
    queryKey: ['family-groups', selectedFamily?.code],
    queryFn: () => fetchFamilyGroups(selectedFamily!.code!),
    enabled: selectedFamily !== null && selectedFamily.code !== null,
  });

  // Query 3a: Get max level for selected group filter
  const { data: groupMaxLevelData } = useQuery({
    queryKey: ['group-max-level', selectedFamily?.code, selectedGroupFilter],
    queryFn: () => fetchGroupMaxLevel(selectedFamily!.code!, selectedGroupFilter!),
    enabled: selectedFamily !== null && selectedGroupFilter !== null,
  });

  // Query 3b: Get Max Level für aktuell letzten ausgewählten Node
  const getLastSelectedNode = (): { code: string; level: number } | null => {
    if (!selectedFamily) return null;
    
    // Finde höchstes ausgewähltes Level
    const selectedLevels = Object.keys(selections).map(Number).sort((a, b) => b - a);
    
    if (selectedLevels.length > 0) {
      const lastLevel = selectedLevels[0];
      return { code: selections[lastLevel].code, level: lastLevel };
    }
    
    // Keine Selection -> benutze Familie
    return { code: selectedFamily.code!, level: 0 };
  };

  const lastNode = getLastSelectedNode();
  
  const { data: maxLevelData } = useQuery({
    queryKey: ['max-level', lastNode?.code, selectedFamily?.code],
    queryFn: () => fetchMaxLevel(lastNode!.code, selectedFamily?.code || undefined),
    enabled: lastNode !== null && selectedFamily !== null,
  });

  // Query 4: Abgeleiteter Group Name basierend auf bisherigen Auswahlen
  const { data: derivedGroupNameData } = useQuery({
    queryKey: ['derived-group-name', selectedFamily?.code, selections],
    queryFn: async () => {
      if (!selectedFamily) return null;
      
      const previousSelections: Selection[] = [
        { code: selectedFamily.code!, level: 0, id: selectedFamily.id, ids: [] },
        ...Object.entries(selections).map(([level, option]) => ({
          code: option.code,
          level: parseInt(level),
          id: option.id,
          ids: option.ids || [],
        }))
      ];
      
      return fetchDerivedGroupName(previousSelections);
    },
    enabled: selectedFamily !== null && Object.keys(selections).length > 0,
  });

  // Update maxVisibleLevel basierend auf API Response
  useEffect(() => {
    // Wenn Group-Filter aktiv ist, verwende dessen max_level
    if (selectedGroupFilter && groupMaxLevelData?.max_level !== undefined) {
      setMaxVisibleLevel(groupMaxLevelData.max_level);
    } else if (maxLevelData?.max_level !== undefined) {
      setMaxVisibleLevel(maxLevelData.max_level);
    }
  }, [maxLevelData, selectedGroupFilter, groupMaxLevelData]);

  // Lade pfad-spezifische Labels wenn alle Levels ausgewählt sind
  useEffect(() => {
    const loadPathSpecificLabels = async () => {
      if (!selectedFamily || Object.keys(selections).length === 0) {
        setPathSpecificSelections({});
        return;
      }

      const newPathSpecific: Record<number, AvailableOption> = {};
      
      // Für jedes ausgewählte Level
      for (const levelStr of Object.keys(selections)) {
        const level = parseInt(levelStr);
        const selection = selections[level];
        
        // Baue Parent-Codes Array
        const parentCodes: string[] = [];
        for (let i = 1; i < level; i++) {
          if (selections[i]) {
            parentCodes.push(selections[i].code);
          }
        }
        
        try {
          // Finde die pfad-spezifische Node
          const result = await findNodeIdByPath(
            selection.code,
            level,
            selectedFamily.code!,
            parentCodes
          );
          
          if (result.found && result.node) {
            // Verwende die pfad-spezifischen Daten
            newPathSpecific[level] = {
              ...selection,
              label: result.node.label || selection.label,
              label_en: result.node.label_en || selection.label_en,
              name: result.node.name || selection.name,
              id: result.node.id
            };
          } else {
            // Fallback auf ursprüngliche Daten
            newPathSpecific[level] = selection;
          }
        } catch (error) {
          console.error(`Fehler beim Laden pfad-spezifischer Labels für Level ${level}:`, error);
          newPathSpecific[level] = selection;
        }
      }
      
      setPathSpecificSelections(newPathSpecific);
    };

    loadPathSpecificLabels();
  }, [selections, selectedFamily]);

  // Query 4: Get Available Options for each level
  const getOptionsForLevel = (level: number) => {
    // Sammle ALLE Selections (auch spätere Levels!)
    const allSelections: Selection[] = [];
    
    // Familie als Level 0
    if (selectedFamily) {
      allSelections.push({
        code: selectedFamily.code!,
        level: 0,
        id: selectedFamily.id,
        ids: selectedFamily.id ? [selectedFamily.id] : []  // Als Array
      });
    }
    
    // ALLE Selections (vor UND nach diesem Level) - außer diesem Level selbst
    for (let i = 1; i <= 50; i++) {
      if (i !== level && selections[i]) {
        const sel = selections[i];
        allSelections.push({
          code: sel.code,
          level: i,
          ids: sel.ids && sel.ids.length > 0 ? sel.ids : []  // NUR ids verwenden, kein Fallback auf id!
        });
      }
    }

    // WICHTIG: Verwende JSON-String als queryKey für korrekte Vergleichbarkeit!
    // React Query vergleicht Arrays per Referenz, nicht per Inhalt.
    const selectionsKey = JSON.stringify(allSelections);

    return useQuery({
      queryKey: ['options', level, selectionsKey, selectedGroupFilter],
      queryFn: () => fetchAvailableOptions(level, allSelections, selectedGroupFilter),
      enabled: selectedFamily !== null, // Keine Abhängigkeit von vorherigen Levels!
    });
  };

  // Queries für Level 1-20 (werden nur bei Bedarf geladen durch 'enabled')
  // WICHTIG: Hooks müssen immer in gleicher Reihenfolge aufgerufen werden!
  const level1Query = getOptionsForLevel(1);
  const level2Query = getOptionsForLevel(2);
  const level3Query = getOptionsForLevel(3);
  const level4Query = getOptionsForLevel(4);
  const level5Query = getOptionsForLevel(5);
  const level6Query = getOptionsForLevel(6);
  const level7Query = getOptionsForLevel(7);
  const level8Query = getOptionsForLevel(8);
  const level9Query = getOptionsForLevel(9);
  const level10Query = getOptionsForLevel(10);
  const level11Query = getOptionsForLevel(11);
  const level12Query = getOptionsForLevel(12);
  const level13Query = getOptionsForLevel(13);
  const level14Query = getOptionsForLevel(14);
  const level15Query = getOptionsForLevel(15);
  const level16Query = getOptionsForLevel(16);
  const level17Query = getOptionsForLevel(17);
  const level18Query = getOptionsForLevel(18);
  const level19Query = getOptionsForLevel(19);
  const level20Query = getOptionsForLevel(20);
  
  // Mapping für dynamischen Zugriff
  const levelQueries: Record<number, ReturnType<typeof getOptionsForLevel>> = {
    1: level1Query,
    2: level2Query,
    3: level3Query,
    4: level4Query,
    5: level5Query,
    6: level6Query,
    7: level7Query,
    8: level8Query,
    9: level9Query,
    10: level10Query,
    11: level11Query,
    12: level12Query,
    13: level13Query,
    14: level14Query,
    15: level15Query,
    16: level16Query,
    17: level17Query,
    18: level18Query,
    19: level19Query,
    20: level20Query,
  };

  const handleFamilyChange = (family: Node) => {
    setSelectedFamily(family);
    setSelections({}); // Reset selections
    setIsFamilyDropdownOpen(false);
    setFamilySearchTerm(''); // Clear search
  };

  const handleLevelSelection = async (level: number, option: AvailableOption) => {
    console.log(`Selected at level ${level}:`, option);
    
    // Wenn die Option INKOMPATIBEL ist, cleanup durchführen!
    if (!option.is_compatible) {
      console.log(`⚠️ Incompatible option selected! Resetting ALL other selections...`);
      
      // RESET: Nur diese eine Auswahl behalten
      const newSelections: Record<number, AvailableOption> = {
        [level]: option
      };
      
      setSelections(newSelections);
      console.log(`Reset to single selection:`, newSelections);
      
      // Invalidiere alle Query Caches
      queryClient.invalidateQueries({ queryKey: ['options'] });
    } else {
      // Kompatible Auswahl
      const newSelections = { ...selections };
      newSelections[level] = option;
      
      setSelections(newSelections);
      console.log(`✅ Selection set:`, newSelections);
      
      // KRITISCH: Invalidiere Query Cache - das triggert Neuladen ALLER Dropdowns!
      // Alle Dropdowns werden mit den aktualisierten IDs (basierend auf der neuen Selection) neu geladen.
      // Das Backend filtert die IDs für jedes Level basierend auf ALLE anderen Selections.
      queryClient.invalidateQueries({ queryKey: ['options'] });
      
      // WICHTIG: Nach dem Invalidieren müssen wir die gespeicherten Selections aktualisieren!
      // Warte kurz, damit die Queries neu laden, dann aktualisiere die IDs.
      setTimeout(async () => {
        const updatedSelections = { ...newSelections };
        let needsUpdate = false;
        
        // Für jede gespeicherte Selection: Hole die aktualisierte Version mit gefilterten IDs
        for (const [lvl, sel] of Object.entries(updatedSelections)) {
          const lvlNum = parseInt(lvl);
          if (lvlNum === level) continue; // Skip die gerade gewählte Selection
          
          // Baue previous_selections für dieses Level
          const prevSelections: any[] = [];
          if (selectedFamily) {
            prevSelections.push({ code: selectedFamily.code, level: 0, ids: [] });
          }
          Object.entries(updatedSelections).forEach(([l, s]) => {
            const lNum = parseInt(l);
            if (lNum !== lvlNum) {
              prevSelections.push({ code: s.code, level: lNum, ids: s.ids || [] });
            }
          });
          
          // Hole aktualisierte Optionen für dieses Level
          try {
            const response = await fetchAvailableOptions(lvlNum, prevSelections, selectedGroupFilter);
            const updatedOption = response.find((opt: AvailableOption) => opt.code === sel.code);
            
            if (updatedOption && JSON.stringify(updatedOption.ids) !== JSON.stringify(sel.ids)) {
              console.log(`🔄 Updating IDs for ${sel.code} at level ${lvlNum}:`, {
                old: sel.ids,
                new: updatedOption.ids
              });
              updatedSelections[lvlNum] = updatedOption;
              needsUpdate = true;
            }
          } catch (error) {
            console.error(`Failed to update selection at level ${lvlNum}:`, error);
          }
        }
        
        if (needsUpdate) {
          console.log(`✅ Updated selections with filtered IDs:`, updatedSelections);
          setSelections(updatedSelections);
        }
      }, 100); // Kurze Verzögerung damit Queries laden können
    }
  };

  // Generiere Typecode (mit Leerzeichen für API-Calls)
  const typecode = selectedFamily 
    ? [
        selectedFamily.code,
        ...Object.keys(selections)
          .map(Number)
          .sort((a, b) => a - b)
          .map(level => selections[level].code)
      ].join(' ')
    : '';
  
  // Display-Version mit Wildcards und Bindestrichen (nur für Anzeige)
  const displayTypecode = selectedFamily
    ? (() => {
        const maxLevel = Math.max(...Object.keys(selections).map(Number), 0);
        const parts = [selectedFamily.code];
        
        // Füge alle Level von 1 bis maxLevel hinzu, mit '*' für übersprungene
        for (let i = 1; i <= maxLevel; i++) {
          parts.push(selections[i] ? selections[i].code : '*');
        }
        
        return parts.join('-');
      })()
    : '';

  // Hole decode result für das Result-Feld (um group_name zu bekommen)
  const resultDecodeQuery = useQuery({
    queryKey: ['decode-result', typecode],
    queryFn: () => decodeTypecode(typecode),
    enabled: !!typecode && Object.keys(selections).length > 0,
    staleTime: 30000,
  });

  // Product Successor Check - Phase 1: Leaf/Intermediate Products
  const productSuccessorQuery = useQuery({
    queryKey: ['product-successor', typecode, selections],
    queryFn: async () => {
      if (!typecode) return { has_successor: false };
      
      const previousSelections: Selection[] = selectedFamily ? [
        { code: selectedFamily.code!, level: 0, id: selectedFamily.id, ids: [] },
        ...Object.entries(selections).map(([level, option]) => ({
          code: option.code,
          level: parseInt(level),
          id: option.id,
          ids: option.ids || [],
        }))
      ] : [];
      
      return fetchProductSuccessor(typecode, previousSelections);
    },
    enabled: !!typecode && Object.keys(selections).length > 0,
    staleTime: 30000,
  });

  // Mutation: Create Successor Relationship (Bulk)
  const createSuccessorMutation = useMutation({
    mutationFn: createSuccessorBulk,
    onSuccess: (data) => {
      if (data.type === 'links') {
        const skipMsg = data.skipped_count && data.skipped_count > 0 
          ? ` (${data.skipped_count} bereits vorhanden)` 
          : '';
        alert(`✅ ${data.created_count} Nachfolger-Verlinkungen erstellt${skipMsg}`);
      } else if (data.type === 'hint') {
        if (data.updated_count && data.updated_count > 0) {
          alert(`📝 Hinweis aktualisiert: ${data.source_count} → ${data.target_count} Nodes`);
        } else {
          alert(`📝 Hinweis erstellt: ${data.source_count} → ${data.target_count} Nodes\n(Unterschiedliche Anzahl oder keine Endprodukte)`);
        }
      }
      setIsSuccessorSelectionMode(false);
      setSourceSelectionForSuccessor(null);
      // Reset selections to start fresh
      setSelections({});
    },
    onError: (error: any) => {
      alert(`❌ Fehler: ${error.message || 'Unbekannter Fehler'}`);
    },
  });

  // Mutation: Create Family
  const createFamilyMutation = useMutation({
    mutationFn: createFamily,
    onSuccess: (data) => {
      alert(`✅ Produktfamilie "${data.code}" erfolgreich erstellt!`);
      setShowCreateFamilyModal(false);
      setFamilyFormData({ code: '', label: null, label_en: null });
      // Invalidate families query to refresh dropdown
      queryClient.invalidateQueries({ queryKey: ['families'] });
    },
    onError: (error: any) => {
      alert(`❌ Fehler: ${error.message || 'Unbekannter Fehler'}`);
    },
  });

  const updateFamilyMutation = useMutation({
    mutationFn: ({ code, data }: { code: string; data: UpdateFamilyRequest }) => 
      updateFamily(code, data),
    onSuccess: (data) => {
      alert(`✅ Labels für Produktfamilie "${data.code}" erfolgreich aktualisiert!`);
      setShowEditFamilyModal(false);
      setEditingFamily(null);
      // Invalidate families query to refresh dropdown
      queryClient.invalidateQueries({ queryKey: ['families'] });
      queryClient.invalidateQueries({ queryKey: ['product-families'] });
    },
    onError: (error: any) => {
      alert(`❌ Fehler: ${error.message || 'Unbekannter Fehler'}`);
    },
  });

  const deleteFamilyMutation = useMutation({
    mutationFn: (familyCode: string) => deleteFamily(familyCode),
    onSuccess: (data) => {
      alert(`✅ Produktfamilie "${data.code}" und ${data.deleted_nodes} Nodes erfolgreich gelöscht!`);
      setShowDeleteFamilyModal(false);
      setDeletingFamily(null);
      setDeletePreview(null);
      // Clear selection if deleted family was selected
      if (selectedFamily?.code === data.code) {
        setSelectedFamily(null);
        setSelections({});
      }
      // Invalidate families query to refresh dropdown
      queryClient.invalidateQueries({ queryKey: ['families'] });
      queryClient.invalidateQueries({ queryKey: ['product-families'] });
    },
    onError: (error: any) => {
      alert(`❌ Fehler: ${error.message || 'Unbekannter Fehler'}`);
    },
  });

  const deleteNodeMutation = useMutation({
    mutationFn: (nodeId: number) => deleteNode(nodeId),
    onSuccess: (data) => {
      alert(`✅ Node "${data.code}" (Level ${data.level}) und ${data.deleted_nodes} Descendants erfolgreich gelöscht!`);
      setShowDeleteNodeModal(false);
      setDeletingNode(null);
      setDeleteNodePreview(null);
      
      // Clear selection if deleted node was selected
      if (selections[data.level]?.id === data.node_id) {
        const newSelections = { ...selections };
        // Remove this level and all higher levels
        for (let i = data.level; i <= 20; i++) {
          delete newSelections[i];
        }
        setSelections(newSelections);
      }
      
      // Invalidate level queries to refresh options
      for (let i = data.level; i <= 20; i++) {
        queryClient.invalidateQueries({ queryKey: ['level-options', i] });
      }
    },
    onError: (error: any) => {
      alert(`❌ Fehler: ${error.message || 'Unbekannter Fehler'}`);
    },
  });

  /**
   * Prüft ob Add Node für ein Level erlaubt ist.
   * Bedingung: ALLE Levels von 0 (Familie) bis level-1 müssen lückenlos selektiert sein.
   * Damit ist die Parent-ID eindeutig bestimmt.
   */
  const isAddNodeAllowedForLevel = (level: number): boolean => {
    if (!selectedFamily?.code) return false;
    
    // Level 1: Nur Familie muss selektiert sein
    if (level === 1) return true;
    
    // Level 2+: ALLE Levels von 1 bis level-1 müssen selektiert sein
    for (let i = 1; i < level; i++) {
      if (!selections[i]) {
        return false; // Lücke gefunden!
      }
    }
    
    return true; // Alle Levels lückenlos selektiert
  };

  return (
    <div className="fixed inset-0 bg-gray-50 flex flex-col">
      {/* Header with User Info and Actions - Fixed at top */}
      <div className="bg-white shadow-md border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            {/* Title & User Info */}
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
                Produktschlüsselkonfigurator
              </h1>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-gray-700">👤 {user?.username}</span>
                {user?.role === 'admin' && (
                  <span className="px-2 py-1 bg-purple-100 text-purple-700 text-xs rounded-md font-semibold">
                    Admin
                  </span>
                )}
              </div>
            </div>
            
            {/* Action Buttons */}
            <div className="flex flex-wrap gap-2">
              {user?.must_change_password && (
                <button
                  onClick={() => setShowChangePasswordModal(true)}
                  className="px-3 py-1.5 text-sm bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-all font-medium shadow-sm hover:shadow-md animate-pulse"
                >
                  Change Password Required
                </button>
              )}
              {user?.role === 'admin' && (
                <Link
                  to="/admin"
                  className="px-3 py-1.5 text-sm bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-all font-medium shadow-sm hover:shadow-md"
                >
                  Admin Panel
                </Link>
              )}
              <button
                onClick={() => setShowChangePasswordModal(true)}
                className="px-3 py-1.5 text-sm bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-all font-medium shadow-sm hover:shadow-md"
              >
                Change Password
              </button>
              <button
                onClick={logout}
                className="px-3 py-1.5 text-sm bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-all font-medium shadow-sm hover:shadow-md"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Sticky Product Code Banner - Nur anzeigen wenn Familie und mindestens eine Auswahl */}
      {selectedFamily && Object.keys(selections).length > 0 && (
        <div className="sticky top-0 z-30 bg-gradient-to-r from-green-500 to-green-600 shadow-lg border-b-2 border-green-700">
          <div className="max-w-7xl mx-auto px-6 py-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-2">
                {/* Produktschlüssel */}
                <div className="flex items-center gap-3">
                  <span className="text-white font-semibold text-sm">Aktueller Produktschlüssel:</span>
                  <div className="flex items-center gap-1 bg-white/20 backdrop-blur-sm rounded-lg px-3 py-1.5">
                  {/* Familie */}
                  <div className="relative group">
                    <span 
                      className="font-mono font-bold text-white text-lg cursor-pointer hover:text-green-100 transition-colors"
                      onClick={() => {
                        // Familie hat keine AvailableOption, nur Node-Daten
                        setBannerDetailSelection({ 
                          level: 0, 
                          option: {
                            id: selectedFamily.id,
                            code: selectedFamily.code ?? '',
                            label: selectedFamily.label || null,
                            label_en: selectedFamily.label_en || null,
                            name: null,
                            level: 0,
                            position: 0,
                            is_compatible: true,
                            pictures: [],
                            links: []
                          }
                        });
                        setShowBannerDetailModal(true);
                      }}
                    >
                      {selectedFamily.code}
                    </span>
                    {/* Tooltip für Familie */}
                    <div className="absolute top-full left-0 mt-2 hidden group-hover:block z-50 w-64 bg-gray-900 text-white text-sm rounded-lg shadow-xl p-3 pointer-events-none">
                      <div className="font-semibold mb-1">Level 0 - Produktfamilie</div>
                      {selectedFamily.label && (
                        <div className="text-gray-300">{selectedFamily.label}</div>
                      )}
                    </div>
                  </div>
                  
                  {/* Level Codes mit Wildcards */}
                  {(() => {
                    const maxLevel = Math.max(...Object.keys(selections).map(Number));
                    const segments = [];
                    
                    for (let i = 1; i <= maxLevel; i++) {
                      const selection = selections[i];
                      const displaySelection = pathSpecificSelections[i] || selection;
                      
                      segments.push(
                        <React.Fragment key={i}>
                          <span className="text-white/60 font-bold">-</span>
                          {selection ? (
                            <div className="relative group">
                              <span 
                                className="font-mono font-bold text-white text-lg cursor-pointer hover:text-green-100 transition-colors"
                                onClick={() => {
                                  setBannerDetailSelection({ level: i, option: selection });
                                  setShowBannerDetailModal(true);
                                }}
                              >
                                {selection.code}
                              </span>
                              {/* Tooltip für Code */}
                              <div className="absolute top-full left-0 mt-2 hidden group-hover:block z-50 w-72 bg-gray-900 text-white text-sm rounded-lg shadow-xl p-3 pointer-events-none">
                                <div className="font-semibold mb-1">Level {i}</div>
                                <div className="font-mono text-green-400 mb-2">{selection.code}</div>
                                {displaySelection.name && (
                                  <div className="mb-2">
                                    <span className="text-gray-400">Name:</span>
                                    <div className="mt-1">
                                      <span className="bg-purple-600 text-white text-xs font-medium px-2 py-1 rounded">
                                        {displaySelection.name}
                                      </span>
                                    </div>
                                  </div>
                                )}
                                {displaySelection.label && (
                                  <div className="mb-2">
                                    <span className="text-gray-400">DE:</span>
                                    <div className="text-gray-200 whitespace-pre-line">{displaySelection.label}</div>
                                  </div>
                                )}
                                {displaySelection.label_en && (
                                  <div>
                                    <span className="text-gray-400">EN:</span>
                                    <div className="text-gray-200 whitespace-pre-line">{displaySelection.label_en}</div>
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span className="font-mono font-bold text-white/40 text-lg">*</span>
                          )}
                        </React.Fragment>
                      );
                    }
                    
                    return segments;
                  })()}
                </div>
                
                {/* Produktfamilie (Group Name) - falls abgeleitet oder von decode */}
                {(resultDecodeQuery.data?.group_name || (derivedGroupNameData?.is_unique && derivedGroupNameData?.group_name)) && (
                  <div className="flex items-center gap-2">
                    <span className="text-white/90 font-medium text-xs">Produktfamilie:</span>
                    <span className="bg-white/30 backdrop-blur-sm text-white font-semibold text-sm px-3 py-1 rounded-md">
                      {resultDecodeQuery.data?.group_name || derivedGroupNameData?.group_name}
                    </span>
                    {!resultDecodeQuery.data?.group_name && derivedGroupNameData?.is_unique && (
                      <span className="text-white/70 text-xs italic">
                        (abgeleitet)
                      </span>
                    )}
                  </div>
                )}
                
                {/* Mehrere mögliche Group Names */}
                {!resultDecodeQuery.data?.group_name && derivedGroupNameData && !derivedGroupNameData.is_unique && derivedGroupNameData.possible_group_names.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-white/90 font-medium text-xs">Mögliche Produktfamilien:</span>
                    <div className="flex gap-1.5">
                      {derivedGroupNameData.possible_group_names.map((name, idx) => (
                        <span key={idx} className="bg-yellow-400/30 backdrop-blur-sm text-white text-xs font-medium px-2 py-0.5 rounded">
                          {name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              </div>
              
              {/* Optional: Scroll-to-Details Button */}
              <button
                onClick={() => {
                  document.getElementById('result-section')?.scrollIntoView({ behavior: 'smooth' });
                }}
                className="text-white hover:text-green-100 text-xs font-medium flex items-center gap-1 transition-colors"
              >
                Details ↓
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area - Scrollable */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-6">
          {/* Content Container with white background */}
          <div className="bg-white rounded-xl shadow-md p-6 mb-6">

          <div className="flex gap-3 mb-8">
            <button
              onClick={() => setIsTypecodeModalOpen(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center gap-2 shadow-md hover:shadow-lg"
            >
              🔍 Produktcode Checker
            </button>
          </div>

      {/* Product Family Selection */}
      <div className="mb-8">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Product Family
        </label>
        
        {/* Custom Dropdown für Product Families */}
        <div className="relative">
          <button
            className="w-full p-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-left bg-white flex justify-between items-center disabled:bg-gray-100"
            onClick={() => setIsFamilyDropdownOpen(!isFamilyDropdownOpen)}
            disabled={familiesLoading}
          >
            <span>
              {familiesLoading ? (
                'Loading families...'
              ) : selectedFamily ? (
                `${selectedFamily.code}`
              ) : (
                'Please select a product family...'
              )}
            </span>
            <span className="text-gray-400">
              {isFamilyDropdownOpen ? '▲' : '▼'}
            </span>
          </button>

          {isFamilyDropdownOpen && !familiesLoading && families && (
            <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg">
              {/* Suchfeld */}
              <div className="p-3 border-b border-gray-200 bg-white rounded-t-lg">
                <input
                  ref={familySearchInputRef}
                  type="text"
                  placeholder="Search families..."
                  className="w-full px-4 py-3 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 hover:bg-white"
                  value={familySearchTerm}
                  onChange={(e) => setFamilySearchTerm(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
              
              {/* Familien-Liste */}
              <div className="overflow-y-auto max-h-60 p-2">
                {families
                  .filter(family => {
                    if (!familySearchTerm.trim()) return true;
                    const search = familySearchTerm.toLowerCase();
                    return family.code?.toLowerCase().includes(search) ||
                           family.label?.toLowerCase().includes(search);
                  })
                  .map((family) => (
                    <div
                      key={family.code}
                      className={`flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-blue-50 text-gray-900 rounded ${
                        selectedFamily?.code === family.code ? 'bg-blue-100' : ''
                      }`}
                    >
                      <div
                        className="flex-1 cursor-pointer"
                        onClick={() => handleFamilyChange(family)}
                      >
                        <span className="font-mono font-semibold">{family.code}</span>
                        {family.label && (
                          <span className="ml-2 text-sm text-gray-600">{family.label}</span>
                        )}
                      </div>
                      {user?.role === 'admin' && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingFamily(family);
                              setShowEditFamilyModal(true);
                            }}
                            className="flex-shrink-0 p-1.5 text-blue-600 hover:bg-blue-100 rounded-full transition-colors"
                            title="Labels bearbeiten"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </button>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              setDeletingFamily(family);
                              // Fetch preview
                              try {
                                const preview = await previewFamilyDeletion(family.code!);
                                setDeletePreview(preview);
                                setShowDeleteFamilyModal(true);
                              } catch (error: any) {
                                alert(`❌ Fehler beim Laden der Vorschau: ${error.message}`);
                              }
                            }}
                            className="flex-shrink-0 p-1.5 text-red-600 hover:bg-red-100 rounded-full transition-colors"
                            title="Produktfamilie löschen"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  
                {families.filter(family => {
                  if (!familySearchTerm.trim()) return true;
                  const search = familySearchTerm.toLowerCase();
                  return family.code?.toLowerCase().includes(search) ||
                         family.label?.toLowerCase().includes(search);
                }).length === 0 && (
                  <div className="px-4 py-6 text-center text-gray-400 text-sm">
                    No families found for "{familySearchTerm}"
                  </div>
                )}
              </div>

              {/* Admin: Create Family Button */}
              {user?.role === 'admin' && (
                <div className="p-3 border-t border-gray-200 bg-gray-50 rounded-b-lg">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowCreateFamilyModal(true);
                      setIsFamilyDropdownOpen(false);
                    }}
                    className="w-full px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium text-sm flex items-center justify-center gap-2"
                  >
                    <span className="text-lg">+</span>
                    <span>Create New Family</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Group Filter Dropdown */}
      {selectedFamily && availableGroups && availableGroups.length > 0 && (
        <div className="mb-8">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Group Filter (optional)
          </label>
          <select
            className="w-full p-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 bg-white"
            value={selectedGroupFilter || ''}
            onChange={(e) => {
              const value = e.target.value || null;
              setSelectedGroupFilter(value);
              // Reset selections when filter changes
              setSelections({});
            }}
          >
            <option value="">All Groups (No Filter)</option>
            {availableGroups.map((group) => (
              <option key={group} value={group}>
                {group}
              </option>
            ))}
          </select>
          {/* {selectedGroupFilter && groupMaxLevelData && (
            <p className="mt-2 text-sm text-gray-600">
              Max Level für "{selectedGroupFilter}": {groupMaxLevelData.max_level}
            </p>
          )} */}
        </div>
      )}

      {/* Group Configuration */}
      {selectedFamily && (
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-4 flex items-center gap-3">
            Configuration
            <span className="text-sm text-gray-500 font-normal">
              (Max Level: {maxVisibleLevel})
            </span>
          </h2>
          <div className="space-y-4">
            {/* Dynamische Level-Rendering basierend auf maxVisibleLevel */}
            {Array.from({ length: maxVisibleLevel }, (_, i) => i + 1).map((level) => {
              const query = levelQueries[level];
              const hasOptions = query?.data && query.data.length > 0;
              const isLoading = query?.isLoading || false;
              const hasLoaded = query && !isLoading;  // Query ist fertig geladen
              
              // Zeige Level nur wenn:
              // 1. Es lädt noch (zeige Skeleton)
              // 2. ODER es hat Optionen
              // 3. ODER es ist bereits selektiert
              // 4. ODER es ist Level 1
              // Verstecke Level wenn: fertig geladen UND keine Optionen UND nicht selektiert UND nicht Level 1
              if (hasLoaded && !hasOptions && !selections[level] && level > 1) {
                return null;  // Level überspringen
              }
              
              return (
                <GroupSelector
                  key={level}
                  level={level}
                  groupName={`Gruppe ${level}`}
                  options={query?.data || []}
                  selectedOption={selections[level]}
                  onSelectionChange={(opt) => handleLevelSelection(level, opt)}
                  isLoading={isLoading}
                  familyCode={selectedFamily?.code || undefined}
                  previousSelections={selections}
                  onAddNode={() => {
                    if (selectedFamily?.code) {
                      setAddNodeContext({ level, familyCode: selectedFamily.code });
                      setIsAddNodeModalOpen(true);
                    }
                  }}
                  isAddNodeDisabled={!isAddNodeAllowedForLevel(level)}
                  user={user}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Result */}
      {selectedFamily && Object.keys(selections).length > 0 && (
        <div id="result-section" className="bg-green-50 border border-green-200 rounded-lg p-6">
          <div className="space-y-4">
            {/* Typcode */}
            <div className="bg-white border border-green-300 rounded-lg p-4">
              <span className="font-medium text-green-700">Typcode: </span>
              <span className="ml-2 font-mono text-lg text-green-800">{displayTypecode}</span>
            </div>

            {/* Group Name (Produktfamilie) - von decode result ODER abgeleitet */}
            {(resultDecodeQuery.data?.group_name || (derivedGroupNameData?.is_unique && derivedGroupNameData?.group_name)) && (
              <div className="bg-white border border-green-300 rounded-lg p-4">
                <span className="font-medium text-green-700">Produktfamilie: </span>
                <span className="ml-2 text-green-800">
                  {resultDecodeQuery.data?.group_name || derivedGroupNameData?.group_name}
                </span>
                {/* Zeige Hinweis wenn abgeleitet und nicht vollständig */}
                {!resultDecodeQuery.data?.group_name && derivedGroupNameData?.is_unique && (
                  <span className="ml-3 text-sm text-gray-500 italic">
                    (wird durch Ihre Auswahlen eindeutig festgelegt)
                  </span>
                )}
              </div>
            )}

            {/* Mögliche Group Names (falls mehrere) */}
            {!resultDecodeQuery.data?.group_name && derivedGroupNameData && !derivedGroupNameData.is_unique && derivedGroupNameData.possible_group_names.length > 0 && (
              <div className="bg-white border border-yellow-300 rounded-lg p-4">
                <span className="font-medium text-yellow-700">Mögliche Produktfamilien: </span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {derivedGroupNameData.possible_group_names.map((name, idx) => (
                    <span key={idx} className="bg-yellow-100 text-yellow-800 text-sm font-medium px-3 py-1 rounded">
                      {name}
                    </span>
                  ))}
                </div>
                <span className="text-sm text-gray-500 italic mt-2 block">
                  Wählen Sie weitere Optionen, um die Produktfamilie eindeutig festzulegen
                </span>
              </div>
            )}

            {/* Segment-by-segment Description */}
            <div className="space-y-3">
              <h4 className="font-medium text-green-800 text-lg">Pfad-Segmente:</h4>
              
              {/* Produktfamilie Segment */}
              <div className="bg-white border border-gray-300 rounded-lg p-4">
                <div className="flex items-center gap-3 mb-3">
                  <span className="bg-green-100 text-green-800 text-sm font-medium px-3 py-1 rounded">
                    Level 0
                  </span>
                  <span className="font-mono font-bold text-gray-800 text-lg">
                    {selectedFamily.code}
                  </span>
                  <InfoIcon
                    pictures={selectedFamily.pictures || []}
                    onClick={() => {
                      const pictures = selectedFamily.pictures || [];
                      if (pictures.length > 0) {
                        setResultImageModalPictures(pictures);
                        setShowResultImageModal(true);
                      }
                    }}
                  />
                  <LinkIcon
                    links={selectedFamily.links || []}
                    onClick={() => {
                      const links = selectedFamily.links || [];
                      if (links.length > 0) {
                        setResultLinksModalLinks(links);
                        setShowResultLinksModal(true);
                      }
                    }}
                  />
                </div>
                
                {selectedFamily.name && (
                  <div className="mb-2">
                    <span className="text-gray-600 font-medium">Name:</span>
                    <span className="ml-2 text-gray-900">{selectedFamily.name}</span>
                  </div>
                )}

                {(selectedFamily.label || selectedFamily.label_en) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-base">
                    {selectedFamily.label && (
                      <div>
                        <span className="text-gray-600 font-medium">Label:</span>
                        <span className="ml-2 text-gray-900">{selectedFamily.label}</span>
                      </div>
                    )}
                    {selectedFamily.label_en && (
                      <div>
                        <span className="text-gray-600 font-medium">Label EN:</span>
                        <span className="ml-2 text-gray-900">{selectedFamily.label_en}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
              
              {/* Segmente für jedes Level */}
              {Object.keys(selections)
                .map(Number)
                .sort((a, b) => a - b)
                .map((level) => {
                  // Verwende pfad-spezifische Daten wenn verfügbar, sonst Fallback auf normale Selections
                  const selection = pathSpecificSelections[level] || selections[level];
                  return (
                    <div key={level} className="bg-white border border-gray-300 rounded-lg p-4">
                      <div className="flex items-center gap-3 mb-3">
                        <span className="bg-blue-100 text-blue-800 text-sm font-medium px-3 py-1 rounded">
                          Level {level}
                        </span>
                        <span className="font-mono font-bold text-gray-800 text-lg">
                          {selection.code}
                        </span>
                        <InfoIcon
                          pictures={selection.pictures || []}
                          onClick={() => {
                            const pictures = selection.pictures || [];
                            if (pictures.length > 0) {
                              setResultImageModalPictures(pictures);
                              setShowResultImageModal(true);
                            }
                          }}
                        />
                        <LinkIcon
                          links={selection.links || []}
                          onClick={() => {
                            const links = selection.links || [];
                            if (links.length > 0) {
                              setResultLinksModalLinks(links);
                              setShowResultLinksModal(true);
                            }
                          }}
                        />
                      </div>

                      {selection.name && (
                        <div className="mb-2">
                          <span className="text-gray-600 font-medium">Name:</span>
                          <span className="ml-2 text-gray-900">{selection.name}</span>
                        </div>
                      )}

                      {(selection.label || selection.label_en) && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-base">
                          {selection.label && (
                            <div>
                              <span className="text-gray-600 font-medium">Label:</span>
                              <div className="ml-2 text-gray-900 whitespace-pre-line">{selection.label}</div>
                            </div>
                          )}
                          {selection.label_en && (
                            <div>
                              <span className="text-gray-600 font-medium">Label EN:</span>
                              <div className="ml-2 text-gray-900 whitespace-pre-line">{selection.label_en}</div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>

            {/* Product Successor Warning - Phase 1 */}
            {productSuccessorQuery.data?.has_successor && (
              <SuccessorWarning
                successor={productSuccessorQuery.data}
                onSwitchToNew={() => {
                  // Navigate to new product
                  if (productSuccessorQuery.data.target_full_code) {
                    // Decode new product and auto-configure
                    decodeTypecode(productSuccessorQuery.data.target_full_code).then(result => {
                      if (result.exists && result.path_segments && result.path_segments.length > 0) {
                        // Reset current configuration
                        setSelections({});
                        setSelectedFamily(null);
                        setSelectedGroupFilter(null);
                        
                        // Set new family from first segment
                        const familySegment = result.path_segments[0];
                        if (familySegment && familySegment.code) {
                          // Find family in the list
                          fetchProductFamilies().then(families => {
                            const newFamily = families.find(f => f.code === familySegment.code);
                            if (newFamily) {
                              setSelectedFamily(newFamily);
                              
                              // Set all other selections
                              const newSelections: Record<number, AvailableOption> = {};
                              result.path_segments.slice(1).forEach(segment => {
                                if (segment.code) {
                                  newSelections[segment.level] = {
                                    id: 0, // ID will be resolved by React Query
                                    code: segment.code,
                                    label: segment.label || '',
                                    label_en: segment.label_en || null,
                                    name: segment.name || '',
                                    position: segment.position_start || 0,
                                    ids: [],
                                    pictures: segment.pictures || [],
                                    links: segment.links || [],
                                    level: segment.level,
                                    is_compatible: true,
                                  };
                                }
                              });
                              setSelections(newSelections);
                              
                              // Scroll to top
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }
                          });
                        }
                      }
                    });
                  }
                }}
                onContinueWithOld={() => {
                  // Just dismiss - user continues with old product
                  // The warning will re-appear on next page load
                  console.log('User continues with deprecated product');
                }}
              />
            )}

            {/* Admin: Add Successor Button */}
            {user?.role === 'admin' && !isSuccessorSelectionMode && (selectedFamily || Object.keys(selections).length > 0) && (
              <div className="mt-4 p-4 bg-orange-50 border border-orange-200 rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-orange-900">🔗 Nachfolger-Verwaltung (Admin)</div>
                    <div className="text-sm text-orange-700 mt-1">
                      Füge eine Nachfolger-Verlinkung für {typecode ? 'dieses Produkt' : 'diesen Node'} hinzu
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      // Get the FILTERED node IDs from query results, not from stored selections!
                      // The levelQueries contain the already-filtered options based on all other selections.
                      
                      let sourceNodeIds: number[];
                      let sourceCode: string;
                      let sourceLabel: string;
                      
                      // Find the LAST (highest) selected level
                      const selectedLevels = Object.keys(selections).map(Number).sort((a, b) => b - a);
                      
                      if (selectedLevels.length === 0) {
                        // Only family selected
                        if (!selectedFamily?.id) {
                          alert('Keine Node ID verfügbar. Bitte wähle eine Option aus.');
                          return;
                        }
                        sourceNodeIds = [selectedFamily.id];
                        sourceCode = selectedFamily.code || '';
                        sourceLabel = selectedFamily.label || '';
                      } else {
                        // Get the highest level selection
                        const highestLevel = selectedLevels[0];
                        const selectedOption = selections[highestLevel];
                        
                        // Find this option in the QUERY RESULTS to get filtered IDs
                        const queryResult = levelQueries[highestLevel];
                        if (!queryResult?.data) {
                          alert('Query Daten nicht verfügbar. Bitte warte einen Moment und versuche es erneut.');
                          return;
                        }
                        
                        // Find the option that matches the selected code
                        const filteredOption = queryResult.data.find(opt => opt.code === selectedOption.code);
                        if (!filteredOption || !filteredOption.ids || filteredOption.ids.length === 0) {
                          alert('Keine gefilterten Node IDs gefunden. Bitte wähle erneut.');
                          return;
                        }
                        
                        sourceNodeIds = filteredOption.ids;
                        sourceCode = filteredOption.code;
                        sourceLabel = filteredOption.label || filteredOption.code;
                      }
                      
                      setSourceSelectionForSuccessor({
                        nodeIds: sourceNodeIds,
                        code: sourceCode,
                        label: sourceLabel,
                      });
                      
                      setIsSuccessorSelectionMode(true);
                      
                      // Reset current selection to allow user to pick successor
                      setSelections({});
                      setSelectedFamily(null);
                      
                      alert('Wähle jetzt den Nachfolger aus dem Produktbaum!');
                    }}
                    className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-medium"
                  >
                    + Nachfolger hinzufügen
                  </button>
                </div>
              </div>
            )}

            {/* Admin: Successor Selection Mode Active */}
            {user?.role === 'admin' && isSuccessorSelectionMode && sourceSelectionForSuccessor && (
              <div className="mt-4 p-4 bg-blue-50 border-2 border-blue-500 rounded-lg">
                <div className="font-semibold text-blue-900 mb-2">🎯 Nachfolger-Auswahl aktiv</div>
                <div className="text-sm text-blue-700 mb-3">
                  <strong>Quelle:</strong> {sourceSelectionForSuccessor.label} ({sourceSelectionForSuccessor.code})
                </div>
                <div className="text-sm text-blue-700 mb-3">
                  Wähle jetzt den Nachfolger aus dem Produktbaum. Wenn du fertig bist, klicke auf "Verlinkung erstellen".
                </div>
                
                {(selectedFamily || Object.keys(selections).length > 0) && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        // Get FILTERED target node IDs from query results
                        let targetNodeIds: number[];
                        
                        // Find the LAST (highest) selected level
                        const selectedLevels = Object.keys(selections).map(Number).sort((a, b) => b - a);
                        
                        if (selectedLevels.length === 0) {
                          // Only family selected
                          if (!selectedFamily?.id) {
                            alert('Bitte wähle erst einen Nachfolger aus!');
                            return;
                          }
                          targetNodeIds = [selectedFamily.id];
                        } else {
                          // Get the highest level selection
                          const highestLevel = selectedLevels[0];
                          const selectedOption = selections[highestLevel];
                          
                          // Find this option in the QUERY RESULTS to get filtered IDs
                          const queryResult = levelQueries[highestLevel];
                          if (!queryResult?.data) {
                            alert('Query Daten nicht verfügbar. Bitte warte einen Moment und versuche es erneut.');
                            return;
                          }
                          
                          // Find the option that matches the selected code
                          const filteredOption = queryResult.data.find(opt => opt.code === selectedOption.code);
                          if (!filteredOption || !filteredOption.ids || filteredOption.ids.length === 0) {
                            alert('Keine gefilterten Node IDs gefunden. Bitte wähle erneut.');
                            return;
                          }
                          
                          targetNodeIds = filteredOption.ids;
                        }
                        
                        if (!sourceSelectionForSuccessor?.nodeIds || sourceSelectionForSuccessor.nodeIds.length === 0) {
                          alert('Source Node IDs fehlen!');
                          return;
                        }
                        
                        createSuccessorMutation.mutate({
                          source_node_ids: sourceSelectionForSuccessor.nodeIds,
                          target_node_ids: targetNodeIds,
                          migration_note: `Nachfolger von ${sourceSelectionForSuccessor.label}`,
                        });
                      }}
                      disabled={createSuccessorMutation.isPending}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-50"
                    >
                      {createSuccessorMutation.isPending ? 'Wird erstellt...' : '✓ Verlinkung erstellen'}
                    </button>
                    <button
                      onClick={() => {
                        setIsSuccessorSelectionMode(false);
                        setSourceSelectionForSuccessor(null);
                        setSelections({});
                      }}
                      className="px-4 py-2 bg-gray-300 hover:bg-gray-400 text-gray-700 rounded-lg font-medium"
                    >
                      ✕ Abbrechen
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Image Modal for Result */}
      {showResultImageModal && resultImageModalPictures.length > 0 && (
        <ImageModal
          pictures={resultImageModalPictures}
          onClose={() => setShowResultImageModal(false)}
        />
      )}

      {/* Links Modal for Result */}
      {showResultLinksModal && resultLinksModalLinks.length > 0 && (
        <LinksList
          links={resultLinksModalLinks}
          onClose={() => setShowResultLinksModal(false)}
        />
      )}

      {/* Banner Code Detail Modal */}
      {showBannerDetailModal && bannerDetailSelection && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="sticky top-0 bg-gradient-to-r from-green-500 to-green-600 text-white px-6 py-4 flex justify-between items-center rounded-t-lg">
              <div>
                <h2 className="text-xl font-bold">
                  Code Details - Level {bannerDetailSelection.level}
                </h2>
                <div className="font-mono text-2xl font-bold mt-1">
                  {bannerDetailSelection.option.code}
                </div>
              </div>
              <button
                onClick={() => {
                  setShowBannerDetailModal(false);
                  setBannerDetailSelection(null);
                }}
                className="text-white hover:text-gray-200 transition-colors"
                aria-label="Close"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
              {/* Name */}
              {bannerDetailSelection.option.name && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Name</h3>
                  <div className="flex flex-wrap gap-2">
                    {bannerDetailSelection.option.name.split(',').map((name, idx) => (
                      <span
                        key={idx}
                        className="bg-purple-100 text-purple-800 text-sm font-medium px-3 py-1 rounded"
                      >
                        {name.trim()}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Labels */}
              {(bannerDetailSelection.option.label || bannerDetailSelection.option.label_en) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {bannerDetailSelection.option.label && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-700 mb-2">Label (DE)</h3>
                      <div className="bg-gray-50 p-3 rounded whitespace-pre-line text-sm">
                        {bannerDetailSelection.option.label}
                      </div>
                    </div>
                  )}
                  {bannerDetailSelection.option.label_en && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-700 mb-2">Label (EN)</h3>
                      <div className="bg-gray-50 p-3 rounded whitespace-pre-line text-sm">
                        {bannerDetailSelection.option.label_en}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Pictures */}
              {bannerDetailSelection.option.pictures && bannerDetailSelection.option.pictures.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">
                    Bilder ({bannerDetailSelection.option.pictures.length})
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {bannerDetailSelection.option.pictures.map((pic, idx) => (
                      <div
                        key={idx}
                        className="relative aspect-square bg-gray-100 rounded overflow-hidden cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() => {
                          setResultImageModalPictures(bannerDetailSelection.option.pictures || []);
                          setShowResultImageModal(true);
                        }}
                      >
                        <img
                          src={`http://localhost:8000${pic.url}`}
                          alt={pic.description || 'Product image'}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Links */}
              {bannerDetailSelection.option.links && bannerDetailSelection.option.links.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">
                    Links ({bannerDetailSelection.option.links.length})
                  </h3>
                  <div className="space-y-2">
                    {bannerDetailSelection.option.links.map((link, idx) => (
                      <a
                        key={idx}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block p-3 bg-blue-50 hover:bg-blue-100 rounded transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            {link.description && (
                              <div className="font-medium text-blue-900">{link.description}</div>
                            )}
                            <div className="text-sm text-blue-600 truncate">{link.url}</div>
                          </div>
                          <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* No additional data message */}
              {!bannerDetailSelection.option.name && 
               !bannerDetailSelection.option.label && 
               !bannerDetailSelection.option.label_en &&
               (!bannerDetailSelection.option.pictures || bannerDetailSelection.option.pictures.length === 0) &&
               (!bannerDetailSelection.option.links || bannerDetailSelection.option.links.length === 0) && (
                <div className="text-center py-8 text-gray-500">
                  Keine zusätzlichen Informationen verfügbar
                </div>
              )}

              {/* Admin: Delete Node Button */}
              {user?.role === 'admin' && bannerDetailSelection.level > 0 && bannerDetailSelection.option.id && (
                <div className="border-t border-gray-200 pt-6">
                  <button
                    onClick={async () => {
                      const nodeId = bannerDetailSelection.option.id!;
                      const nodeCode = bannerDetailSelection.option.code;
                      const nodeLevel = bannerDetailSelection.level;
                      
                      setDeletingNode({ id: nodeId, code: nodeCode, level: nodeLevel });
                      
                      try {
                        const preview = await previewNodeDeletion(nodeId);
                        setDeleteNodePreview(preview);
                        setShowDeleteNodeModal(true);
                        setShowBannerDetailModal(false); // Close detail modal
                      } catch (error: any) {
                        alert(`❌ Fehler beim Laden der Vorschau: ${error.message}`);
                      }
                    }}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Node löschen (Level {bannerDetailSelection.level})
                  </button>
                  <p className="text-xs text-gray-500 mt-2 text-center">
                    Löscht diesen Node und alle Descendants
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

        </div> {/* Close content container */}

        {/* Modals - outside content container but inside main area */}
        {/* Smart Add Node Modal */}
        {addNodeContext && (
          <SmartAddNodeModal 
            isOpen={isAddNodeModalOpen} 
            onClose={() => {
              setIsAddNodeModalOpen(false);
              setAddNodeContext(null);
            }} 
            familyCode={addNodeContext.familyCode}
            level={addNodeContext.level}
            parentSelections={selections}
          />
        )}
        
        {/* Old Add Node Modal - keeping for backward compatibility */}
        <AddNodeModal isOpen={false} onClose={() => {}} />
        <TypecodeDecoderModal isOpen={isTypecodeModalOpen} onClose={() => setIsTypecodeModalOpen(false)} />

        {/* Change Password Modal */}
        <ChangePasswordModal
          isOpen={showChangePasswordModal}
          onClose={() => setShowChangePasswordModal(false)}
        />

        {/* Create Family Modal */}
        {showCreateFamilyModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-6">Create Product Family</h2>
              
              <form onSubmit={(e) => {
                e.preventDefault();
                if (!familyFormData.code.trim()) {
                  alert('Code ist erforderlich');
                  return;
                }
                createFamilyMutation.mutate(familyFormData);
              }}>
                {/* Code */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Code <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={familyFormData.code}
                    onChange={(e) => setFamilyFormData({ ...familyFormData, code: e.target.value.toUpperCase() })}
                    placeholder="z.B. XYZ"
                    required
                    disabled={createFamilyMutation.isPending}
                    className="w-full px-4 py-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all disabled:bg-gray-100"
                  />
                </div>

                {/* Label (DE) */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Label (Deutsch)
                  </label>
                  <input
                    type="text"
                    value={familyFormData.label || ''}
                    onChange={(e) => setFamilyFormData({ ...familyFormData, label: e.target.value || null })}
                    placeholder="Optional - z.B. Neue Produktlinie"
                    disabled={createFamilyMutation.isPending}
                    className="w-full px-4 py-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all disabled:bg-gray-100"
                  />
                </div>

                {/* Label (EN) */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Label (English)
                  </label>
                  <input
                    type="text"
                    value={familyFormData.label_en || ''}
                    onChange={(e) => setFamilyFormData({ ...familyFormData, label_en: e.target.value || null })}
                    placeholder="z.B. New Product Line"
                    disabled={createFamilyMutation.isPending}
                    className="w-full px-4 py-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all disabled:bg-gray-100"
                  />
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={createFamilyMutation.isPending}
                    className="flex-1 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    {createFamilyMutation.isPending ? 'Creating...' : 'Create Family'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCreateFamilyModal(false)}
                    disabled={createFamilyMutation.isPending}
                    className="px-6 py-2.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium disabled:cursor-not-allowed"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Edit Family Modal */}
        {showEditFamilyModal && editingFamily && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-6">
                Edit Family Labels: <span className="font-mono text-purple-600">{editingFamily.code}</span>
              </h2>
              
              <form onSubmit={(e) => {
                e.preventDefault();
                if (!editFamilyFormData.label.trim()) {
                  alert('Label (Deutsch) ist erforderlich');
                  return;
                }
                updateFamilyMutation.mutate({
                  code: editingFamily.code!,
                  data: editFamilyFormData
                });
              }}>
                {/* Label (DE) */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Label (Deutsch) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={editFamilyFormData.label}
                    onChange={(e) => setEditFamilyFormData({ ...editFamilyFormData, label: e.target.value })}
                    placeholder="z.B. Neue Produktlinie"
                    required
                    disabled={updateFamilyMutation.isPending}
                    className="w-full px-4 py-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all disabled:bg-gray-100"
                    onFocus={(e) => e.target.select()}
                  />
                </div>

                {/* Label (EN) */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Label (English)
                  </label>
                  <input
                    type="text"
                    value={editFamilyFormData.label_en || ''}
                    onChange={(e) => setEditFamilyFormData({ ...editFamilyFormData, label_en: e.target.value || null })}
                    placeholder="z.B. New Product Line"
                    disabled={updateFamilyMutation.isPending}
                    className="w-full px-4 py-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all disabled:bg-gray-100"
                  />
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={updateFamilyMutation.isPending}
                    className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    {updateFamilyMutation.isPending ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowEditFamilyModal(false);
                      setEditingFamily(null);
                    }}
                    disabled={updateFamilyMutation.isPending}
                    className="px-6 py-2.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium disabled:cursor-not-allowed"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Delete Family Confirmation Modal */}
        {showDeleteFamilyModal && deletingFamily && deletePreview && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 bg-red-100 rounded-full">
                  <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">Produktfamilie löschen?</h2>
                  <p className="text-sm text-gray-600">Diese Aktion kann nicht rückgängig gemacht werden!</p>
                </div>
              </div>
              
              {/* Familie Info */}
              <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-mono font-bold text-lg text-red-700">{deletePreview.code}</span>
                  {deletePreview.label && (
                    <span className="text-gray-600">— {deletePreview.label}</span>
                  )}
                </div>
              </div>

              {/* Auswirkungen */}
              <div className="mb-6 space-y-3">
                <h3 className="font-semibold text-gray-900">Folgende Daten werden gelöscht:</h3>
                
                <div className="space-y-2">
                  <div className="flex items-center gap-2 p-3 bg-red-50 rounded-lg border border-red-200">
                    <svg className="w-5 h-5 text-red-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-red-900 font-semibold">
                      {deletePreview.affected_nodes} Nodes (gesamter Produktbaum)
                    </span>
                  </div>

                  {deletePreview.affected_successors > 0 && (
                    <div className="flex items-center gap-2 p-3 bg-orange-50 rounded-lg border border-orange-200">
                      <svg className="w-5 h-5 text-orange-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      <span className="text-orange-900">
                        {deletePreview.affected_successors} Nachfolger-Beziehungen
                      </span>
                    </div>
                  )}

                  {deletePreview.affected_constraints > 0 && (
                    <div className="flex items-center gap-2 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                      <svg className="w-5 h-5 text-yellow-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="text-yellow-900">
                        {deletePreview.affected_constraints} Constraint-Kombinationen
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    if (deletingFamily.code) {
                      deleteFamilyMutation.mutate(deletingFamily.code);
                    }
                  }}
                  disabled={deleteFamilyMutation.isPending}
                  className="flex-1 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-semibold disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  {deleteFamilyMutation.isPending ? 'Wird gelöscht...' : 'Endgültig löschen'}
                </button>
                <button
                  onClick={() => {
                    setShowDeleteFamilyModal(false);
                    setDeletingFamily(null);
                    setDeletePreview(null);
                  }}
                  disabled={deleteFamilyMutation.isPending}
                  className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-semibold disabled:cursor-not-allowed"
                >
                  Abbrechen
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Node Confirmation Modal */}
        {showDeleteNodeModal && deletingNode && deleteNodePreview && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 bg-red-100 rounded-full">
                  <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">Node löschen?</h2>
                  <p className="text-sm text-gray-600">Diese Aktion kann nicht rückgängig gemacht werden!</p>
                </div>
              </div>
              
              {/* Node Info */}
              <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center gap-2 mb-2">
                  <span className="bg-blue-100 text-blue-800 text-sm font-medium px-3 py-1 rounded">
                    Level {deleteNodePreview.level}
                  </span>
                  <span className="font-mono font-bold text-lg text-red-700">{deleteNodePreview.code}</span>
                </div>
                {deleteNodePreview.label && (
                  <div className="text-gray-600 text-sm mt-2">{deleteNodePreview.label}</div>
                )}
                {deleteNodePreview.nodes_with_same_code > 1 && (
                  <div className="mt-3 p-2 bg-yellow-50 border border-yellow-200 rounded">
                    <p className="text-sm text-yellow-800">
                      ⚠️ <strong>{deleteNodePreview.nodes_with_same_code} Nodes</strong> mit Code "{deleteNodePreview.code}" 
                      auf Level {deleteNodePreview.level} werden gelöscht (verschiedene Pfade)
                    </p>
                  </div>
                )}
              </div>

              {/* Auswirkungen */}
              <div className="mb-6 space-y-3">
                <h3 className="font-semibold text-gray-900">Folgende Daten werden gelöscht:</h3>
                
                <div className="space-y-2">
                  <div className="flex items-center gap-2 p-3 bg-red-50 rounded-lg border border-red-200">
                    <svg className="w-5 h-5 text-red-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-red-900 font-semibold">
                      {deleteNodePreview.affected_nodes} Nodes gesamt (alle mit Code "{deleteNodePreview.code}" + Descendants)
                    </span>
                  </div>

                  {deleteNodePreview.affected_successors > 0 && (
                    <div className="flex items-center gap-2 p-3 bg-orange-50 rounded-lg border border-orange-200">
                      <svg className="w-5 h-5 text-orange-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      <span className="text-orange-900">
                        {deleteNodePreview.affected_successors} Nachfolger-Beziehungen
                      </span>
                    </div>
                  )}

                  {deleteNodePreview.affected_constraints > 0 && (
                    <div className="flex items-center gap-2 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                      <svg className="w-5 h-5 text-yellow-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="text-yellow-900">
                        {deleteNodePreview.affected_constraints} Constraint-Kombinationen
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    if (deletingNode.id) {
                      deleteNodeMutation.mutate(deletingNode.id);
                    }
                  }}
                  disabled={deleteNodeMutation.isPending}
                  className="flex-1 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-semibold disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  {deleteNodeMutation.isPending ? 'Wird gelöscht...' : 'Endgültig löschen'}
                </button>
                <button
                  onClick={() => {
                    setShowDeleteNodeModal(false);
                    setDeletingNode(null);
                    setDeleteNodePreview(null);
                  }}
                  disabled={deleteNodeMutation.isPending}
                  className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-semibold disabled:cursor-not-allowed"
                >
                  Abbrechen
                </button>
              </div>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
};

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="App">
        <VariantenbaumConfigurator />
      </div>
    </QueryClientProvider>
  );
}

export default App;
