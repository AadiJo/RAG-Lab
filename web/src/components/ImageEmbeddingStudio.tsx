import { useState, useEffect, useRef } from 'react';
import {
  Image as ImageIcon,
  Save,
  Play,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Settings,
  FileText,
  Plus,
  Trash2,
  FolderOpen,
  ChevronUp,
} from 'lucide-react';
import ConfirmDialog from './ConfirmDialog';
import {
  listImageEmbeddingConfigs,
  getImageEmbeddingConfig,
  saveImageEmbeddingConfig,
  deleteImageEmbeddingConfig,
  listPdfs,
  getPdfImages,
  getImageContext,
  startImageDbBuild,
  getImageDbBuild,
  browseTextDbDirectories,
  getImageFilters,
  type ImageEmbeddingConfig,
  type PdfImage,
  type ModuleManifest,
} from '../lib/api';

export default function ImageEmbeddingStudio() {
  const [configs, setConfigs] = useState<ImageEmbeddingConfig[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [currentConfig, setCurrentConfig] = useState<ImageEmbeddingConfig | null>(null);
  const [pdfs, setPdfs] = useState<Array<{ name: string; path: string }>>([]);
  const [selectedPdfIndex, setSelectedPdfIndex] = useState<number>(0);
  const [images, setImages] = useState<PdfImage[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const [pdfDir, setPdfDir] = useState('data/pdfs');
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(null);
  const [imageContexts, setImageContexts] = useState<Record<string, { context: string; loading: boolean }>>({});
  const [buildJobId, setBuildJobId] = useState<string | null>(null);
  const [buildStatus, setBuildStatus] = useState<any>(null);
  const [isNewConfig, setIsNewConfig] = useState(false);
  const isNewConfigRef = useRef(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; configId: string | null }>({
    isOpen: false,
    configId: null,
  });
  const [showDirPicker, setShowDirPicker] = useState(false);
  const [dirPicker, setDirPicker] = useState<{
    root: string;
    path: string;
    parent: string | null;
    directories: Array<{ name: string; path: string; type?: 'directory' }>;
    files?: Array<{ name: string; path: string; type?: 'file' }>;
    defaultPdfInputDir: string;
  } | null>(null);
  const [dirPickerLoading, setDirPickerLoading] = useState(false);
  const [dirPickerError, setDirPickerError] = useState<string | null>(null);
  const [imageFilters, setImageFilters] = useState<ModuleManifest[]>([]);
  const [excludedImages, setExcludedImages] = useState<Map<string, { reason: string; metadata?: any }>>(new Map());
  const [saveSuccess, setSaveSuccess] = useState(false);

  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const RUNNING_BUILD_STORAGE_KEY = 'rag-lab.runningImageDbBuildId';

  useEffect(() => {
    loadConfigs();
    loadPdfs();
    loadImageFilters();
    
    // Resume polling if a build is in progress
    const storedId = localStorage.getItem(RUNNING_BUILD_STORAGE_KEY);
    if (storedId && !buildJobId) {
      setBuildJobId(storedId);
      // Load initial status
      getImageDbBuild(storedId).then(status => {
        setBuildStatus(status);
        // If already completed/failed, clean up
        if (status.status === 'completed' || status.status === 'failed') {
          localStorage.removeItem(RUNNING_BUILD_STORAGE_KEY);
        }
      }).catch(() => {
        // Build no longer exists, clean up
        localStorage.removeItem(RUNNING_BUILD_STORAGE_KEY);
      });
    }
  }, []);

  useEffect(() => {
    if (selectedConfigId && !isNewConfigRef.current) {
      loadConfig(selectedConfigId);
    } else if (!selectedConfigId) {
      setCurrentConfig(null);
    }
  }, [selectedConfigId]);

  useEffect(() => {
    if (pdfs.length > 0 && selectedPdfIndex >= 0 && selectedPdfIndex < pdfs.length) {
      loadImages(pdfs[selectedPdfIndex].name);
    }
  }, [pdfs, selectedPdfIndex, pdfDir]);

  useEffect(() => {
    // Re-preview excluded images when config changes
    if (images.length > 0 && currentConfig) {
      previewExcludedImages(images);
    }
  }, [currentConfig?.imageFilters]);

  useEffect(() => {
    if (!buildJobId) return;

    const t = setInterval(async () => {
      try {
        const status = await getImageDbBuild(buildJobId);
        setBuildStatus(status);
        if (status.status === 'completed' || status.status === 'failed') {
          clearInterval(t);
          pollInterval.current = null;
          localStorage.removeItem(RUNNING_BUILD_STORAGE_KEY);
        }
      } catch (e) {
        // ignore transient errors
      }
    }, 1000);

    pollInterval.current = t;
    return () => {
      if (pollInterval.current) {
        clearInterval(pollInterval.current);
      }
    };
  }, [buildJobId]);

  const loadConfigs = async () => {
    try {
      const res = await listImageEmbeddingConfigs();
      setConfigs(res.configs);
      if (res.configs.length > 0 && !selectedConfigId && !isNewConfig) {
        setSelectedConfigId(res.configs[0].id);
      }
    } catch (err) {
      console.error('Failed to load configs:', err);
    }
  };

  const loadConfig = async (id: string) => {
    // Don't try to load if we're creating a new config
    if (isNewConfigRef.current) {
      return;
    }
    try {
      const res = await getImageEmbeddingConfig(id);
      setCurrentConfig(res.config);
      setIsNewConfig(false);
      isNewConfigRef.current = false;
    } catch (err) {
      console.error('Failed to load config:', err);
      setCurrentConfig(null);
    }
  };

  const loadPdfs = async (dir?: string) => {
    const targetDir = dir || pdfDir;
    try {
      const res = await listPdfs(targetDir);
      setPdfs(res.pdfs);
      // Only update pdfDir if we successfully loaded from the requested directory
      if (res.directory === targetDir || !dir) {
        setPdfDir(res.directory);
      }
      if (res.pdfs.length > 0) {
        // Reset to first PDF if current index is out of bounds
        if (selectedPdfIndex >= res.pdfs.length) {
          setSelectedPdfIndex(0);
        }
      } else {
        setSelectedPdfIndex(0);
      }
    } catch (err) {
      console.error('Failed to load PDFs:', err);
      setPdfs([]);
    }
  };

  const loadDirPicker = async (path?: string) => {
    setDirPickerLoading(true);
    setDirPickerError(null);
    try {
      const res = await browseTextDbDirectories(path);
      setDirPicker(res);
    } catch (e: any) {
      setDirPickerError(e?.message || 'Failed to browse directories');
    } finally {
      setDirPickerLoading(false);
    }
  };

  const loadImageFilters = async () => {
    try {
      const res = await getImageFilters();
      setImageFilters(res.imageFilters || []);
    } catch (err) {
      console.error('Failed to load image filters:', err);
      setImageFilters([]);
    }
  };

  const loadImages = async (filename: string) => {
    setLoadingImages(true);
    setSelectedImageIndex(null);
    setImageContexts({});
    setExcludedImages(new Set());
    try {
      const res = await getPdfImages(filename, pdfDir);
      setImages(res.images);
      // Preview excluded images based on current config
      if (currentConfig && currentConfig.imageFilters) {
        previewExcludedImages(res.images);
      }
    } catch (err) {
      console.error('Failed to load images:', err);
      setImages([]);
    } finally {
      setLoadingImages(false);
    }
  };

  const previewExcludedImages = (imageList: PdfImage[]) => {
    // Simple client-side preview based on basic heuristics
    // Actual filtering happens server-side during build
    const excluded = new Map<string, { reason: string; metadata?: any }>();
    if (!currentConfig?.imageFilters) {
      setExcludedImages(excluded);
      return;
    }
    
    const enabledFilters = Object.entries(currentConfig.imageFilters).filter(
      ([_, config]) => config.enabled
    );
    
    if (enabledFilters.length === 0) {
      setExcludedImages(excluded);
      return;
    }
    
    // Basic preview: check for FRC filter and apply simple size checks
    for (const img of imageList) {
      const key = `${img.page}-${img.index}`;
      
      for (const [filterId, filterConfig] of enabledFilters) {
        if (filterId === 'frc-image-filter') {
          const config = filterConfig.config || {};
          const minWidth = config.min_width || 100;
          const minHeight = config.min_height || 100;
          const minArea = config.min_area || 10000;
          const excludeSmall = config.exclude_small !== false;
          const excludeLogos = config.exclude_logos !== false;
          const requireContext = config.require_context !== false;
          
          const reasons: string[] = [];
          const metadata: any = {};
          
          if (excludeSmall) {
            if (img.width < minWidth) {
              reasons.push(`Width too small (${img.width} < ${minWidth}px)`);
              metadata.size_issue = 'width_too_small';
            }
            if (img.height < minHeight) {
              reasons.push(`Height too small (${img.height} < ${minHeight}px)`);
              metadata.size_issue = 'height_too_small';
            }
            if ((img.width * img.height) < minArea) {
              reasons.push(`Area too small (${img.width * img.height} < ${minArea}px²)`);
              metadata.size_issue = 'area_too_small';
            }
          }
          
          // Simple logo detection based on size and position
          if (excludeLogos) {
            const isSmall = img.width < 300 && img.height < 300;
            const bbox = img.bbox;
            if (bbox) {
              const isInHeader = bbox.y0 < 100;
              if (isSmall && isInHeader) {
                reasons.push('Likely logo (small image in header)');
                metadata.logo_detected = true;
              }
            }
          }
          
          if (reasons.length > 0) {
            excluded.set(key, {
              reason: reasons.join('; '),
              metadata: { ...metadata, filter_id: filterId },
            });
            break;
          }
        }
      }
    }
    
    setExcludedImages(excluded);
  };

  const loadImageContext = async (image: PdfImage) => {
    if (!currentConfig || !currentPdf) return;
    
    const key = `${image.page}-${image.index}`;
    if (imageContexts[key]) return; // Already loaded
    
    setImageContexts(prev => ({ ...prev, [key]: { context: '', loading: true } }));
    
    try {
      const res = await getImageContext(
        currentPdf.name,
        image.page,
        image.index,
        currentConfig.id,
        pdfDir
      );
      setImageContexts(prev => ({
        ...prev,
        [key]: { context: res.context, loading: false },
      }));
    } catch (err) {
      console.error('Failed to load image context:', err);
      setImageContexts(prev => ({
        ...prev,
        [key]: { context: '', loading: false },
      }));
    }
  };

  const handleSaveConfig = async () => {
    if (!currentConfig) return;
    try {
      const saved = await saveImageEmbeddingConfig(currentConfig);
      isNewConfigRef.current = false;
      setIsNewConfig(false);
      setCurrentConfig(saved.config);
      setSelectedConfigId(saved.config.id);
      await loadConfigs();
      
      // Show success notification
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      
      // Re-preview excluded images with new config
      if (images.length > 0) {
        previewExcludedImages(images);
      }
    } catch (err) {
      console.error('Failed to save config:', err);
      alert('Failed to save configuration. Please try again.');
    }
  };

  const handleDeleteConfig = (id: string) => {
    setDeleteConfirm({ isOpen: true, configId: id });
  };

  const confirmDeleteConfig = async () => {
    if (!deleteConfirm.configId) return;
    try {
      await deleteImageEmbeddingConfig(deleteConfirm.configId);
      await loadConfigs();
      if (selectedConfigId === deleteConfirm.configId) {
        setSelectedConfigId(null);
      }
      setDeleteConfirm({ isOpen: false, configId: null });
    } catch (err) {
      console.error('Failed to delete config:', err);
      setDeleteConfirm({ isOpen: false, configId: null });
    }
  };

  const handleCreateNewConfig = () => {
    const newConfig: ImageEmbeddingConfig = {
      id: `config_${Date.now().toString(36)}`,
      name: 'New Config',
      description: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      embeddingModel: 'clip',
      includeContext: true,
      contextSource: 'both',
      contextChars: 500,
      enableOCR: false,
      enableCaptioning: false,
    };
    // Set ref first to prevent useEffect from trying to load it
    isNewConfigRef.current = true;
    setIsNewConfig(true);
    // Then set the config and selected ID
    setCurrentConfig(newConfig);
    setSelectedConfigId(newConfig.id);
  };

  const handleStartBuild = async () => {
    if (!selectedConfigId) {
      alert('Please select a configuration first');
      return;
    }
    try {
      const res = await startImageDbBuild({
        name: `imgdb_${Date.now().toString(36)}`,
        inputDir: pdfDir,
        configId: selectedConfigId,
        setActive: true,
      });
      setBuildJobId(res.id);
      localStorage.setItem(RUNNING_BUILD_STORAGE_KEY, res.id);
      setBuildStatus({ status: 'running', progress: { current: 0, total: 0 } });
    } catch (err) {
      console.error('Failed to start build:', err);
    }
  };

  const getProgressPercent = () => {
    if (!buildStatus?.progress) return 0;
    const { current, total } = buildStatus.progress;
    if (total === 0) return 0;
    return Math.round((current / total) * 100);
  };

  const currentPdf = pdfs[selectedPdfIndex];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent mb-4">
            Image Embedding Studio
          </h1>
          <p className="text-zinc-500 max-w-2xl">
            Configure how images from PDFs are embedded with customizable context extraction, 
            OCR, captioning, and model selection.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCreateNewConfig}
            className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition-colors flex items-center gap-2"
          >
            <Plus size={16} />
            New Config
          </button>
          <button
            onClick={handleStartBuild}
            disabled={!selectedConfigId || (buildJobId !== null && buildStatus?.status === 'running')}
            className="px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white font-semibold shadow-lg shadow-indigo-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Play size={20} />
            Build Database
          </button>
        </div>
      </div>

      {/* Config Selector */}
      <div className="glass-panel rounded-2xl p-4">
        <div className="flex items-center gap-4">
          <label className="text-sm text-zinc-300 font-medium">Configuration:</label>
          <select
            value={selectedConfigId || ''}
            onChange={(e) => setSelectedConfigId(e.target.value || null)}
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
          >
            <option value="">Select a configuration...</option>
            {configs.map((config) => (
              <option key={config.id} value={config.id}>
                {config.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[calc(100vh-16rem)]">
        {/* Left: PDF Browser */}
        <div className="glass-panel rounded-2xl p-6 flex flex-col space-y-4 min-h-0 overflow-hidden h-full">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <FileText size={20} />
              PDF Browser
            </h2>
          </div>

          {/* Directory Selector */}
          <div className="space-y-2">
            <label className="text-sm text-zinc-300 font-medium">PDF Directory:</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={pdfDir}
                onChange={(e) => setPdfDir(e.target.value)}
                onBlur={() => loadPdfs()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    loadPdfs();
                  }
                }}
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm"
                placeholder="data/pdfs"
              />
              <button
                type="button"
                onClick={async () => {
                  setShowDirPicker(true);
                  await loadDirPicker(pdfDir || '');
                }}
                className="px-3 py-2 rounded-lg bg-zinc-900/50 border border-zinc-800 hover:border-zinc-700 text-zinc-200 transition-colors flex items-center gap-2"
                title="Browse folders on the server filesystem"
              >
                <FolderOpen size={16} />
                Browse
              </button>
            </div>
            <p className="text-xs text-zinc-500">
              {pdfs.length} PDF{pdfs.length !== 1 ? 's' : ''} found
            </p>
          </div>

          {/* PDF List */}
          {pdfs.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-zinc-300">Select PDF:</h3>
              <div className="max-h-48 overflow-auto space-y-1 border border-zinc-800 rounded-lg p-2 bg-zinc-950/50">
                {pdfs.map((pdf, idx) => (
                  <button
                    key={pdf.path}
                    onClick={() => setSelectedPdfIndex(idx)}
                    className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                      selectedPdfIndex === idx
                        ? 'bg-indigo-500/20 border border-indigo-500/30 text-indigo-200'
                        : 'bg-zinc-900/30 border border-zinc-800 hover:border-zinc-700 text-zinc-200 hover:bg-zinc-900/50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <FileText size={16} className="flex-shrink-0" />
                      <span className="text-sm font-medium truncate">{pdf.name}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-sm text-zinc-500 text-center py-8 border border-zinc-800 rounded-lg bg-zinc-950/50">
              No PDFs found in this directory
            </div>
          )}

          {/* Current PDF Info */}
          {pdfs.length > 0 && currentPdf && (
            <div className="p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
              <div className="text-xs text-zinc-400 mb-1">Currently Viewing</div>
              <div className="text-sm font-medium text-indigo-200">{currentPdf.name}</div>
              <div className="text-xs text-zinc-500 mt-1">
                {selectedPdfIndex + 1} of {pdfs.length}
              </div>
            </div>
          )}

          {/* Images List */}
          <div className="space-y-2 flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between flex-shrink-0">
              <h3 className="text-sm font-medium text-zinc-300">Images in PDF</h3>
              {excludedImages.size > 0 && (
                <span className="text-xs text-amber-400 font-medium">
                  {excludedImages.size} excluded
                </span>
              )}
            </div>
            {loadingImages ? (
              <div className="flex items-center justify-center py-8 flex-shrink-0">
                <Loader2 size={24} className="animate-spin text-indigo-400" />
              </div>
            ) : images.length === 0 ? (
              <div className="text-sm text-zinc-500 text-center py-8 flex-shrink-0">
                No images found in this PDF
              </div>
            ) : (
              <div className="space-y-2 flex-1 overflow-auto min-h-0">
                {/* Included Images */}
                {images
                  .filter((img) => {
                    const key = `${img.page}-${img.index}`;
                    return !excludedImages.has(key);
                  })
                  .map((img, idx) => {
                    const originalIdx = images.indexOf(img);
                    const key = `${img.page}-${img.index}`;
                    const contextData = imageContexts[key];
                    const isSelected = selectedImageIndex === originalIdx;
                    const hasBase64 = img.base64 && img.base64.length > 0;
                    
                    return (
                      <div
                        key={key}
                        className={`p-3 rounded-lg border transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-indigo-500/20 border-indigo-500/50'
                            : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700'
                        }`}
                        onClick={() => {
                          setSelectedImageIndex(isSelected ? null : originalIdx);
                          if (!contextData && currentConfig) {
                            loadImageContext(img);
                          }
                        }}
                      >
                        <div className="flex items-start gap-3">
                          {hasBase64 ? (
                            <img
                              src={`data:image/${img.format};base64,${img.base64}`}
                              alt={`Image ${originalIdx + 1}`}
                              className="w-20 h-20 rounded bg-zinc-800 object-contain flex-shrink-0 border border-zinc-700"
                            />
                          ) : (
                            <div className="w-20 h-20 rounded bg-zinc-800 flex items-center justify-center flex-shrink-0 border border-zinc-700">
                              <ImageIcon size={24} className="text-zinc-500" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-zinc-200">
                              Image {originalIdx + 1}
                            </div>
                            <div className="text-xs text-zinc-500 mt-1">
                              Page {img.page} • {img.width}×{img.height}px • {img.format.toUpperCase()}
                            </div>
                            {img.bbox && (
                              <div className="text-xs text-zinc-600 mt-1">
                                Position: ({Math.round(img.bbox.x0)}, {Math.round(img.bbox.y0)}) - ({Math.round(img.bbox.x1)}, {Math.round(img.bbox.y1)})
                              </div>
                            )}
                          </div>
                        </div>
                        
                        {/* Context Preview */}
                        {isSelected && currentConfig && (
                          <div className="mt-3 pt-3 border-t border-zinc-700 space-y-3">
                            {/* Image Content Preview */}
                            <div>
                              <div className="text-xs font-medium text-zinc-400 mb-2">
                                Image Content
                              </div>
                              {hasBase64 ? (
                                <div className="bg-zinc-950 rounded p-2 border border-zinc-800">
                                  <img
                                    src={`data:image/${img.format};base64,${img.base64}`}
                                    alt={`Image ${originalIdx + 1}`}
                                    className="max-w-full max-h-48 rounded object-contain mx-auto"
                                  />
                                </div>
                              ) : (
                                <div className="text-xs text-zinc-500 italic">
                                  Image preview not available
                                </div>
                              )}
                            </div>
                            
                            {/* Surrounding Context */}
                            <div>
                              <div className="text-xs font-medium text-zinc-400 mb-2">
                                Surrounding Context ({currentConfig.contextSource})
                              </div>
                              {contextData?.loading ? (
                                <div className="flex items-center gap-2 text-xs text-zinc-500">
                                  <Loader2 size={12} className="animate-spin" />
                                  Loading context...
                                </div>
                              ) : contextData?.context ? (
                                <div className="text-xs text-zinc-400 bg-zinc-950 rounded p-2 max-h-32 overflow-auto border border-zinc-800">
                                  {contextData.context || '(No context available)'}
                                </div>
                              ) : currentConfig.includeContext ? (
                                <div className="text-xs text-zinc-500 italic">
                                  Click to load context preview
                                </div>
                              ) : (
                                <div className="text-xs text-zinc-500 italic">
                                  Context extraction disabled in config
                                </div>
                              )}
                            </div>
                            
                            {/* OCR/Captioning Info */}
                            {(currentConfig.enableOCR || currentConfig.enableCaptioning) && (
                              <div className="text-xs text-zinc-600 italic">
                                {currentConfig.enableOCR && 'OCR enabled • '}
                                {currentConfig.enableCaptioning && 'Captioning enabled'}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                
                {/* Excluded Images Section */}
                {excludedImages.size > 0 && (
                  <div className="mt-4 pt-4 border-t border-amber-500/30">
                    <h4 className="text-xs font-semibold text-amber-400 mb-3 flex items-center gap-2">
                      <AlertCircle size={14} />
                      Excluded Images ({excludedImages.size})
                    </h4>
                    <div className="space-y-2 max-h-64 overflow-auto">
                      {images
                        .filter((img) => {
                          const key = `${img.page}-${img.index}`;
                          return excludedImages.has(key);
                        })
                        .map((img) => {
                          const originalIdx = images.indexOf(img);
                          const key = `${img.page}-${img.index}`;
                          const exclusionInfo = excludedImages.get(key);
                          const hasBase64 = img.base64 && img.base64.length > 0;
                          
                          return (
                            <div
                              key={key}
                              className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/5"
                            >
                              <div className="flex items-start gap-3">
                                {hasBase64 ? (
                                  <img
                                    src={`data:image/${img.format};base64,${img.base64}`}
                                    alt={`Image ${originalIdx + 1}`}
                                    className="w-20 h-20 rounded bg-zinc-800 object-contain flex-shrink-0 border border-zinc-700"
                                  />
                                ) : (
                                  <div className="w-20 h-20 rounded bg-zinc-800 flex items-center justify-center flex-shrink-0 border border-zinc-700">
                                    <ImageIcon size={20} className="text-zinc-600" />
                                  </div>
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-medium text-amber-300 mb-1">
                                    Image {originalIdx + 1} (Excluded)
                                  </div>
                                  <div className="text-xs text-zinc-400 mt-1">
                                    Page {img.page} • {img.width}×{img.height}px • {img.format.toUpperCase()}
                                  </div>
                                  {exclusionInfo && (
                                    <div className="mt-2 p-2 bg-zinc-950/50 rounded border border-zinc-800">
                                      <div className="text-xs font-medium text-amber-400 mb-1">
                                        Exclusion Reason:
                                      </div>
                                      <div className="text-xs text-zinc-500">
                                        {exclusionInfo.reason}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: Configuration Editor */}
        <div className="glass-panel rounded-2xl p-6 flex flex-col min-h-0 overflow-hidden h-full">
          <h2 className="text-xl font-semibold text-white flex items-center gap-2 flex-shrink-0 mb-4">
            <Settings size={20} />
            Configuration
          </h2>

          {currentConfig ? (
            <div className="space-y-4 flex-1 overflow-y-auto min-h-0 pr-2">
              <div>
                <label className="text-sm text-zinc-300">Name</label>
                <input
                  type="text"
                  value={currentConfig.name}
                  onChange={(e) => setCurrentConfig({ ...currentConfig, name: e.target.value })}
                  className="w-full mt-1 bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
              </div>

              <div>
                <label className="text-sm text-zinc-300">Description</label>
                <textarea
                  value={currentConfig.description || ''}
                  onChange={(e) => setCurrentConfig({ ...currentConfig, description: e.target.value })}
                  className="w-full mt-1 bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                  rows={2}
                />
              </div>

              <div>
                <label className="text-sm text-zinc-300">Embedding Model</label>
                <select
                  value={currentConfig.embeddingModel}
                  onChange={(e) => setCurrentConfig({ ...currentConfig, embeddingModel: e.target.value as any })}
                  className="w-full mt-1 bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                >
                  <option value="clip">CLIP (Contrastive Language-Image Pre-training)</option>
                  <option value="blip">BLIP (Bootstrapping Language-Image Pre-training)</option>
                  <option value="custom">Custom Model</option>
                </select>
              </div>

              {currentConfig.embeddingModel === 'custom' && (
                <div>
                  <label className="text-sm text-zinc-300">Custom Model Name</label>
                  <input
                    type="text"
                    value={currentConfig.customModelName || ''}
                    onChange={(e) => setCurrentConfig({ ...currentConfig, customModelName: e.target.value })}
                    className="w-full mt-1 bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                    placeholder="e.g., openai/clip-vit-base-patch32"
                  />
                </div>
              )}

              <div className="flex items-center gap-3 bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2">
                <input
                  type="checkbox"
                  checked={currentConfig.includeContext}
                  onChange={(e) => setCurrentConfig({ ...currentConfig, includeContext: e.target.checked })}
                  className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-indigo-500 focus:ring-indigo-500/30"
                />
                <span className="text-sm text-zinc-300">Include Surrounding Context</span>
              </div>

              {currentConfig.includeContext && (
                <>
                  <div>
                    <label className="text-sm text-zinc-300">Context Source</label>
                    <select
                      value={currentConfig.contextSource}
                      onChange={(e) => setCurrentConfig({ ...currentConfig, contextSource: e.target.value as any })}
                      className="w-full mt-1 bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                    >
                      <option value="before">Before Image</option>
                      <option value="after">After Image</option>
                      <option value="both">Both (Before & After)</option>
                      <option value="page">Entire Page</option>
                      <option value="none">None</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-sm text-zinc-300">Context Characters</label>
                    <input
                      type="number"
                      value={currentConfig.contextChars}
                      onChange={(e) => setCurrentConfig({ ...currentConfig, contextChars: parseInt(e.target.value || '0', 10) })}
                      className="w-full mt-1 bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                      min={0}
                    />
                  </div>
                </>
              )}

              <div className="flex items-center gap-3 bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2">
                <input
                  type="checkbox"
                  checked={currentConfig.enableOCR}
                  onChange={(e) => setCurrentConfig({ ...currentConfig, enableOCR: e.target.checked })}
                  className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-indigo-500 focus:ring-indigo-500/30"
                />
                <span className="text-sm text-zinc-300">Enable OCR (Optical Character Recognition)</span>
              </div>

              {currentConfig.enableOCR && (
                <div>
                  <label className="text-sm text-zinc-300">OCR Model</label>
                  <input
                    type="text"
                    value={currentConfig.ocrModel || ''}
                    onChange={(e) => setCurrentConfig({ ...currentConfig, ocrModel: e.target.value })}
                    className="w-full mt-1 bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                    placeholder="e.g., tesseract, easyocr"
                  />
                </div>
              )}

              <div className="flex items-center gap-3 bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2">
                <input
                  type="checkbox"
                  checked={currentConfig.enableCaptioning}
                  onChange={(e) => setCurrentConfig({ ...currentConfig, enableCaptioning: e.target.checked })}
                  className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-indigo-500 focus:ring-indigo-500/30"
                />
                <span className="text-sm text-zinc-300">Enable Image Captioning</span>
              </div>

              {currentConfig.enableCaptioning && (
                <div>
                  <label className="text-sm text-zinc-300">Captioning Model</label>
                  <input
                    type="text"
                    value={currentConfig.captioningModel || ''}
                    onChange={(e) => setCurrentConfig({ ...currentConfig, captioningModel: e.target.value })}
                    className="w-full mt-1 bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                    placeholder="e.g., blip-image-captioning-base"
                  />
                </div>
              )}

              {/* Image Filters Section */}
              <div className="pt-4 border-t border-zinc-800">
                <h3 className="text-sm font-semibold text-zinc-200 mb-3">Image Filters</h3>
                <p className="text-xs text-zinc-500 mb-3">
                  Configure filters to exclude irrelevant images (logos, small images, etc.) from the database.
                </p>
                {imageFilters.length === 0 ? (
                  <div className="text-xs text-zinc-500 italic py-2">
                    No image filters available. Add filter modules to the modules/ directory.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {imageFilters.map((filter) => {
                      const filterConfig = currentConfig.imageFilters?.[filter.id] || { enabled: false, config: {} };
                      const isEnabled = filterConfig.enabled;
                      
                      return (
                        <div key={filter.id} className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
                          <div className="flex items-center gap-3 mb-2">
                            <input
                              type="checkbox"
                              checked={isEnabled}
                              onChange={(e) => {
                                const newFilters = {
                                  ...(currentConfig.imageFilters || {}),
                                  [filter.id]: {
                                    ...filterConfig,
                                    enabled: e.target.checked,
                                  },
                                };
                                setCurrentConfig({
                                  ...currentConfig,
                                  imageFilters: newFilters,
                                });
                              }}
                              className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-indigo-500 focus:ring-indigo-500/30"
                            />
                            <div className="flex-1">
                              <div className="text-sm font-medium text-zinc-200">{filter.name}</div>
                              <div className="text-xs text-zinc-500">{filter.description}</div>
                            </div>
                          </div>
                          
                          {isEnabled && filter.configSchema && filter.configSchema.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-zinc-800 space-y-2">
                              {filter.configSchema.map((schemaItem) => {
                                const value = filterConfig.config?.[schemaItem.key] ?? schemaItem.default;
                                
                                return (
                                  <div key={schemaItem.key}>
                                    <label className="text-xs text-zinc-400">{schemaItem.label}</label>
                                    {schemaItem.type === 'boolean' ? (
                                      <div className="flex items-center gap-2 mt-1">
                                        <input
                                          type="checkbox"
                                          checked={Boolean(value)}
                                          onChange={(e) => {
                                            const newFilters = {
                                              ...(currentConfig.imageFilters || {}),
                                              [filter.id]: {
                                                ...filterConfig,
                                                config: {
                                                  ...(filterConfig.config || {}),
                                                  [schemaItem.key]: e.target.checked,
                                                },
                                              },
                                            };
                                            setCurrentConfig({
                                              ...currentConfig,
                                              imageFilters: newFilters,
                                            });
                                          }}
                                          className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-indigo-500 focus:ring-indigo-500/30"
                                        />
                                        <span className="text-xs text-zinc-500">{schemaItem.description}</span>
                                      </div>
                                    ) : schemaItem.type === 'number' ? (
                                      <input
                                        type="number"
                                        value={value ?? ''}
                                        onChange={(e) => {
                                          const numValue = e.target.value ? Number(e.target.value) : undefined;
                                          const newFilters = {
                                            ...(currentConfig.imageFilters || {}),
                                            [filter.id]: {
                                              ...filterConfig,
                                              config: {
                                                ...(filterConfig.config || {}),
                                                [schemaItem.key]: numValue,
                                              },
                                            },
                                          };
                                          setCurrentConfig({
                                            ...currentConfig,
                                            imageFilters: newFilters,
                                          });
                                        }}
                                        className="w-full mt-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                                        min={schemaItem.min}
                                        max={schemaItem.max}
                                        placeholder={schemaItem.default?.toString()}
                                      />
                                    ) : (
                                      <input
                                        type="text"
                                        value={value ?? ''}
                                        onChange={(e) => {
                                          const newFilters = {
                                            ...(currentConfig.imageFilters || {}),
                                            [filter.id]: {
                                              ...filterConfig,
                                              config: {
                                                ...(filterConfig.config || {}),
                                                [schemaItem.key]: e.target.value,
                                              },
                                            },
                                          };
                                          setCurrentConfig({
                                            ...currentConfig,
                                            imageFilters: newFilters,
                                          });
                                        }}
                                        className="w-full mt-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                                        placeholder={schemaItem.default?.toString()}
                                      />
                                    )}
                                    {schemaItem.description && (
                                      <div className="text-xs text-zinc-600 mt-0.5">{schemaItem.description}</div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-4 pt-4 border-t border-zinc-800">
                <button
                  onClick={handleSaveConfig}
                  className={`flex-1 px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white font-semibold transition-all flex items-center justify-center gap-2 ${
                    saveSuccess ? 'ring-2 ring-emerald-500' : ''
                  }`}
                >
                  {saveSuccess ? (
                    <>
                      <CheckCircle2 size={16} />
                      Saved!
                    </>
                  ) : (
                    <>
                      <Save size={16} />
                      Save Configuration
                    </>
                  )}
                </button>
                {!isNewConfig && selectedConfigId && (
                  <button
                    onClick={() => handleDeleteConfig(selectedConfigId)}
                    className="px-4 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 transition-colors flex items-center gap-2"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto min-h-0">
              <div className="text-center py-12 text-zinc-500">
                Select or create a configuration to get started
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Build Status */}
      {buildJobId && buildStatus && (
        <div className="glass-panel rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              {buildStatus.status === 'running' && <Loader2 size={20} className="animate-spin text-indigo-400" />}
              {buildStatus.status === 'completed' && <CheckCircle2 size={20} className="text-emerald-400" />}
              {buildStatus.status === 'failed' && <AlertCircle size={20} className="text-red-400" />}
              Build Status: {buildStatus.status}
            </h3>
            <span className="text-xs font-mono text-zinc-500">{buildJobId}</span>
          </div>

          {buildStatus.status === 'running' && buildStatus.progress && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-400">Progress</span>
                <span className="text-zinc-300 font-medium">
                  {buildStatus.progress.current} / {buildStatus.progress.total} PDFs
                </span>
              </div>
              <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 to-blue-500 rounded-full transition-all duration-300 relative overflow-hidden"
                  style={{ width: `${getProgressPercent()}%` }}
                >
                  <div className="absolute inset-0 bg-white/20 w-full animate-[shimmer_2s_infinite]" />
                </div>
              </div>
              {buildStatus.progress.currentPdf && (
                <p className="text-xs text-zinc-500">Processing: {buildStatus.progress.currentPdf}</p>
              )}
            </div>
          )}

          {buildStatus.status === 'completed' && (
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-sm text-emerald-400">
              Database build completed successfully!
            </div>
          )}

          {buildStatus.status === 'failed' && buildStatus.error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
              {buildStatus.error}
            </div>
          )}

          {buildStatus.logs && (
            <details className="mt-4">
              <summary className="text-sm text-zinc-400 cursor-pointer hover:text-zinc-300 mb-2">View Logs</summary>
              <pre className="max-h-60 overflow-auto bg-black/30 border border-zinc-800 rounded-lg p-4 text-xs text-zinc-400 whitespace-pre-wrap">
                {buildStatus.logs}
              </pre>
            </details>
          )}
        </div>
      )}

      {/* Directory Picker Modal */}
      {showDirPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="glass-panel rounded-2xl w-full max-w-2xl border border-zinc-800 overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white">Select PDF Directory</div>
                <div className="text-xs text-zinc-500 truncate">
                  Browsing: <span className="font-mono">{dirPicker?.path || '...'}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDirPicker(false)}
                className="px-3 py-1.5 text-xs rounded-lg bg-zinc-900/50 border border-zinc-800 hover:border-zinc-700 text-zinc-200 transition-colors"
              >
                Close
              </button>
            </div>

            <div className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!dirPicker?.parent || dirPickerLoading}
                  onClick={async () => {
                    if (dirPicker?.parent) await loadDirPicker(dirPicker.parent);
                  }}
                  className="px-3 py-2 rounded-lg bg-zinc-900/50 border border-zinc-800 hover:border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-200 transition-colors flex items-center gap-2"
                  title="Go up one folder"
                >
                  <ChevronUp size={16} />
                  Up
                </button>
                <div className="text-xs text-zinc-500">
                  Start: <span className="font-mono">{dirPicker?.root || '.'}</span>
                </div>
              </div>

              {dirPickerError && (
                <div className="p-3 rounded-lg border border-red-500/20 bg-red-500/10 text-sm text-red-300">
                  {dirPickerError}
                </div>
              )}

              <div className="max-h-72 overflow-auto rounded-lg border border-zinc-800 bg-black/20">
                {dirPickerLoading && (
                  <div className="p-4 text-sm text-zinc-400 flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin text-indigo-400" />
                    Loading folders…
                  </div>
                )}
                {!dirPickerLoading &&
                  (dirPicker?.directories?.length || 0) === 0 &&
                  (dirPicker?.files?.length || 0) === 0 && (
                    <div className="p-4 text-sm text-zinc-500">Empty directory.</div>
                  )}
                {!dirPickerLoading && (
                  <div className="divide-y divide-zinc-800">
                    {dirPicker?.directories?.map((d) => (
                      <button
                        key={d.path}
                        type="button"
                        onClick={async () => {
                          await loadDirPicker(d.path);
                        }}
                        className="w-full text-left px-4 py-3 hover:bg-zinc-900/40 transition-colors flex items-center gap-2"
                      >
                        <FolderOpen size={16} className="text-zinc-400" />
                        <span className="text-sm text-zinc-200">{d.name}</span>
                        <span className="ml-auto text-xs font-mono text-zinc-500 truncate max-w-[50%]">
                          {d.path}
                        </span>
                      </button>
                    ))}
                    {dirPicker?.files?.map((f) => (
                      <div
                        key={f.path}
                        className="px-4 py-3 flex items-center gap-2 opacity-80"
                      >
                        <FileText size={16} className="text-zinc-500" />
                        <span className="text-sm text-zinc-400">{f.name}</span>
                        <span className="ml-auto text-xs font-mono text-zinc-600 truncate max-w-[50%]">
                          {f.path}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 pt-2">
                <div className="text-xs text-zinc-500">
                  Selecting sets the PDF directory relative to the project root.
                </div>
                <button
                  type="button"
                  disabled={!dirPicker?.path || dirPickerLoading}
                  onClick={async () => {
                    if (dirPicker?.path) {
                      setPdfDir(dirPicker.path);
                      await loadPdfs(dirPicker.path);
                    }
                    setShowDirPicker(false);
                  }}
                  className="px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white font-semibold shadow-lg shadow-indigo-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Use This Folder
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        title="Delete Configuration"
        message="Are you sure you want to delete this configuration? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={confirmDeleteConfig}
        onCancel={() => setDeleteConfirm({ isOpen: false, configId: null })}
      />
    </div>
  );
}

