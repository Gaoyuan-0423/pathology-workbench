import { useCallback, useEffect, useRef, useState } from 'react';
import { get, set } from 'idb-keyval';
import { runAnalysis } from './core/analysis-client.ts';
import { compareGroups } from './core/analysis/statistics.ts';
import { evaluateDiagnostics } from './core/advisor.ts';
import { generateMethodsEn, generateMethodsZh } from './core/methods.ts';
import { groupsFromSamples } from './core/api.ts';
import { controlThresholdFromChannel } from './core/analysis/calibrate.ts';
import { histogram256, percentileFromHist } from './core/analysis/threshold.ts';
import { extractDabChannel } from './core/image/color.ts';
import { decodeImageFile } from './core/image/decode.ts';
import {
  createEmptyProject,
  DEFAULT_COLOC,
  DEFAULT_SEGMENTATION,
  DEFAULT_THRESHOLD,
  getStainProfile,
  STAIN_PROFILES,
  type AnalysisResult,
  type ColocConfig,
  type ProjectState,
  type Roi,
  type MetricKey,
  type SegmentationConfig,
  type StainProfileId,
  type ThresholdConfig,
  type Vec3 as StainVec,
} from './core/types.ts';
import AdvisorPanel from './ui/AdvisorPanel.tsx';
import BatchPanel, { type BatchState } from './ui/BatchPanel.tsx';
import AiPanel from './ui/AiPanel.tsx';
import CanvasView from './ui/CanvasView.tsx';
import ColocPanel from './ui/ColocPanel.tsx';
import InfoPanel from './ui/InfoPanel.tsx';
import ParamsPanel from './ui/ParamsPanel.tsx';
import ResultsPanel from './ui/ResultsPanel.tsx';
import RoiList from './ui/RoiList.tsx';
import SamplesPanel from './ui/SamplesPanel.tsx';
import UploadPanel from './ui/UploadPanel.tsx';

const STORAGE_KEY = 'pathology-workbench:project:v1';
const suiteHost = window.location.hostname.toLowerCase();
const isWispLab = suiteHost === 'wisplab.top' || suiteHost.endsWith('.wisplab.top');
const suiteLinks = {
  wb: isWispLab ? 'https://wb.wisplab.top/' : 'https://gaoyuan-0423.github.io/blot-workbench/',
  pathology: isWispLab ? 'https://pathology.wisplab.top/' : './',
  pcr: isWispLab ? 'https://pcr.wisplab.top/' : 'https://gaoyuan-0423.github.io/pcr-workbench/',
};

type Status = { kind: 'idle' | 'busy' | 'error' | 'ok'; message: string };
type DrawMode = 'none' | 'roi' | 'line';

function LineCalibration({
  lengthPx,
  onApply,
  onCancel,
}: {
  lengthPx: number;
  onApply: (mpp: number) => void;
  onCancel: () => void;
}) {
  const [micrometers, setMicrometers] = useState('');
  const value = Number(micrometers);
  const valid = Number.isFinite(value) && value > 0;
  return (
    <section className="panel">
      <h3>比例尺标定</h3>
      <p className="panel-note">
        线段长度 {lengthPx.toFixed(1)} px。输入该线段对应的真实长度：
      </p>
      <div className="field-row">
        <input
          type="number"
          min={0.01}
          step={1}
          placeholder="μm"
          value={micrometers}
          onChange={(event) => setMicrometers(event.target.value)}
        />
        <button
          type="button"
          disabled={!valid}
          onClick={() => {
            onApply(value / lengthPx);
            onCancel();
          }}
        >
          应用
        </button>
        <button type="button" onClick={onCancel}>取消</button>
      </div>
    </section>
  );
}

export default function App() {
  const [project, setProject] = useState<ProjectState>(createEmptyProject);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle', message: '' });
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);
  const [drawMode, setDrawMode] = useState<DrawMode>('none');
  const [calibrating, setCalibrating] = useState(false);
  const [pendingLinePx, setPendingLinePx] = useState<number | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const aiModelRef = useRef<{ name: string; bytes: ArrayBuffer } | null>(null);
  const lastLoadedModelRef = useRef<string | null>(null);
  const useAiRef = useRef(false);
  const [aiModelName, setAiModelName] = useState<string | null>(null);
  const [aiActive, setAiActive] = useState(false);
  const [aiUseState, setAiUseState] = useState(false);
  const [aiNonce, setAiNonce] = useState(0);
  const [statsMetric, setStatsMetric] = useState<MetricKey>('positiveFraction');

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
            coloc: { ...DEFAULT_COLOC, ...saved.coloc },
            stainOverrides: saved.stainOverrides ?? {},
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

  const { pixels, rois, profileId, threshold, segmentation, calibration, coloc } = project;
  const stainOverride = project.stainOverrides[profileId] ?? null;
  useEffect(() => {
    if (!pixels) {
      setAnalysis(null);
      setAnalyzing(false);
      return;
    }
    setAnalyzing(true);
    const timer = window.setTimeout(() => {
      const ai = {
        useAi: useAiRef.current && aiModelRef.current !== null,
        model:
          useAiRef.current && aiModelRef.current && lastLoadedModelRef.current !== aiModelRef.current.name
            ? aiModelRef.current
            : null,
      };
      void runAnalysis(pixels, rois, profileId, threshold, segmentation, calibration, coloc, stainOverride, ai).then((result) => {
        if (result.aiModelLoaded) lastLoadedModelRef.current = result.aiModelLoaded;
        setAiActive(result.aiUsed);
        setAnalysis(result);
        setAnalyzing(false);
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [pixels, rois, profileId, threshold, segmentation, calibration, coloc, stainOverride, aiNonce]);

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

  const handleCalibrateControl = useCallback(
    async (file: File) => {
      setCalibrating(true);
      try {
        const decoded = await decodeImageFile(file);
        const dab = extractDabChannel(decoded.pixels);
        const bg = percentileFromHist(histogram256(dab), project.threshold.backgroundPercentile);
        for (let i = 0; i < dab.length; i += 1) {
          const v = dab[i] - bg;
          dab[i] = v > 0 ? v : 0;
        }
        const controlThreshold = controlThresholdFromChannel(
          dab,
          project.threshold.controlFalsePositiveRate,
        );
        setProject((prev) => ({
          ...prev,
          threshold: {
            ...prev.threshold,
            controlThreshold,
            controlImageName: file.name,
            mode: 'control',
          },
        }));
        setStatus({ kind: 'ok', message: `对照片标定完成：阈值 ${controlThreshold}` });
      } catch (error) {
        setStatus({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setCalibrating(false);
      }
    },
    [project.threshold.backgroundPercentile, project.threshold.controlFalsePositiveRate],
  );

  const batchCancelRef = useRef(false);
  const [batch, setBatch] = useState<BatchState | null>(null);

  const runBatch = useCallback(
    async (files: File[], group: string) => {
      batchCancelRef.current = false;
      const config = {
        profileId: project.profileId,
        threshold: project.threshold,
        segmentation: project.segmentation,
        calibration: project.calibration,
        coloc: project.coloc,
        stainOverride: project.stainOverrides[project.profileId] ?? null,
      };
      const errors: string[] = [];
      let done = 0;
      setBatch({ running: true, total: files.length, done: 0, current: files[0]?.name ?? '', errors, cancelled: false });
      for (const file of files) {
        if (batchCancelRef.current) {
          setBatch((prev) => prev && { ...prev, running: false, current: '', cancelled: true });
          setStatus({ kind: 'ok', message: `批处理已取消：完成 ${done}/${files.length}` });
          return;
        }
        setBatch((prev) => prev && { ...prev, current: file.name });
        try {
          const decoded = await decodeImageFile(file);
          const result = await runAnalysis(
            decoded.pixels,
            [],
            config.profileId,
            config.threshold,
            config.segmentation,
            config.calibration,
            config.coloc,
            config.stainOverride,
            {
              useAi: useAiRef.current && aiModelRef.current !== null,
              model:
                useAiRef.current && aiModelRef.current && lastLoadedModelRef.current !== aiModelRef.current.name
                  ? aiModelRef.current
                  : null,
            },
          );
          if (result.aiModelLoaded) lastLoadedModelRef.current = result.aiModelLoaded;
          setProject((prev) => ({
            ...prev,
            samples: [
              ...prev.samples,
              {
                id: crypto.randomUUID(),
                name: file.name.replace(/\.[^.]+$/, ''),
                group,
                imageName: file.name,
                addedAt: Date.now(),
                metrics: result.overall,
              },
            ],
          }));
        } catch (error) {
          errors.push(`${file.name}：${error instanceof Error ? error.message : String(error)}`);
        }
        done += 1;
        setBatch((prev) => prev && { ...prev, done, errors: [...errors] });
      }
      setBatch((prev) => prev && { ...prev, running: false, current: '' });
      setStatus({
        kind: errors.length > 0 ? 'error' : 'ok',
        message: `批处理完成：成功 ${done - errors.length}，失败 ${errors.length}`,
      });
    },
    [project.profileId, project.threshold, project.segmentation, project.calibration, project.coloc],
  );

  const clearImage = useCallback(() => {
    setProject(createEmptyProject());
    setDrawMode('none');
    setPendingLinePx(null);
    setStatus({ kind: 'idle', message: '' });
  }, []);

  const patchThreshold = useCallback((patch: Partial<ThresholdConfig>) => {
    setProject((prev) => ({ ...prev, threshold: { ...prev.threshold, ...patch } }));
  }, []);

  const patchColoc = useCallback((patch: Partial<ColocConfig>) => {
    setProject((prev) => ({ ...prev, coloc: { ...prev.coloc, ...patch } }));
  }, []);

  const setStainOverride = useCallback((profileId: StainProfileId, pair: [StainVec, StainVec] | null) => {
    setProject((prev) => {
      const next = { ...prev.stainOverrides };
      if (pair === null) delete next[profileId];
      else next[profileId] = pair;
      return { ...prev, stainOverrides: next };
    });
  }, []);

  const patchSegmentation = useCallback((patch: Partial<SegmentationConfig>) => {
    setProject((prev) => ({ ...prev, segmentation: { ...prev.segmentation, ...patch } }));
  }, []);

  const handleRoiDrawn = useCallback((rect: { x: number; y: number; w: number; h: number }) => {
    setProject((prev) => {
      const roi: Roi = {
        id: crypto.randomUUID(),
        name: `ROI ${prev.rois.length + 1}`,
        ...rect,
      };
      return { ...prev, rois: [...prev.rois, roi] };
    });
  }, []);

  const deleteRoi = useCallback((id: string) => {
    setProject((prev) => ({ ...prev, rois: prev.rois.filter((roi) => roi.id !== id) }));
  }, []);

  const addSample = useCallback((group: string) => {
    if (!analysis || !project.image) return;
    setProject((prev) => ({
      ...prev,
      samples: [
        ...prev.samples,
        {
          id: crypto.randomUUID(),
          name: `S${prev.samples.length + 1} ${project.image!.name}`,
          group,
          imageName: project.image!.name,
          addedAt: Date.now(),
          metrics: analysis.overall,
        },
      ],
    }));
    setStatus({ kind: 'ok', message: `已加入样本库（分组：${group}）` });
  }, [analysis, project.image]);

  const updateSample = useCallback((id: string, patch: { group?: string; name?: string }) => {
    setProject((prev) => ({
      ...prev,
      samples: prev.samples.map((sample) => (sample.id === id ? { ...sample, ...patch } : sample)),
    }));
  }, []);

  const hasImage = Boolean(project.pixels);
  const isColoc = project.profileId === 'if_coloc';

  // 程序化 API：控制台/脚本可调用（只读 + 报告导出）
  const reportRef = useRef<{ json: () => unknown } | null>(null);
  reportRef.current = {
    json: () => {
      const groups = groupsFromSamples({ samples: project.samples, metric: statsMetric });
      const stats = groups.length >= 2 ? compareGroups(groups) : null;
      const diagnostics = evaluateDiagnostics({ project, result: analysis, qc: analysis?.qc ?? null, statsReport: stats });
      return {
        generatedAt: new Date().toISOString(),
        image: project.image,
        profile: project.profileId,
        metrics: analysis?.overall ?? null,
        samples: project.samples,
        statistics: stats,
        diagnostics,
        methods: { zh: generateMethodsZh(project, analysis), en: generateMethodsEn(project, analysis) },
      };
    },
  };
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__pathologyAPI = {
      version: '0.1.0',
      getReportJson: () => reportRef.current?.json() ?? null,
      exportReportJson: () => {
        const data = reportRef.current?.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `pathology-report-${new Date().toISOString().slice(0, 10)}.json`;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 2000);
        return data;
      },
    };
  }, []);
  return (
    <div className="app">
      <header className="app-header">
        <a className="app-brand" href="./" aria-label="Pathology Workbench 病理工作台">
          <span className="brand-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m8 3 6 6-4 4-6-6zM7 10l-2 2m7-1 2 2M9 19h10M5 21h16M14 5a8 8 0 0 1 4 14M7 16h5" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
          <span><h1>病理工作台</h1><span className="app-subtitle">Pathology Workbench</span></span>
        </a>
        <nav className="suite-nav" aria-label="科研工作台导航">
          {isWispLab && <a href="https://wisplab.top/">总首页</a>}
          <a href={suiteLinks.wb}>WB <span>条带分析</span></a>
          <a href={suiteLinks.pathology} aria-current="page">病理 <span>图像定量</span></a>
          <a href={suiteLinks.pcr}>PCR <span>表达分析</span></a>
        </nav>
        <div className="header-meta">
          <span className="local-badge"><span aria-hidden="true"/>本地处理 · 图像不上传</span>
          {status.message && (
            <span className={`status status-${status.kind}`} role="status">{status.message}</span>
          )}
        </div>
      </header>
      <main className="app-main">
        <div className="canvas-column">
          <div className="workspace-heading"><div><p className="section-eyebrow">IMAGE WORKSPACE</p><h2>图像与定量结果</h2></div><span className="profile-badge">{getStainProfile(project.profileId).label}</span></div>
          <UploadPanel busy={status.kind === 'busy'} onFile={(file) => void handleFile(file)} />
          <CanvasView
            pixels={project.pixels}
            rois={project.rois}
            overlay={showOverlay ? analysis?.overlay ?? null : null}
            drawRoi={drawMode === 'roi'}
            drawLine={drawMode === 'line'}
            onRoiDrawn={handleRoiDrawn}
            onLineDrawn={setPendingLinePx}
          />
          <div className="workspace-caption"><span>{project.image ? project.image.name : '支持病理染色、免疫组化与免疫荧光图像'}</span><span>滚轮缩放 · 拖动平移</span></div>
          <div className="analysis-results"><ResultsPanel result={analysis} running={analyzing} hasImage={hasImage} /></div>
        </div>
        <aside className="side-panel">
          <div className="settings-heading"><div><p className="section-eyebrow">ANALYSIS SETTINGS</p><h2>分析设置</h2></div><span>调整后自动计算</span></div>
          <section className="panel">
            <h3>分析预设</h3>
            <div className="profile-grid">
              {STAIN_PROFILES.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  title={profile.description}
                  className={project.profileId === profile.id ? 'profile-active' : ''}
                  onClick={() => setProject((prev) => ({ ...prev, profileId: profile.id }))}
                >
                  {profile.label}
                </button>
              ))}
            </div>
          </section>
          <InfoPanel
            image={project.image}
            calibration={project.calibration}
            onMppChange={(mpp) => setProject((prev) => ({ ...prev, calibration: { mpp } }))}
            onClear={clearImage}
          />
          {!isColoc && (
            <BatchPanel
              disabled={false}
              batch={batch}
              onBatch={(files, group) => void runBatch(files, group)}
              onCancel={() => {
                batchCancelRef.current = true;
              }}
            />
          )}
          <RoiList
            rois={project.rois}
            drawRoi={drawMode === 'roi'}
            drawLine={drawMode === 'line'}
            onDrawRoiToggle={(value) => setDrawMode(value ? 'roi' : 'none')}
            onDrawLineToggle={(value) => setDrawMode(value ? 'line' : 'none')}
            onDelete={deleteRoi}
          />
          {pendingLinePx !== null && (
            <LineCalibration
              lengthPx={pendingLinePx}
              onApply={(mpp) => setProject((prev) => ({ ...prev, calibration: { mpp } }))}
              onCancel={() => setPendingLinePx(null)}
            />
          )}
          {isColoc ? (
            <ColocPanel
              coloc={project.coloc}
              disabled={!hasImage || analyzing}
              onChange={patchColoc}
              showOverlay={showOverlay}
              onShowOverlayChange={setShowOverlay}
            />
          ) : (
            <ParamsPanel
              threshold={project.threshold}
              segmentation={project.segmentation}
              quantifyLabel={getStainProfile(project.profileId).quantifyLabel}
              stainVectors={stainOverride ?? getStainProfile(project.profileId).stains}
              presetVectors={getStainProfile(project.profileId).stains}
              onVectorsChange={(pair) => setStainOverride(project.profileId, pair)}
              disabled={!hasImage || analyzing}
              onThresholdChange={patchThreshold}
              onSegmentationChange={patchSegmentation}
              onCalibrateControl={(file) => void handleCalibrateControl(file)}
              calibrating={calibrating}
              showOverlay={showOverlay}
              onShowOverlayChange={setShowOverlay}
            />
          )}
          {!isColoc && (
            <AiPanel
              modelName={aiModelName}
              aiActive={aiActive}
              useAi={aiUseState}
              onUseAiChange={(value) => {
                useAiRef.current = value;
                setAiUseState(value);
                setAiNonce((n) => n + 1); // 触发重分析
              }}
              onModelFile={(file) => {
                void file.arrayBuffer().then((bytes) => {
                  aiModelRef.current = { name: file.name, bytes };
                  lastLoadedModelRef.current = null; // 强制下次请求装载
                  setAiModelName(file.name);
                  useAiRef.current = true;
                  setAiUseState(true);
                  setAiNonce((n) => n + 1); // 触发重分析
                });
              }}
            />
          )}
          <SamplesPanel
            project={project}
            statsMetric={statsMetric}
            canAddSample={Boolean(analysis) && !isColoc}
            disabled={analyzing}
            onAddSample={addSample}
            onUpdateSample={updateSample}
            onDeleteSample={(id) =>
              setProject((prev) => ({ ...prev, samples: prev.samples.filter((s) => s.id !== id) }))
            }
            onStatus={(message, kind) => setStatus({ kind, message })}
            analysisResult={analysis}
            onStatsMetricChange={setStatsMetric}
          />
          <AdvisorPanel
            project={project}
            analysis={analysis}
            statsMetric={statsMetric}
            onStatus={(message, kind) => setStatus({ kind, message })}
          />
        </aside>
      </main>
    </div>
  );
}
