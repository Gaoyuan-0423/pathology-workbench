import { useCallback, useEffect, useRef, useState } from 'react';
import { get, set } from 'idb-keyval';
import { runAnalysis } from './core/analysis-client.ts';
import { decodeImageFile } from './core/image/decode.ts';
import {
  createEmptyProject,
  DEFAULT_SEGMENTATION,
  DEFAULT_THRESHOLD,
  type AnalysisResult,
  type ProjectState,
  type ThresholdConfig,
} from './core/types.ts';
import CanvasView from './ui/CanvasView.tsx';
import InfoPanel from './ui/InfoPanel.tsx';
import ParamsPanel from './ui/ParamsPanel.tsx';
import ResultsPanel from './ui/ResultsPanel.tsx';
import UploadPanel from './ui/UploadPanel.tsx';

const STORAGE_KEY = 'pathology-workbench:project:v1';

type Status = { kind: 'idle' | 'busy' | 'error' | 'ok'; message: string };

export default function App() {
  const [project, setProject] = useState<ProjectState>(createEmptyProject);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle', message: '' });
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);
  const saveTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    void (async () => {
      try {
        const saved = await get<ProjectState>(STORAGE_KEY);
        if (saved?.version === 1 && saved.pixels instanceof ImageData) {
          setProject({
            ...createEmptyProject(),
            ...saved,
            threshold: { ...DEFAULT_THRESHOLD, ...saved.threshold },
            segmentation: { ...DEFAULT_SEGMENTATION, ...saved.segmentation },
          });
        }
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void set(STORAGE_KEY, project);
    }, 600);
    return () => window.clearTimeout(saveTimer.current);
  }, [project, loaded]);

  // 参数或图像变化 → 防抖后自动分析（stale 结果按 requestId 丢弃）
  const { pixels, rois, threshold, segmentation } = project;
  useEffect(() => {
    if (!pixels) {
      setAnalysis(null);
      setAnalyzing(false);
      return;
    }
    setAnalyzing(true);
    const timer = window.setTimeout(() => {
      void runAnalysis(pixels, rois, threshold, segmentation).then((result) => {
        setAnalysis(result);
        setAnalyzing(false);
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [pixels, rois, threshold, segmentation]);

  const handleFile = useCallback(async (file: File) => {
    setStatus({ kind: 'busy', message: `正在解码 ${file.name}…` });
    try {
      const decoded = await decodeImageFile(file);
      setProject((prev) => ({
        ...prev,
        image: {
          name: decoded.name,
          sourceType: decoded.sourceType,
          sourceWidth: decoded.sourceWidth,
          sourceHeight: decoded.sourceHeight,
          workingWidth: decoded.workingWidth,
          workingHeight: decoded.workingHeight,
          workingScale: decoded.workingScale,
          bitsPerSample: decoded.bitsPerSample,
          note: decoded.note,
        },
        pixels: decoded.pixels,
        rois: [],
      }));
      setStatus({
        kind: 'ok',
        message: decoded.workingScale > 1
          ? `已导入并降采样至 ${decoded.workingWidth}×${decoded.workingHeight}（分析在工作图上进行）`
          : '已导入',
      });
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  const clearImage = useCallback(() => {
    setProject(createEmptyProject());
    setStatus({ kind: 'idle', message: '' });
  }, []);

  const patchThreshold = useCallback((patch: Partial<ThresholdConfig>) => {
    setProject((prev) => ({ ...prev, threshold: { ...prev.threshold, ...patch } }));
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Pathology Workbench</h1>
          <p className="app-subtitle">离线免疫组化 H-DAB 定量 · 颜色去卷积 · 阈值分割 · 统计与出版导出</p>
        </div>
        {status.message && (
          <span className={`status status-${status.kind}`} role="status">{status.message}</span>
        )}
      </header>
      <main className="app-main">
        <CanvasView
          pixels={project.pixels}
          rois={project.rois}
          overlay={showOverlay ? analysis?.overlay ?? null : null}
        />
        <aside className="side-panel">
          <UploadPanel busy={status.kind === 'busy'} onFile={(file) => void handleFile(file)} />
          <InfoPanel
            image={project.image}
            calibration={project.calibration}
            onMppChange={(mpp) => setProject((prev) => ({ ...prev, calibration: { mpp } }))}
            onClear={clearImage}
          />
          <ParamsPanel
            threshold={project.threshold}
            disabled={!project.pixels || analyzing}
            onChange={patchThreshold}
            showOverlay={showOverlay}
            onShowOverlayChange={setShowOverlay}
          />
          <ResultsPanel result={analysis} running={analyzing} hasImage={Boolean(project.pixels)} />
        </aside>
      </main>
    </div>
  );
}
