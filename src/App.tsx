import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Upload, Box, Eye, Move, ArrowLeft, Search, Hand, Plus, PersonStanding, FolderOpen, Download, Camera } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { FloorPlanData } from './services/geminiService';
import { WorkflowStep, WorkflowStepper } from './components/WorkflowStepper';

const Scene3D = lazy(async () => {
  const module = await import('./components/Scene3D');
  return { default: module.Scene3D };
});

const ManualTracer = lazy(async () => {
  const module = await import('./components/ManualTracer');
  return { default: module.ManualTracer };
});

type AppState = 'upload' | 'editor';

interface PlanitiesProjectFile {
  formatVersion: 1;
  appVersion: string;
  exportedAt: string;
  workflowStep: 'trace' | 'scale';
  isScaleCalibrated: boolean;
  previewUrl: string | null;
  project: FloorPlanData;
}

const ScreenLoader = ({ label }: { label: string }) => (
  <div className="flex-1 flex items-center justify-center p-6">
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="w-10 h-10 rounded-full border-2 border-[#141414]/20 border-t-[#141414] animate-spin" />
      <p className="text-sm font-mono uppercase tracking-[0.2em] opacity-50">{label}</p>
    </div>
  </div>
);

export default function App() {
  const [state, setState] = useState<AppState>('upload');
  const [data, setData] = useState<FloorPlanData | null>(null);
  const [editorDraft, setEditorDraft] = useState<FloorPlanData | null>(null);
  const [editorInstance, setEditorInstance] = useState(0);
  const [viewMode, setViewMode] = useState<'orbit' | 'first-person' | 'third-person'>('orbit');
  const [sceneInstance, setSceneInstance] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPreparing3D, setIsPreparing3D] = useState(false);
  const [isSceneReady, setIsSceneReady] = useState(false);
  const [capture3D, setCapture3D] = useState<(() => string | null) | null>(null);
  const [screenshotMessage, setScreenshotMessage] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<WorkflowStep>('trace');
  const [isScaleCalibrated, setIsScaleCalibrated] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const hasBackground = Boolean(previewUrl);
  const projectForExport = editorDraft ?? data;
  const hasProjectContent = useMemo(
    () => Boolean(projectForExport && (projectForExport.walls.length > 0 || projectForExport.openings.length > 0)),
    [projectForExport],
  );

  const resetProject = useCallback(() => {
    setState('upload');
    setData(null);
    setEditorDraft(null);
    setEditorInstance((value) => value + 1);
    setSceneInstance(0);
    setPreviewUrl(null);
    setCurrentStep('trace');
    setIsScaleCalibrated(false);
    setViewMode('orbit');
    setIsPreparing3D(false);
    setIsSceneReady(false);
  }, []);

  const openEditor = useCallback((nextPreviewUrl: string | null) => {
    const startsFromTrace = Boolean(nextPreviewUrl);
    setPreviewUrl(nextPreviewUrl);
    setData(null);
    setEditorDraft(null);
    setEditorInstance((value) => value + 1);
    setCurrentStep(startsFromTrace ? 'trace' : 'scale');
    setIsScaleCalibrated(!startsFromTrace);
    setViewMode('orbit');
    setIsPreparing3D(false);
    setIsSceneReady(false);
    setState('editor');
  }, []);

  const cloneProjectData = useCallback((project: FloorPlanData): FloorPlanData => ({
    walls: project.walls.map((wall) => ({
      ...wall,
      start: { ...wall.start },
      end: { ...wall.end },
    })),
    openings: project.openings.map((opening) => ({
      ...opening,
      position: { ...opening.position },
    })),
    suggestedScale: project.suggestedScale,
    imageAspectRatio: project.imageAspectRatio,
  }), []);

  const loadImportedProject = useCallback((fileData: PlanitiesProjectFile) => {
    const nextProject = cloneProjectData(fileData.project);
    setPreviewUrl(fileData.previewUrl);
    setData(nextProject);
    setEditorDraft(nextProject);
    setEditorInstance((value) => value + 1);
    setSceneInstance((value) => value + 1);
    setCurrentStep(fileData.workflowStep);
    setIsScaleCalibrated(fileData.isScaleCalibrated);
    setViewMode('orbit');
    setIsPreparing3D(false);
    setIsSceneReady(false);
    setState('editor');
  }, [cloneProjectData]);

  useEffect(() => {
    if (state === 'editor' && !hasBackground && currentStep === 'trace') {
      setCurrentStep('scale');
    }
    if (state === 'editor' && !hasBackground && !isScaleCalibrated) {
      setIsScaleCalibrated(true);
    }
  }, [currentStep, hasBackground, isScaleCalibrated, state]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    try {
      if (file.type === 'application/pdf') {
        const [pdfjs, workerModule] = await Promise.all([
          import('pdfjs-dist'),
          import('pdfjs-dist/build/pdf.worker.mjs?url'),
        ]);

        pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
        const page = await pdf.getPage(1);

        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');

        if (context) {
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          await page.render({
            canvasContext: context,
            viewport,
            canvas,
          } as any).promise;

          openEditor(canvas.toDataURL('image/png'));
        }
      } else {
        const reader = new FileReader();
        reader.onload = async (event) => {
          openEditor(event.target?.result as string);
        };
        reader.readAsDataURL(file);
      }
    } catch (error) {
      console.error('Error processing file:', error);
      alert('Error loading file. Make sure it is a valid image or PDF.');
    } finally {
      setIsProcessing(false);
    }
  }, [openEditor]);

  const triggerImportProject = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const handleExportProject = useCallback(() => {
    if (!projectForExport || !hasProjectContent) {
      alert('Nothing to export yet.');
      return;
    }

    const projectFile: PlanitiesProjectFile = {
      formatVersion: 1,
      appVersion: '1.0.0',
      exportedAt: new Date().toISOString(),
      workflowStep: currentStep === '3d' ? 'scale' : currentStep,
      isScaleCalibrated,
      previewUrl,
      project: cloneProjectData(projectForExport),
    };

    const blob = new Blob([JSON.stringify(projectFile, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `planities-project-${new Date().toISOString().slice(0, 10)}.planities`;
    link.click();
    URL.revokeObjectURL(url);
  }, [cloneProjectData, currentStep, hasProjectContent, isScaleCalibrated, previewUrl, projectForExport]);

  const handleImportProject = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';

    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.planities')) {
      alert('Invalid file type. Please select a .planities project file.');
      return;
    }

    if (state === 'editor' && hasProjectContent) {
      const shouldReplace = window.confirm('Importing a project will replace the current drawing.');
      if (!shouldReplace) {
        return;
      }
    }

    try {
      const rawText = await file.text();
      const parsed = JSON.parse(rawText) as Partial<PlanitiesProjectFile>;

      if (parsed.formatVersion !== 1) {
        throw new Error('Unsupported project version.');
      }

      if (!parsed.project || !Array.isArray(parsed.project.walls) || !Array.isArray(parsed.project.openings)) {
        throw new Error('Missing required geometry fields.');
      }

      const isValidWalls = parsed.project.walls.every((wall) =>
        typeof wall?.start?.x === 'number' &&
        typeof wall?.start?.y === 'number' &&
        typeof wall?.end?.x === 'number' &&
        typeof wall?.end?.y === 'number' &&
        typeof wall?.thickness === 'number',
      );

      const isValidOpenings = parsed.project.openings.every((opening) =>
        typeof opening?.position?.x === 'number' &&
        typeof opening?.position?.y === 'number' &&
        typeof opening?.width === 'number' &&
        (opening?.type === 'door' || opening?.type === 'window') &&
        typeof opening?.rotation === 'number',
      );

      if (!isValidWalls || !isValidOpenings) {
        throw new Error('The selected project file is malformed.');
      }

      loadImportedProject({
        formatVersion: 1,
        appVersion: typeof parsed.appVersion === 'string' ? parsed.appVersion : 'unknown',
        exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : new Date().toISOString(),
        workflowStep: parsed.workflowStep === 'trace' && parsed.previewUrl ? 'trace' : 'scale',
        isScaleCalibrated: parsed.workflowStep === 'trace' && parsed.previewUrl ? Boolean(parsed.isScaleCalibrated) : true,
        previewUrl: typeof parsed.previewUrl === 'string' ? parsed.previewUrl : null,
        project: parsed.project,
      });
    } catch (error) {
      console.error('Error importing project:', error);
      const message = error instanceof Error ? error.message : 'Could not import the selected project.';
      alert(message);
    }
  }, [hasProjectContent, loadImportedProject, state]);

  const showScreenshotMessage = useCallback((message: string) => {
    setScreenshotMessage(message);
    window.setTimeout(() => {
      setScreenshotMessage((current) => (current === message ? null : current));
    }, 2200);
  }, []);

  const handleScreenshot = useCallback(() => {
    if (!capture3D) {
      showScreenshotMessage('Unable to capture screenshot.');
      return;
    }

    try {
      const imageDataUrl = capture3D();
      if (!imageDataUrl) {
        showScreenshotMessage('Unable to capture screenshot.');
        return;
      }

      const now = new Date();
      const timestamp = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
      ].join('-') + '-' + [
        String(now.getHours()).padStart(2, '0'),
        String(now.getMinutes()).padStart(2, '0'),
        String(now.getSeconds()).padStart(2, '0'),
      ].join('');

      const link = document.createElement('a');
      link.href = imageDataUrl;
      link.download = `planities-3d-${timestamp}.png`;
      link.click();
    } catch (error) {
      console.error('Screenshot capture failed:', error);
      showScreenshotMessage('Screenshot failed.');
    }
  }, [capture3D, showScreenshotMessage]);

  return (
    <div className="h-screen overflow-hidden bg-[#E4E3E0] text-[#141414] font-sans selection:bg-[#141414] selection:text-[#E4E3E0] flex flex-col">
      <input
        ref={importInputRef}
        type="file"
        accept=".planities,application/json"
        onChange={handleImportProject}
        className="hidden"
      />

      {state === 'upload' && (
        <header className="fixed top-0 left-0 right-0 z-50 p-6 flex justify-between items-center mix-blend-difference text-white">
          <div className="flex items-center gap-2">
            <Box className="w-7 h-7" />
            <h1 className="text-2xl md:text-[1.75rem] font-medium tracking-tight italic serif">Planities</h1>
          </div>
        </header>
      )}

      {state === 'editor' && (
        <header className="relative z-20 p-4 pb-3 shrink-0">
          <div
            className={`mx-auto flex max-w-[1600px] items-center justify-between gap-5 rounded-[24px] border px-5 py-3 shadow-lg backdrop-blur-xl transition-colors ${
              currentStep === '3d'
                ? 'border-[#2F3944]/12 bg-[#E8ECEF]/88'
                : 'border-[#141414]/10 bg-white/75'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#141414] text-white">
                <Box className="h-5 w-5" />
              </div>
              <div className="space-y-0.5">
                <p className="text-sm font-medium tracking-tight italic serif">Planities</p>
                <p className="text-[10px] uppercase tracking-[0.2em] text-[#141414]/35">Spatial Workflow</p>
              </div>
            </div>

            <WorkflowStepper
              currentStep={currentStep}
              isScaleCalibrated={isScaleCalibrated}
              hasBackground={hasBackground}
            />

            <div className="flex items-center gap-3">
              {currentStep === '3d' && (
                <button
                  onClick={() => setCurrentStep('scale')}
                  className="flex items-center gap-2 rounded-2xl border border-[#141414]/10 bg-white px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#141414] transition-all hover:bg-[#141414]/5"
                >
                  <Hand className="h-4 w-4" />
                  Back to Plan
                </button>
              )}
              <button
                onClick={resetProject}
                className="flex items-center gap-2 rounded-2xl border border-[#141414]/10 bg-white px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#141414] transition-all hover:bg-[#141414]/5"
              >
                <ArrowLeft className="h-4 w-4" />
                New Project
              </button>
              {currentStep !== '3d' && (
                <>
                  <button
                    onClick={triggerImportProject}
                    className="flex items-center gap-2 rounded-2xl border border-[#141414]/10 bg-white px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#141414] transition-all hover:bg-[#141414]/5"
                  >
                    <FolderOpen className="h-4 w-4" />
                    Import Project
                  </button>
                  <button
                    onClick={handleExportProject}
                    disabled={!hasProjectContent}
                    className="flex items-center gap-2 rounded-2xl border border-[#141414]/10 bg-white px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#141414] transition-all hover:bg-[#141414]/5 disabled:opacity-40 disabled:hover:bg-white"
                  >
                    <Download className="h-4 w-4" />
                    Export Project
                  </button>
                </>
              )}
            </div>
          </div>
        </header>
      )}

      <main className="flex-1 min-h-0 flex flex-col">
        <AnimatePresence mode="wait">
          {state === 'upload' && (
            <motion.div
              key="upload"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex-1 flex flex-col items-center justify-center p-6"
            >
              <div className="max-w-2xl w-full space-y-12">
                <div className="space-y-4 text-center md:text-left">
                  <h2 className="text-6xl md:text-8xl font-medium tracking-tighter leading-[0.9]">
                    From Paper <br />
                    <span className="italic serif opacity-50">to Space.</span>
                  </h2>
                  <p className="text-xl opacity-60 max-w-md mx-auto md:mx-0">
                    Upload a 2D floor plan, trace the walls, and turn it into a navigable 3D space.
                  </p>
                </div>

                <div className="flex flex-col md:flex-row gap-6">
                  <div className="relative group flex-1">
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={handleFileUpload}
                      disabled={isProcessing}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 disabled:cursor-not-allowed"
                    />
                    <div className={`border-2 border-dashed border-[#141414]/20 rounded-3xl p-12 flex flex-col items-center justify-center gap-6 transition-colors bg-white/50 backdrop-blur-sm h-full ${isProcessing ? 'opacity-50' : 'group-hover:border-[#141414]/40'}`}>
                      <div className={`w-16 h-16 rounded-full bg-[#141414] text-white flex items-center justify-center transition-transform ${isProcessing ? 'animate-pulse' : 'group-hover:scale-110'}`}>
                        {isProcessing ? (
                          <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <Upload className="w-8 h-8" />
                        )}
                      </div>
                      <div className="text-center">
                        <p className="text-lg font-medium">
                          {isProcessing ? 'Processing...' : 'Drag or click to upload'}
                        </p>
                        <p className="text-sm opacity-50">PNG, JPG, or PDF up to 10MB</p>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => openEditor(null)}
                    className="flex-1 border-2 border-[#141414]/10 rounded-3xl p-12 flex flex-col items-center justify-center gap-6 hover:bg-white/50 transition-all group bg-white/30 backdrop-blur-sm"
                  >
                    <div className="w-16 h-16 rounded-full bg-white border border-[#141414]/10 flex items-center justify-center group-hover:scale-110 transition-transform shadow-sm">
                      <Plus className="w-8 h-8" />
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-medium">Start from scratch</p>
                      <p className="text-sm opacity-50">Draw on a blank canvas at real scale</p>
                    </div>
                  </button>
                </div>

                <button
                  onClick={triggerImportProject}
                  className="w-full rounded-3xl border border-[#141414]/10 bg-white/45 px-6 py-4 text-sm font-medium text-[#141414] transition-all hover:bg-white/65"
                >
                  Import Project
                </button>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-12 border-t border-[#141414]/10">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs font-mono uppercase opacity-50">
                      <Search className="w-3 h-3" />
                      Trace
                    </div>
                    <p className="text-sm">Draw walls precisely over the source plan.</p>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs font-mono uppercase opacity-50">
                      <Box className="w-3 h-3" />
                      3D Preview
                    </div>
                    <p className="text-sm">Generate clean architectural volumes in a single step.</p>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs font-mono uppercase opacity-50">
                      <Move className="w-3 h-3" />
                      Explore
                    </div>
                    <p className="text-sm">Walk through the space and understand its proportions immediately.</p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {state === 'editor' && (
            <motion.div
              key="editor"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 relative"
            >
              <div className={currentStep === '3d' ? 'hidden' : 'flex h-full'}>
                <Suspense fallback={<ScreenLoader label="Loading editor" />}>
                  <ManualTracer
                    key={editorInstance}
                    imageUrl={previewUrl}
                    workflowStep={currentStep === 'trace' ? 'trace' : 'scale'}
                    isScaleCalibrated={isScaleCalibrated}
                    initialWalls={(editorDraft ?? data)?.walls}
                    initialOpenings={(editorDraft ?? data)?.openings}
                    onProjectChange={(draft) => {
                      setEditorDraft(cloneProjectData(draft));
                    }}
                    onScaleCalibrated={() => {
                      setIsScaleCalibrated(true);
                      setCurrentStep('scale');
                    }}
                    onComplete={(manualData) => {
                      setIsPreparing3D(true);
                      setIsSceneReady(false);
                      const nextData = cloneProjectData(manualData);
                      setData(nextData);
                      setEditorDraft(nextData);
                      setViewMode('orbit');
                      setSceneInstance((value) => value + 1);
                      setCurrentStep('3d');
                    }}
                    onCancel={resetProject}
                  />
                </Suspense>
              </div>

              {currentStep === '3d' && data && (
                <Suspense fallback={<ScreenLoader label="Loading 3D scene" />}>
                  <div className="h-full w-full">
                    <Scene3D
                      key={`${sceneInstance}`}
                      data={data}
                      mode={viewMode}
                      onScreenshotReady={setCapture3D}
                      onReady={() => {
                        setIsSceneReady(true);
                        setIsPreparing3D(false);
                      }}
                    />

                    {(isPreparing3D || !isSceneReady) && (
                      <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#E4E3E0]/86 backdrop-blur-md">
                        <div className="flex flex-col items-center gap-4 text-center">
                          <div className="h-11 w-11 rounded-full border-2 border-[#141414]/18 border-t-[#141414] animate-spin" />
                          <div className="space-y-1">
                            <p className="text-sm font-mono uppercase tracking-[0.24em] text-[#141414]/55">
                              Preparing 3D Scene
                            </p>
                            <p className="text-xs text-[#141414]/45">
                              Initializing geometry, camera and navigation
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="absolute bottom-8 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-[#141414]/10 bg-[#F4F2EE]/82 p-2 shadow-2xl backdrop-blur-xl">
                      <button
                        onClick={handleScreenshot}
                        className="flex items-center gap-2 px-6 py-3 rounded-xl text-[#141414]/68 transition-all hover:bg-[#141414]/5 hover:text-[#141414]"
                      >
                        <Camera className="w-4 h-4" />
                        <span className="text-sm font-medium uppercase tracking-wider">Screenshot</span>
                      </button>
                      <button
                        onClick={() => setViewMode('orbit')}
                        className={`flex items-center gap-2 px-6 py-3 rounded-xl transition-all ${
                          viewMode === 'orbit'
                            ? 'bg-white text-[#141414] shadow-lg'
                            : 'text-[#141414]/68 hover:bg-[#141414]/5 hover:text-[#141414]'
                        }`}
                      >
                        <Eye className="w-4 h-4" />
                        <span className="text-sm font-medium uppercase tracking-wider">Orbit</span>
                      </button>
                      <button
                        onClick={() => setViewMode('first-person')}
                        className={`flex items-center gap-2 px-6 py-3 rounded-xl transition-all ${
                          viewMode === 'first-person'
                            ? 'bg-white text-[#141414] shadow-lg'
                            : 'text-[#141414]/68 hover:bg-[#141414]/5 hover:text-[#141414]'
                        }`}
                      >
                        <Move className="w-4 h-4" />
                        <span className="text-sm font-medium uppercase tracking-wider">First Person</span>
                      </button>
                      <button
                        onClick={() => setViewMode('third-person')}
                        className={`flex items-center gap-2 px-6 py-3 rounded-xl transition-all ${
                          viewMode === 'third-person'
                            ? 'bg-white text-[#141414] shadow-lg'
                            : 'text-[#141414]/68 hover:bg-[#141414]/5 hover:text-[#141414]'
                        }`}
                      >
                        <PersonStanding className="w-4 h-4" />
                        <span className="text-sm font-medium uppercase tracking-wider">Third Person</span>
                      </button>
                    </div>

                    {screenshotMessage && (
                      <div className="absolute bottom-8 left-8 z-50 rounded-2xl bg-[#141414]/84 px-4 py-3 text-[10px] font-mono uppercase tracking-[0.18em] text-white shadow-xl backdrop-blur-md">
                        {screenshotMessage}
                      </div>
                    )}
                  </div>
                </Suspense>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {state === 'upload' && (
        <footer className="fixed bottom-6 left-6 text-[10px] font-mono uppercase tracking-[0.2em] opacity-30 pointer-events-none">
          Planities · Architectural Spatial Translator
        </footer>
      )}
    </div>
  );
}
