import { connectProjectAdapter } from './project-archive';
import { analysisSettings, emptySources, exportPathologyProject, importPathologyProject, savedAnalysis, type LocalProject, type ProjectView } from './project-io';
import { tError, t, useLanguage, setLanguage, withLanguage } from './i18n.ts';
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
import SceneSelector from './ui/SceneSelector.tsx';
import { sceneForProfile, type AnalysisScene } from './ui/analysis-scenes.ts';
import UploadPanel from './ui/UploadPanel.tsx';

const STORAGE_KEY = 'pathology-workbench:project:v1';
const suiteHost = window.location.hostname.toLowerCase();
const isDesktop = window.location.protocol === 'app:' || (window as Window & { wispLabDesktop?: { isDesktop?: boolean } }).wispLabDesktop?.isDesktop === true;
const platformHome = isDesktop ? 'app://wisplab/' : 'https://wisplab.top/';
const isWispLab = isDesktop || suiteHost === 'wisplab.top' || suiteHost.endsWith('.wisplab.top');
const suiteLinks = {
  wb: isDesktop ? 'app://wisplab/wb/' : isWispLab ? 'https://wb.wisplab.top/' : 'https://gaoyuan-0423.github.io/blot-workbench/',
  pathology: isDesktop ? 'app://wisplab/pathology/' : isWispLab ? 'https://pathology.wisplab.top/' : './',
  pcr: isDesktop ? 'app://wisplab/pcr/' : isWispLab ? 'https://pcr.wisplab.top/' : 'https://gaoyuan-0423.github.io/pcr-workbench/',
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
      <h3>{t("比例尺标定")}</h3>
      <p className="panel-note">
        {t("线段长度 ")}{lengthPx.toFixed(1)} {t("px。输入该线段对应的真实长度：")}</p>
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
          {t("应用")}</button>
        <button type="button" onClick={onCancel}>{t("取消")}</button>
      </div>
    </section>
  );
}

export default function App() {
  const language = useLanguage();
  const [project, setProject] = useState<LocalProject>(createEmptyProject);
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
  const lastStainProfile = useRef<StainProfileId>('h_eosin');
  const userLoadedRef = useRef(false);
  const [projectGaps, setProjectGaps] = useState<string[]>([]);
  const [modelReload, setModelReload] = useState<ProjectView | null>(null);
  const analyzedProjectRef = useRef<LocalProject | null>(null);
  const snapshotRef = useRef<{ project: LocalProject; analysis: AnalysisResult | null; view: ProjectView } | null>(null);
  snapshotRef.current = { project, analysis: analyzedProjectRef.current && ['pixels', 'rois', 'profileId', 'threshold', 'segmentation', 'calibration', 'coloc', 'stainOverrides'].every((key) => analyzedProjectRef.current![key as keyof LocalProject] === project[key as keyof LocalProject]) ? analysis : null, view: { showOverlay, statsMetric, lastStainProfile: lastStainProfile.current, modelName: aiModelName ?? modelReload?.modelName ?? null, modelRequested: aiUseState || Boolean(modelReload?.modelRequested) } };


  useEffect(() => {
    void (async () => {
      try {
        const saved = await get<LocalProject>(STORAGE_KEY);
        if (userLoadedRef.current) return;
        if (saved?.version === 1 && (saved.pixels instanceof ImageData || saved.pixels === null)) {
          if (saved.restoredView) {
            setShowOverlay(saved.restoredView.showOverlay); setStatsMetric(saved.restoredView.statsMetric); setModelReload(saved.restoredView);
          }
          if (sceneForProfile(saved.profileId) === 'stain') lastStainProfile.current = saved.profileId;
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
      void set(STORAGE_KEY, { ...project, restoredView: snapshotRef.current?.view });
    }, 600);
    return () => window.clearTimeout(saveTimer.current);
  }, [project, loaded, showOverlay, statsMetric, aiModelName, aiUseState]);

  const { pixels, rois, profileId, threshold, segmentation, calibration, coloc } = project;
  const stainOverride = project.stainOverrides[profileId] ?? null;
  useEffect(() => {
    if (!pixels) {
      setAnalysis(null);
      setAnalyzing(false);
      return;
    }
    setAnalyzing(true);
    let active = true;
    const timer = window.setTimeout(() => {
      const ai = {
        useAi: useAiRef.current && aiModelRef.current !== null,
        model:
          useAiRef.current && aiModelRef.current && lastLoadedModelRef.current !== aiModelRef.current.name
            ? aiModelRef.current
            : null,
      };
      void runAnalysis(pixels, rois, profileId, threshold, segmentation, calibration, coloc, stainOverride, ai).then((result) => {
        if (!active) return;
        if (result.aiModelLoaded) lastLoadedModelRef.current = result.aiModelLoaded;
        setAiActive(result.aiUsed);
        analyzedProjectRef.current = project;
        setAnalysis(result);
        setAnalyzing(false);
      });
    }, 400);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [pixels, rois, profileId, threshold, segmentation, calibration, coloc, stainOverride, aiNonce]);

  const handleFile = useCallback(async (file: File) => {
    userLoadedRef.current = true;
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
        sources: { ...(prev.sources ?? emptySources()), main: file },
        restoredAnalysis: null,
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
          sources: { ...(prev.sources ?? emptySources()), control: file },
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
  const busyRef = useRef(false);
  busyRef.current = status.kind === 'busy' || calibrating || Boolean(batch?.running);
  useEffect(() => {
    let mounted = true;
    const dispose = connectProjectAdapter({
    tool: 'pathology',
    exportProject: async () => {
      if (busyRef.current) throw new Error(t('请等待当前导入或批处理完成'));
      const state = snapshotRef.current!;
      const result = await exportPathologyProject(state.project, state.view, state.analysis);
      return { blob: result.blob, name: `${(state.project.image?.name ?? 'Pathology project').replace(/\.[^.]+$/, '')}.wisplab.zip`, format: 'wisplab-pathology-v1.zip', summaryTranslations: { zh: result.completeness.join('\n') || '包含原图、ROI、样本及设置', en: result.completeness.join('\n') || 'Includes source images, ROIs, samples and settings' }, summary: result.completeness.length ? result.completeness.join('\n') : '包含原图、ROI、样本及设置 / Includes source images, ROIs, samples and settings' };
    },
    importProject: async (blob, options) => {
      const before = snapshotRef.current!;
      const current = () => mounted && options?.isCurrent?.() !== false && before.project === snapshotRef.current?.project && JSON.stringify(before.view) === JSON.stringify(snapshotRef.current?.view);
      const result = await importPathologyProject(blob);
      if (!current()) throw new DOMException('Cancelled', 'AbortError');
      if (busyRef.current) throw new Error(t('请等待当前导入或批处理完成'));
      if (!window.confirm(t('打开此版本会替换当前工作内容，是否继续？') + (result.completeness.length ? '\n\n' + result.completeness.join('\n') : ''))) throw new DOMException('Cancelled', 'AbortError');
      if (!current()) throw new DOMException('Cancelled', 'AbortError');
      userLoadedRef.current = true;
      aiModelRef.current = null; lastLoadedModelRef.current = null; useAiRef.current = false;
      setAiModelName(null); setAiUseState(false); setAiActive(false); setModelReload(result.view);
      lastStainProfile.current = result.view.lastStainProfile;
      setProject({ ...result.project, restoredView: result.view }); setAnalysis(null); setShowOverlay(result.view.showOverlay); setStatsMetric(result.view.statsMetric);
      setDrawMode('none'); setPendingLinePx(null); setProjectGaps(result.completeness); setLoaded(true); setAiNonce((n) => n + 1);
      setStatus({ kind: 'ok', message: '项目已恢复；历史缺失附件不会自动补全。' });
    },
    });
    return () => { mounted = false; dispose(); };
  }, []);

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
      const sampleSettings = { ...analysisSettings(project), rois: [] };
      const controlSource = project.sources?.control ?? null;
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
          const sampleId = crypto.randomUUID();
          setProject((prev) => ({
            ...prev,
            sources: { ...(prev.sources ?? emptySources()), samples: { ...prev.sources?.samples, [sampleId]: { image: file, control: controlSource, settings: sampleSettings, analysis: savedAnalysis(result), modelName: result.aiModelLoaded } } },
            samples: [
              ...prev.samples,
              {
                id: sampleId,
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
    [project],
  );

  const clearImage = useCallback(() => {
    userLoadedRef.current = true; setProjectGaps([]); setModelReload(null);
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
    const sampleId = crypto.randomUUID();
    setProject((prev) => ({
      ...prev,
      sources: { ...(prev.sources ?? emptySources()), samples: { ...prev.sources?.samples, [sampleId]: { image: prev.sources?.main ?? null, control: prev.sources?.control ?? null, settings: analysisSettings(prev), analysis: savedAnalysis(analysis), modelName: analysis.aiModelLoaded } } },
      samples: [
        ...prev.samples,
        {
          id: sampleId,
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
  const scene = sceneForProfile(project.profileId);
  const activeProfile = getStainProfile(project.profileId);
  const switchingDisabled = !loaded || status.kind === 'busy' || calibrating || Boolean(batch?.running);

  function selectProfile(nextProfile: StainProfileId) {
    if (nextProfile === project.profileId) return;
    if (sceneForProfile(nextProfile) === 'stain') lastStainProfile.current = nextProfile;
    setAnalysis(null);
    setProject((prev) => ({ ...prev, profileId: nextProfile }));
  }

  function selectScene(nextScene: AnalysisScene) {
    const nextProfile = nextScene === 'ihc' ? 'h_dab' : nextScene === 'if' ? 'if_coloc' : lastStainProfile.current;
    selectProfile(nextProfile);
  }

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
      <div className="wisplab-platform-bar">
        <a className="wisplab-platform-brand" href={withLanguage(platformHome)}>
          {t("WispLab实验数据分析平台")}
        </a>
      </div>
      {projectGaps.length > 0 && <section className="panel" role="status"><strong>{t('项目完整性说明')}</strong><ul>{projectGaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul></section>}
      {modelReload?.modelName && <section className="panel" role="status">{t('项目使用过 AI 模型，请重新载入本机模型后复核结果。')} {modelReload.modelName}</section>}
      <header className="app-header">
        <a className="app-brand" href={withLanguage("./")} aria-label={t("Pathology Workbench 病理工作台")}>
          <span className="brand-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m8 3 6 6-4 4-6-6zM7 10l-2 2m7-1 2 2M9 19h10M5 21h16M14 5a8 8 0 0 1 4 14M7 16h5" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
          <span><h1>{t("病理工作台")}</h1><span className="app-subtitle">Pathology Workbench</span></span>
        </a>
        <nav className="suite-nav" aria-label={t("科研工作台导航")}>
          {isWispLab && <a href={withLanguage(platformHome)}>{t("总首页")}</a>}
          <a href={withLanguage(suiteLinks.wb)}>WB <span>{t("条带分析")}</span></a>
          <a href={withLanguage(suiteLinks.pathology)} aria-current="page">{t("病理 ")}<span>{t("图像定量")}</span></a>
          <a href={withLanguage(suiteLinks.pcr)}>PCR <span>{t("表达分析")}</span></a>
        </nav>
        <div className="header-meta">
          <div className="language-switch" role="group" aria-label={language === 'en' ? 'Language' : '语言'}>
            <button type="button" lang="zh-CN" aria-pressed={language === 'zh'} onClick={() => setLanguage('zh')}>中文</button>
            <button type="button" lang="en" aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>EN</button>
          </div>
          <span className="local-badge"><span aria-hidden="true"/>{t("本机分析 · 云端保存可选")}</span>
          {status.message && (
            <span className={`status status-${status.kind}`} role="status">{tError(status.message)}</span>
          )}
        </div>
      </header>
      <SceneSelector scene={scene} disabled={switchingDisabled} onChange={selectScene} />
      <main className="app-main">
        <div className="canvas-column">
          <div className="workspace-heading"><div><p className="section-eyebrow">{t("图像工作区")}</p><h2>{t("图像与定量结果")}</h2></div><span className="profile-badge">{t(getStainProfile(project.profileId).label)}</span></div>
          <UploadPanel
            busy={status.kind === 'busy'}
            prompt={isColoc ? t('拖入 RGB 荧光图像，开始共定位分析') : t(`拖入 ${scene === 'ihc' ? 'H-DAB' : project.profileId === 'masson' ? 'Masson' : 'H&E'} 图像，开始分析`)}
            onFile={(file) => void handleFile(file)}
          />
          <CanvasView
            pixels={project.pixels}
            rois={project.rois}
            overlay={showOverlay ? analysis?.overlay ?? null : null}
            drawRoi={drawMode === 'roi'}
            drawLine={drawMode === 'line'}
            onRoiDrawn={handleRoiDrawn}
            onLineDrawn={setPendingLinePx}
          />
          <div className="workspace-caption"><span>{project.image ? project.image.name : t('支持病理染色、免疫组化与免疫荧光图像')}</span><span>{t("滚轮缩放 · 拖动平移")}</span></div>
          <div className="analysis-results"><ResultsPanel result={analysis} running={analyzing} hasImage={hasImage} /></div>
        </div>
        <aside className="side-panel">
          <div className="settings-heading"><div><p className="section-eyebrow">{t("分析设置")}</p><h2>{t("分析设置")}</h2></div><span>{t("调整后自动计算")}</span></div>
          <section className="panel">
            <h3>{isColoc ? t('分析任务') : t('染色预设')}</h3>
            {scene === 'stain' ? <div className="profile-grid">
              {STAIN_PROFILES.filter((profile) => sceneForProfile(profile.id) === 'stain').map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  title={t(profile.description)}
                  className={project.profileId === profile.id ? 'profile-active' : ''}
                  aria-pressed={project.profileId === profile.id}
                  disabled={switchingDisabled}
                  onClick={() => selectProfile(profile.id)}
                >
                  {t(profile.label)}
                </button>
              ))}
            </div> : <p className="active-preset">{isColoc ? t('双通道共定位') : t(activeProfile.label)}</p>}
            <p className="panel-note preset-description">{t(activeProfile.description)}</p>
          </section>
          <InfoPanel
            image={project.image}
            calibration={project.calibration}
            onMppChange={(mpp) => setProject((prev) => ({ ...prev, calibration: { mpp } }))}
            onClear={clearImage}
          />
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
              key={`params-${scene}`}
              collapseSegmentation={scene === 'stain'}
              threshold={project.threshold}
              segmentation={project.segmentation}
              quantifyLabel={t(getStainProfile(project.profileId).quantifyLabel)}
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
            <details key={`ai-${scene}`} className="panel panel-disclosure" open={scene === 'ihc'}>
              <summary>{t("AI 核分割（可选）")}{aiUseState && t(' · 已启用')}</summary>
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
                  setModelReload(null);
                  lastLoadedModelRef.current = null; // 强制下次请求装载
                  setAiModelName(file.name);
                  useAiRef.current = true;
                  setAiUseState(true);
                  setAiNonce((n) => n + 1); // 触发重分析
                });
              }}
            />
            </details>
          )}
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
