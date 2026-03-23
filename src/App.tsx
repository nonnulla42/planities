import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Upload, Box, Eye, Move, ArrowLeft, Hand, Plus, PersonStanding, FolderOpen, Download } from 'lucide-react';
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

const HERO_PLAN_IMAGE = '/hero-floorplan-2d.png';
const HERO_SPACE_IMAGE = '/hero-space-3d.png';

function HeroScreenshotCard({
  src,
  alt,
  eyebrow,
  title,
  objectPosition = 'center',
}: {
  src: string;
  alt: string;
  eyebrow: string;
  title: string;
  objectPosition?: string;
}) {
  const [hasError, setHasError] = useState(false);

  return (
    <div className="group relative overflow-hidden rounded-[30px] border border-[#141414]/8 bg-white shadow-[0_24px_80px_rgba(20,20,20,0.08)]">
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between border-b border-[#141414]/6 bg-white/88 px-5 py-4 backdrop-blur-md">
        <div>
          <p className="text-[10px] uppercase tracking-[0.24em] text-[#141414]/38">{eyebrow}</p>
          <p className="mt-1 text-sm font-medium text-[#141414]/82">{title}</p>
        </div>
        <div className="h-2.5 w-2.5 rounded-full bg-[#141414]/12" />
      </div>

      <div className="relative aspect-[5/6] bg-[#F3F0EB]">
        {!hasError ? (
          <img
            src={src}
            alt={alt}
            onError={() => setHasError(true)}
            className="h-full w-full object-cover"
            style={{ objectPosition }}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-[linear-gradient(180deg,#F7F5F1_0%,#EFEBE5_100%)] px-8 text-center">
            <div className="max-w-xs space-y-3">
              <p className="text-[10px] uppercase tracking-[0.24em] text-[#141414]/35">Screenshot placeholder</p>
              <p className="text-base leading-relaxed text-[#141414]/58">
                Add the image file to <span className="font-medium text-[#141414]/72">{src}</span> to render this hero panel.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

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
  const [currentStep, setCurrentStep] = useState<WorkflowStep>('scale');
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
    setCurrentStep('scale');
    setIsScaleCalibrated(false);
    setViewMode('orbit');
    setIsPreparing3D(false);
    setIsSceneReady(false);
  }, []);

  const openEditor = useCallback((nextPreviewUrl: string | null) => {
    const hasImportedReference = Boolean(nextPreviewUrl);
    setPreviewUrl(nextPreviewUrl);
    setData(null);
    setEditorDraft(null);
    setEditorInstance((value) => value + 1);
    setCurrentStep(hasImportedReference ? 'scale' : 'trace');
    setIsScaleCalibrated(!hasImportedReference);
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
    const importedHasReference = Boolean(fileData.previewUrl);
    const nextStep = importedHasReference
      ? (fileData.isScaleCalibrated ? (fileData.workflowStep === 'scale' ? 'trace' : fileData.workflowStep) : 'scale')
      : 'trace';

    setPreviewUrl(fileData.previewUrl);
    setData(nextProject);
    setEditorDraft(nextProject);
    setEditorInstance((value) => value + 1);
    setSceneInstance((value) => value + 1);
    setCurrentStep(nextStep);
    setIsScaleCalibrated(importedHasReference ? fileData.isScaleCalibrated : true);
    setViewMode('orbit');
    setIsPreparing3D(false);
    setIsSceneReady(false);
    setState('editor');
  }, [cloneProjectData]);

  useEffect(() => {
    if (state === 'editor' && !hasBackground && currentStep === 'scale') {
      setCurrentStep('trace');
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
      workflowStep: currentStep === '3d' ? 'trace' : currentStep,
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
        (opening?.type === 'door' || opening?.type === 'window' || opening?.type === 'window-floor') &&
        typeof opening?.rotation === 'number',
      );

      if (!isValidWalls || !isValidOpenings) {
        throw new Error('The selected project file is malformed.');
      }

      loadImportedProject({
        formatVersion: 1,
        appVersion: typeof parsed.appVersion === 'string' ? parsed.appVersion : 'unknown',
        exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : new Date().toISOString(),
        workflowStep: parsed.workflowStep === 'scale' || parsed.workflowStep === 'trace' ? parsed.workflowStep : 'trace',
        isScaleCalibrated: parsed.previewUrl ? Boolean(parsed.isScaleCalibrated) : true,
        previewUrl: typeof parsed.previewUrl === 'string' ? parsed.previewUrl : null,
        project: parsed.project,
      });
    } catch (error) {
      console.error('Error importing project:', error);
      const message = error instanceof Error ? error.message : 'Could not import the selected project.';
      alert(message);
    }
  }, [hasProjectContent, loadImportedProject, state]);

  return (
    <div className="flex h-dvh min-h-dvh flex-col overflow-hidden bg-[#E4E3E0] font-sans text-[#141414] selection:bg-[#141414] selection:text-[#E4E3E0]">
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
        <header className="relative z-20 shrink-0 p-3 pb-2 md:p-4 md:pb-3">
          <div
            className={`mx-auto flex max-w-[1600px] flex-col gap-2 rounded-[24px] border px-3 py-3 shadow-lg backdrop-blur-xl transition-colors md:gap-3 md:px-4 xl:flex-row xl:items-center xl:justify-between xl:gap-5 xl:px-5 ${
              currentStep === '3d'
                ? 'border-[#2F3944]/12 bg-[#E8ECEF]/88'
                : 'border-[#141414]/10 bg-white/75'
            }`}
          >
            <div className="flex w-full items-center gap-3 md:w-auto">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#141414] text-white">
                <Box className="h-5 w-5" />
              </div>
              <div className="space-y-0.5">
                <p className="text-sm font-medium tracking-tight italic serif">Planities</p>
                <p className="text-[10px] uppercase tracking-[0.2em] text-[#141414]/35">Spatial Workflow</p>
              </div>
            </div>

            <div className="w-full min-w-0 md:flex-1 md:px-2">
              <WorkflowStepper
                currentStep={currentStep}
                isScaleCalibrated={isScaleCalibrated}
                hasBackground={hasBackground}
              />
            </div>

            <div className="flex w-full items-center gap-2 overflow-x-auto pb-1 xl:w-auto xl:flex-wrap xl:justify-end xl:overflow-visible xl:pb-0">
              {currentStep === '3d' && (
                <button
                  onClick={() => setCurrentStep('trace')}
                  className="flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-2xl border border-[#141414]/10 bg-white px-3 py-2 text-[9px] font-bold uppercase tracking-[0.16em] text-[#141414] transition-all hover:bg-[#141414]/5 md:min-h-11 md:px-4 md:text-[10px] md:tracking-[0.18em]"
                >
                  <Hand className="h-4 w-4" />
                  Back to Plan
                </button>
              )}
              <button
                onClick={resetProject}
                className="flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-2xl border border-[#141414]/10 bg-white px-3 py-2 text-[9px] font-bold uppercase tracking-[0.16em] text-[#141414] transition-all hover:bg-[#141414]/5 md:min-h-11 md:px-4 md:text-[10px] md:tracking-[0.18em]"
              >
                <ArrowLeft className="h-4 w-4" />
                New Project
              </button>
              {currentStep !== '3d' && (
                <>
                  <button
                    onClick={triggerImportProject}
                    className="flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-2xl border border-[#141414]/10 bg-white px-3 py-2 text-[9px] font-bold uppercase tracking-[0.16em] text-[#141414] transition-all hover:bg-[#141414]/5 md:min-h-11 md:px-4 md:text-[10px] md:tracking-[0.18em]"
                  >
                    <FolderOpen className="h-4 w-4" />
                    Import Project
                  </button>
                  <button
                    onClick={handleExportProject}
                    disabled={!hasProjectContent}
                    className="flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-2xl border border-[#141414]/10 bg-white px-3 py-2 text-[9px] font-bold uppercase tracking-[0.16em] text-[#141414] transition-all hover:bg-[#141414]/5 disabled:opacity-40 disabled:hover:bg-white md:min-h-11 md:px-4 md:text-[10px] md:tracking-[0.18em]"
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

      <main className={`flex-1 min-h-0 flex flex-col ${state === 'upload' ? 'overflow-y-auto' : ''}`}>
        <AnimatePresence mode="wait">
          {state === 'upload' && (
            <motion.div
              key="upload"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex-1 flex flex-col px-4 pb-8 pt-28 sm:px-6 sm:pb-10 sm:pt-32"
            >
              <div className="mx-auto flex w-full max-w-[1640px] flex-1 items-center">
                <div className="w-full rounded-[36px] border border-[#141414]/7 bg-[#F5F2EC]/86 px-5 py-6 shadow-[0_30px_90px_rgba(20,20,20,0.08)] backdrop-blur-xl sm:px-8 sm:py-8 lg:px-10 lg:py-10">
                  <div className="mb-6 flex flex-wrap items-center justify-center gap-3 text-center lg:mb-8 lg:justify-between lg:text-left">
                    <div className="inline-flex items-center gap-3 rounded-full border border-[#141414]/8 bg-white/85 px-4 py-2 shadow-sm">
                      <span className="text-[10px] uppercase tracking-[0.24em] text-[#141414]/38">2D plan</span>
                      <span className="h-px w-6 bg-[#141414]/14" />
                      <span className="text-[10px] uppercase tracking-[0.24em] text-[#141414]/62">Planities</span>
                      <span className="h-px w-6 bg-[#141414]/14" />
                      <span className="text-[10px] uppercase tracking-[0.24em] text-[#141414]/38">Walkable 3D</span>
                    </div>
                    <p className="max-w-xl text-sm leading-relaxed text-[#141414]/48">
                      Minimal browser workflow for turning a floor plan into a space you can actually understand.
                    </p>
                  </div>

                  <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,480px)_minmax(0,1fr)] xl:gap-8">
                    <div className="order-2 lg:order-1">
                      <HeroScreenshotCard
                        src={HERO_PLAN_IMAGE}
                        alt="2D floor plan tracing workspace in Planities"
                        eyebrow="Before"
                        title="2D plan / trace workspace"
                        objectPosition="34% center"
                      />
                    </div>

                    <div className="order-1 px-1 text-center lg:order-2 lg:px-0 lg:text-left">
                      <div className="mx-auto max-w-xl space-y-6 lg:mx-0">
                        <div className="space-y-4">
                          <p className="text-[10px] uppercase tracking-[0.32em] text-[#141414]/40">Spatial workflow</p>
                          <h2 className="text-5xl font-medium leading-[0.92] tracking-[-0.06em] sm:text-6xl xl:text-7xl">
                            Walk inside
                            <br />
                            <span className="italic serif text-[#141414]/72">a floor plan.</span>
                          </h2>
                          <p className="mx-auto max-w-lg text-base leading-7 text-[#141414]/62 sm:text-lg lg:mx-0">
                            Turn a 2D drawing into a navigable 3D space in minutes.
                            <br />
                            No sign-up. Easy to learn. Ready to explore.
                          </p>
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <button
                            onClick={() => openEditor(null)}
                            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-[#141414] px-6 py-3.5 text-sm font-medium text-white transition-all hover:bg-[#222222]"
                          >
                            <Plus className="h-4 w-4" />
                            Open Planities
                          </button>
                          <label className={`inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-[#141414]/10 bg-white/82 px-6 py-3.5 text-sm font-medium text-[#141414] transition-all hover:bg-white ${isProcessing ? 'pointer-events-none opacity-60' : ''}`}>
                            {isProcessing ? (
                              <div className="h-4 w-4 rounded-full border-2 border-[#141414]/20 border-t-[#141414] animate-spin" />
                            ) : (
                              <Upload className="h-4 w-4" />
                            )}
                            Upload floor plan
                            <input
                              type="file"
                              accept="image/*,application/pdf"
                              onChange={handleFileUpload}
                              disabled={isProcessing}
                              className="hidden"
                            />
                          </label>
                        </div>

                        <ul className="space-y-3 rounded-[28px] border border-[#141414]/7 bg-white/72 p-5 text-left shadow-sm">
                          <li className="flex gap-3 text-sm leading-6 text-[#141414]/72">
                            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#141414]/55" />
                            <span>Upload a floor plan and trace it to scale, or create the space from scratch</span>
                          </li>
                          <li className="flex gap-3 text-sm leading-6 text-[#141414]/72">
                            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#141414]/55" />
                            <span>Move quickly from 2D to 3D and walk through the rooms</span>
                          </li>
                          <li className="flex gap-3 text-sm leading-6 text-[#141414]/72">
                            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#141414]/55" />
                            <span>Understand dimensions and proportions before visiting or designing</span>
                          </li>
                        </ul>

                        <div className="space-y-3">
                          <p className="text-sm leading-6 text-[#141414]/48">
                            Created for home buyers, real estate agents and students to understand spaces faster.
                          </p>
                          <button
                            onClick={triggerImportProject}
                            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-[#141414]/12 bg-white px-5 py-3 text-sm font-medium text-[#141414] shadow-[0_12px_30px_rgba(20,20,20,0.07)] transition-all hover:border-[#141414]/20 hover:bg-[#FCFBF8] hover:shadow-[0_16px_38px_rgba(20,20,20,0.1)]"
                          >
                            <FolderOpen className="h-4 w-4" />
                            Import project
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="order-3">
                      <HeroScreenshotCard
                        src={HERO_SPACE_IMAGE}
                        alt="Walkable 3D exploration view generated by Planities"
                        eyebrow="After"
                        title="3D result / exploration view"
                        objectPosition="58% center"
                      />
                    </div>
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
                    workflowStep={currentStep === 'scale' ? 'scale' : 'trace'}
                    isScaleCalibrated={isScaleCalibrated}
                    initialSuggestedScale={(editorDraft ?? data)?.suggestedScale}
                    initialWalls={(editorDraft ?? data)?.walls}
                    initialOpenings={(editorDraft ?? data)?.openings}
                    onProjectChange={(draft) => {
                      setEditorDraft(cloneProjectData(draft));
                    }}
                    onScaleCalibrated={() => {
                      setIsScaleCalibrated(true);
                      setCurrentStep('trace');
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

                    <div className="absolute bottom-3 left-3 right-3 z-50 flex flex-wrap items-stretch justify-center gap-2 rounded-2xl border border-[#141414]/10 bg-[#F4F2EE]/82 p-2 shadow-2xl backdrop-blur-xl sm:bottom-4 md:bottom-8 md:left-1/2 md:right-auto md:w-auto md:-translate-x-1/2 md:flex-nowrap">
                      <button
                        onClick={() => setViewMode('orbit')}
                        className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 transition-all md:flex-none md:px-6 ${
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
                        className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 transition-all md:flex-none md:px-6 ${
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
                        className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 transition-all md:flex-none md:px-6 ${
                          viewMode === 'third-person'
                            ? 'bg-white text-[#141414] shadow-lg'
                            : 'text-[#141414]/68 hover:bg-[#141414]/5 hover:text-[#141414]'
                        }`}
                      >
                        <PersonStanding className="w-4 h-4" />
                        <span className="text-sm font-medium uppercase tracking-wider">Third Person</span>
                      </button>
                    </div>
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
