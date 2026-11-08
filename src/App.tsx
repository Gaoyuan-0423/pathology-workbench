import { connectProjectAdapter } from './project-archive';
import { analysisSettings, emptySources, exportPathologyProject, importPathologyProject, savedAnalysis, type LocalProject, type ProjectView } from './project-io';
import { tError, t, useLanguage, setLanguage, withLanguage } from './i18n.ts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { get, set } from 'idb-keyval';
import { runAnalysis } from './core/analysis-client.ts';
import { analysisIdentity, currentAnalysis, finishAnalysis, modelContentId, sameAnalysisIdentity, startAnalysis, type AnalysisRun } from './core/analysis-validity.ts';
import { sourceContentId } from './core/source-identity.ts';
import { evaluateDiagnostics } from './core/advisor.ts';
import { generateMethodsEn, generateMethodsZh } from './core/methods.ts';
import { ifReportData, sampleStatistics } from './core/api.ts';
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
  type ColocConfig,
  type Roi,
  type MetricKey,
  type SampleRecord,
  type IfSampleRecord,
  type PathologyExperimentalDesign,
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
import IfSamplesPanel from './ui/IfSamplesPanel.tsx';
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
  const [analysisRun, setAnalysisRun] = useState<AnalysisRun | null>(null);
  const analysisTicket = useRef(0);
  const [showOverlay, setShowOverlay] = useState(true);
  const [drawMode, setDrawMode] = useState<DrawMode>('none');
  const [calibrating, setCalibrating] = useState(false);
  const [pendingLinePx, setPendingLinePx] = useState<number | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const aiModelRef = useRef<{ name: string; id: string; bytes: ArrayBuffer } | null>(null);
  const modelSelection = useRef(0);
  const [modelLoading, setModelLoading] = useState(false);
  const [aiModelId, setAiModelId] = useState<string | null>(null);
  const [aiModelName, setAiModelName] = useState<string | null>(null);
  const [aiUseState, setAiUseState] = useState(false);
  const [aiNonce, setAiNonce] = useState(0);
  const [statsMetric, setStatsMetric] = useState<MetricKey>('positiveFraction');
  const [addingSample, setAddingSample] = useState(false);
  const [resolvingSources, setResolvingSources] = useState(false);
  const lastStainProfile = useRef<StainProfileId>('h_eosin');
  const userLoadedRef = useRef(false);
  const [projectGaps, setProjectGaps] = useState<string[]>([]);
  const [modelReload, setModelReload] = useState<ProjectView | null>(null);
  const view: ProjectView = { showOverlay, statsMetric, lastStainProfile: lastStainProfile.current, modelName: aiModelName ?? modelReload?.modelName ?? null, modelId: aiModelId ?? modelReload?.modelId ?? null, modelRequested: aiUseState };
  const { pixels: identityPixels, settingsKey, modelRequested, modelId } = analysisIdentity(project, view);
  const identity = useMemo(() => ({ pixels: identityPixels, settingsKey, modelRequested, modelId }), [identityPixels, settingsKey, modelRequested, modelId]);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const analysis = currentAnalysis(analysisRun, identity);
  const currentFailure = analysisRun?.status === 'failed' && sameAnalysisIdentity(analysisRun.identity, identity) ? analysisRun.error : null;
  const analyzing = Boolean(project.pixels && !analysis && !currentFailure);
  const snapshotRef = useRef<{ project: LocalProject; run: AnalysisRun | null; view: ProjectView } | null>(null);
  snapshotRef.current = { project, run: analysisRun, view };


  useEffect(() => {
    void (async () => {
      try {
        const saved = await get<LocalProject>(STORAGE_KEY);
        if (userLoadedRef.current) return;
        if (saved?.version === 1 && (saved.pixels instanceof ImageData || saved.pixels === null)) {
          if (saved.restoredView) {
            setShowOverlay(saved.restoredView.showOverlay); setStatsMetric(saved.restoredView.statsMetric); setModelReload(saved.restoredView); setAiUseState(saved.restoredView.modelRequested);
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
      const state = snapshotRef.current!;
      const savedIdentity = analysisIdentity(state.project, state.view);
      const result = currentAnalysis(state.run, savedIdentity);
      void set(STORAGE_KEY, { ...state.project, restoredView: state.view, restoredAnalysis: savedAnalysis(result) });
    }, 600);
    return () => window.clearTimeout(saveTimer.current);
  }, [project, loaded, showOverlay, statsMetric, aiModelName, aiModelId, aiUseState, analysisRun]);

  const { pixels, rois, profileId, threshold, segmentation, calibration, coloc } = project;
  const stainOverride = project.stainOverrides[profileId] ?? null;
  useEffect(() => {
    if (!pixels) { setAnalysisRun(null); return; }
    const ticket = ++analysisTicket.current;
    const requestIdentity = identity;
    setAnalysisRun(startAnalysis(ticket, requestIdentity));
    if (modelLoading) return;
    const ai = { useAi: aiUseState, model: aiModelRef.current };
    if (ai.useAi && !ai.model && profileId !== 'if_coloc') {
      setAnalysisRun((run) => finishAnalysis(run, ticket, new Error('请重新载入 AI 模型或关闭 AI 后再分析。')));
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void runAnalysis(pixels, rois, profileId, threshold, segmentation, calibration, coloc, stainOverride, ai).then((result) => {
        if (!active || !sameAnalysisIdentity(requestIdentity, identityRef.current)) return;
        setAnalysisRun((run) => finishAnalysis(run, ticket, result));
      }).catch((error: unknown) => {
        if (!active || !sameAnalysisIdentity(requestIdentity, identityRef.current)) return;
        setAnalysisRun((run) => finishAnalysis(run, ticket, error instanceof Error ? error : new Error(String(error))));
      });
    }, 400);
    return () => { active = false; window.clearTimeout(timer); };
    // The value key includes every image/ROI/parameter field. Library/display
    // changes do not restart analysis; model content and toggle changes do.
  }, [identity, pixels, rois, profileId, threshold, segmentation, calibration, coloc, stainOverride, aiUseState, modelLoading, aiNonce]);


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
  const batchGeneration = useRef(0);
  const [batch, setBatch] = useState<BatchState | null>(null);
  const busyRef = useRef(false);
  busyRef.current = status.kind === 'busy' || calibrating || modelLoading || Boolean(batch?.running);
  useEffect(() => {
    let mounted = true;
    const dispose = connectProjectAdapter({
    tool: 'pathology',
    exportProject: async () => {
      if (busyRef.current) throw new Error(t('请等待当前导入或批处理完成'));
      const state = snapshotRef.current!;
      const result = await exportPathologyProject(state.project, state.view, state.run);
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
      modelSelection.current += 1; aiModelRef.current = null;
      setModelLoading(false); setAiModelId(null); setAiModelName(null); setAiUseState(result.view.modelRequested); setModelReload(result.view);
      lastStainProfile.current = result.view.lastStainProfile;
      setProject({ ...result.project, restoredView: result.view }); setAnalysisRun(null); setShowOverlay(result.view.showOverlay); setStatsMetric(result.view.statsMetric);
      setDrawMode('none'); setPendingLinePx(null); setProjectGaps(result.completeness); setLoaded(true); setAiNonce((n) => n + 1);
      setStatus({ kind: 'ok', message: '项目已恢复；历史缺失附件不会自动补全。' });
    },
    });
    return () => { mounted = false; dispose(); };
  }, []);

  const runBatch = useCallback(
    async (files: File[], group: string) => {
      const generation = ++batchGeneration.current;
      batchCancelRef.current = false;
      const cancelled = () => batchCancelRef.current || generation !== batchGeneration.current;
      const config = {
        profileId: project.profileId,
        threshold: project.threshold,
        segmentation: project.segmentation,
        calibration: project.calibration,
        coloc: project.coloc,
        stainOverride: project.stainOverrides[project.profileId] ?? null,
      };
      const batchAi = { useAi: aiUseState, model: aiModelRef.current };
      if (modelLoading || (batchAi.useAi && !batchAi.model)) {
        setStatus({ kind: 'error', message: '请重新载入 AI 模型或关闭 AI 后再分析。' });
        return;
      }
      const sampleSettings = { ...analysisSettings(project), rois: [] };
      const controlSource = project.sources?.control ?? null;
      const errors: string[] = [];
      let done = 0;
      setBatch({ running: true, total: files.length, done: 0, current: files[0]?.name ?? '', errors, cancelled: false });
      for (const file of files) {
        if (cancelled()) {
          if (generation !== batchGeneration.current) return;
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
            batchAi,
          );
          if (cancelled()) {
            if (generation !== batchGeneration.current) return;
            setBatch((prev) => prev && { ...prev, running: false, current: '', cancelled: true });
            setStatus({ kind: 'ok', message: `批处理已取消：完成 ${done}/${files.length}` });
            return;
          }
          const sampleId = crypto.randomUUID();
          const sourceId = await sourceContentId(file);
          if (cancelled()) {
            if (generation !== batchGeneration.current) return;
            setBatch((prev) => prev && { ...prev, running: false, current: '', cancelled: true });
            setStatus({ kind: 'ok', message: `批处理已取消：完成 ${done}/${files.length}` });
            return;
          }
          setProject((prev) => cancelled() ? prev : ({
            ...prev,
            experimentalDesign: prev.experimentalDesign ? { ...prev.experimentalDesign, confirmed: false } : undefined,
            sources: { ...(prev.sources ?? emptySources()), samples: { ...prev.sources?.samples, [sampleId]: { image: file, control: controlSource, settings: sampleSettings, analysis: savedAnalysis(result), modelName: result.aiModelLoaded } } },
            samples: [
              ...prev.samples,
              {
                id: sampleId,
                name: file.name.replace(/\.[^.]+$/, ''),
                group,
                imageName: file.name,
                sourceId,
                profileId: config.profileId,
                addedAt: Date.now(),
                metrics: result.overall,
              },
            ],
          }));
        } catch (error) {
          if (cancelled()) {
            if (generation !== batchGeneration.current) return;
            setBatch((prev) => prev && { ...prev, running: false, current: '', cancelled: true });
            setStatus({ kind: 'ok', message: `批处理已取消：完成 ${done}/${files.length}` });
            return;
          }
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
    [project, aiUseState, modelLoading],
  );

  const clearImage = useCallback(() => {
    batchGeneration.current += 1; batchCancelRef.current = true; setBatch(null);
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

  const addSample = useCallback(async (group: string) => {
    const state = snapshotRef.current!;
    const result = currentAnalysis(state.run, analysisIdentity(state.project, state.view));
    if (!result || !state.project.image || state.project.profileId === 'if_coloc') return;
    setAddingSample(true);
    try {
      const sourceId = state.project.sources?.main ? await sourceContentId(state.project.sources.main) : undefined;
      const latest = snapshotRef.current!;
      if (!currentAnalysis(state.run, analysisIdentity(latest.project, latest.view))) {
        setStatus({ kind: 'error', message: '分析输入或模型已改变，本次未加入样本；请等待当前结果后重试。' });
        return;
      }
      const sampleId = crypto.randomUUID();
      setProject((prev) => {
      if (!currentAnalysis(state.run, analysisIdentity(prev, snapshotRef.current!.view))) return prev;
      return {
        ...prev,
        experimentalDesign: prev.experimentalDesign ? { ...prev.experimentalDesign, confirmed: false } : undefined,
        sources: { ...(prev.sources ?? emptySources()), samples: { ...prev.sources?.samples, [sampleId]: { image: state.project.sources?.main ?? null, control: state.project.sources?.control ?? null, settings: analysisSettings(state.project), analysis: savedAnalysis(result), modelName: result.aiModelLoaded } } },
        samples: [
          ...prev.samples,
          {
            id: sampleId,
            name: `S${prev.samples.length + 1} ${prev.image!.name}`,
            group,
            imageName: prev.image!.name,
            sourceId,
            profileId: prev.profileId,
            addedAt: Date.now(),
            metrics: result.overall,
          },
        ],
      };
      });
      setStatus({ kind: 'ok', message: `已加入样本库（分组：${group}）` });
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally { setAddingSample(false); }
  }, []);

  const addIfSample = useCallback(async (group: string) => {
    const state = snapshotRef.current!;
    const result = currentAnalysis(state.run, analysisIdentity(state.project, state.view));
    if (!result?.ifAnalysis || !state.project.image || state.project.profileId !== 'if_coloc') return;
    setAddingSample(true);
    try {
      const sourceId = state.project.sources?.main ? await sourceContentId(state.project.sources.main) : 'unknown';
      const latest = snapshotRef.current!;
      if (!currentAnalysis(state.run, analysisIdentity(latest.project, latest.view))) {
        setStatus({ kind: 'error', message: '分析输入或模型已改变，本次未加入样本；请等待当前结果后重试。' });
        return;
      }
      const id = crypto.randomUUID();
      const record: IfSampleRecord = { id, name: `IF${(state.project.ifSamples?.length ?? 0) + 1} ${state.project.image.name}`, group,
        imageName: state.project.image.name, addedAt: Date.now(), sourceId, profileId: 'if_coloc',
        image: { ...state.project.image }, config: { ...state.project.coloc }, analysis: result.ifAnalysis };
      setProject((prev) => currentAnalysis(state.run, analysisIdentity(prev, snapshotRef.current!.view)) ? {
        ...prev, ifSamples: [...(prev.ifSamples ?? []), record],
        ifExperimentalDesign: prev.ifExperimentalDesign ? { ...prev.ifExperimentalDesign, confirmed: false } : undefined,
        sources: { ...(prev.sources ?? emptySources()), samples: { ...prev.sources?.samples,
          [id]: { image: state.project.sources?.main ?? null, control: null, settings: analysisSettings(state.project), analysis: savedAnalysis(result), modelName: null } } },
      } : prev);
      setStatus({ kind: 'ok', message: '已保存 IF 整图与 ROI 结果。' });
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally { setAddingSample(false); }
  }, []);

  const restoreIfSample = useCallback(async (id: string) => {
    const before = snapshotRef.current!;
    const record = before.project.ifSamples?.find((sample) => sample.id === id);
    const source = before.project.sources?.samples[id];
    if (!record || !source?.image) return;
    setStatus({ kind: 'busy', message: '正在载入 IF 记录并准备复算…' });
    try {
      if (record.sourceId.startsWith('sha256:') && record.sourceId !== await sourceContentId(source.image)) throw new Error('原图内容与 IF 记录的来源身份不一致。');
      const decoded = await decodeImageFile(source.image);
      if (['sourceWidth', 'sourceHeight', 'workingWidth', 'workingHeight', 'bitsPerSample', 'workingScale'].some((key) => decoded[key as keyof typeof decoded] !== record.image[key as keyof typeof record.image])) throw new Error('解码尺寸或精度与保存的 IF 记录不一致。');
      if (before.project !== snapshotRef.current?.project || JSON.stringify(before.view) !== JSON.stringify(snapshotRef.current?.view)) {
        setStatus({ kind: 'error', message: '当前工作已改变，本次未载入 IF 记录。' });
        return;
      }
      userLoadedRef.current = true;
      setAnalysisRun(null); setAiUseState(false);
      setProject((prev) => ({ ...prev, ...source.settings, profileId: 'if_coloc', coloc: { ...record.config },
        image: { ...record.image }, pixels: decoded.pixels, restoredAnalysis: null,
        sources: { ...(prev.sources ?? emptySources()), main: source.image, control: null } }));
      setDrawMode('none'); setPendingLinePx(null);
      setStatus({ kind: 'ok', message: '已载入 IF 原图与历史配置，正在重新计算。' });
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  const updateSample = useCallback((id: string, patch: Partial<SampleRecord>) => {
    setProject((prev) => ({
      ...prev,
      experimentalDesign: prev.experimentalDesign ? { ...prev.experimentalDesign, confirmed: false,
        assignments: prev.experimentalDesign.assignments.map((a) => a.sampleId === id && patch.group !== undefined ? { ...a, group: patch.group } : a) } : undefined,
      samples: prev.samples.map((sample) => (sample.id === id ? { ...sample, ...patch } : sample)),
    }));
  }, []);

  const updateDesign = useCallback((design: PathologyExperimentalDesign) => {
    setProject((prev) => ({ ...prev, experimentalDesign: design,
      samples: prev.samples.map((sample) => {
        const assignment = design.assignments.find((a) => a.sampleId === sample.id);
        return assignment ? { ...sample, group: assignment.group } : sample;
      }) }));
  }, []);

  const resolveSources = useCallback(async () => {
    const state = snapshotRef.current!;
    setResolvingSources(true);
    try {
      const patches = await Promise.all(state.project.samples.map(async (sample) => {
        const source = state.project.sources?.samples[sample.id];
        return { id: sample.id, sourceId: source?.image ? await sourceContentId(source.image) : sample.sourceId,
          profileId: source?.settings.profileId ?? sample.profileId };
      }));
      setProject((prev) => {
        if (prev.sources !== state.project.sources) return prev;
        return { ...prev, experimentalDesign: prev.experimentalDesign ? { ...prev.experimentalDesign, confirmed: false } : undefined,
          samples: prev.samples.map((sample) => {
            const patch = patches.find((p) => p.id === sample.id);
            return patch ? { ...sample, ...patch } : sample;
          }) };
      });
      setStatus({ kind: 'ok', message: '已核对保存的来源；缺少原图或历史设置的记录仍标为未知。' });
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally { setResolvingSources(false); }
  }, []);

  const hasImage = Boolean(project.pixels);
  const isColoc = project.profileId === 'if_coloc';
  const scene = sceneForProfile(project.profileId);
  const activeProfile = getStainProfile(project.profileId);
  const switchingDisabled = !loaded || status.kind === 'busy' || calibrating || Boolean(batch?.running);

  function selectProfile(nextProfile: StainProfileId) {
    if (nextProfile === project.profileId) return;
    if (sceneForProfile(nextProfile) === 'stain') lastStainProfile.current = nextProfile;
    setAnalysisRun(null);
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
      const unitStatistics = sampleStatistics(project.samples, statsMetric, project.experimentalDesign);
      const stats = unitStatistics.inference ? unitStatistics.report : null;
      const diagnostics = evaluateDiagnostics({ project, result: analysis, qc: analysis?.qc ?? null, statsReport: stats });
      return {
        generatedAt: new Date().toISOString(),
        analysisStatus: analysis ? 'ready' : currentFailure ? 'failed' : hasImage ? 'pending' : 'empty',
        parameters: { ...analysisSettings(project), aiRequested: view.modelRequested, aiModelId: view.modelId, aiUsed: analysis?.aiUsed ?? null },
        image: project.image,
        profile: project.profileId,
        metrics: project.profileId === 'if_coloc' ? null : analysis?.overall ?? null,
        ...ifReportData(project, analysis),
        samples: project.samples.map((sample) => ({
          ...sample,
          metrics: sample.profileId === 'if_coloc' ? null : sample.metrics,
          metricStatus: sample.profileId === 'if_coloc' ? 'unsupported_if_sample_metrics' : 'recorded',
        })),
        statistics: stats,
        experimentalDesign: project.experimentalDesign ?? null,
        sampleStatistics: unitStatistics,
        diagnostics,
        methods: { zh: generateMethodsZh(project, analysis, statsMetric), en: generateMethodsEn(project, analysis, statsMetric) },
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
          {t("WispLab实验数据分析")}
        </a>
      </div>
      {projectGaps.length > 0 && <details className="panel project-gaps" role="status"><summary>{t('项目完整性说明')} ({projectGaps.length})</summary><ul>{projectGaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul></details>}
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
          <span className="local-badge"><span aria-hidden="true"/>{t("本机分析 · 本地项目保存")}</span>
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
          {hasImage && !analysis && <div className="analysis-state" aria-live="polite">
            <p>{t(currentFailure ? '分析失败，当前结果不可用。请重试或调整设置。' : '输入或设置已改变，当前结果正在重新计算；完成前不可保存为样本或导出当前结果。')}</p>
            {currentFailure && <><p>{tError(currentFailure)}</p><button type="button" onClick={() => setAiNonce((n) => n + 1)}>{t('重新分析')}</button></>}
          </div>}
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
              modelName={aiModelName ?? modelReload?.modelName ?? null}
              aiActive={analysis?.aiUsed ?? false}
              useAi={aiUseState}
              onUseAiChange={(value) => {
                setAiUseState(value);
              }}
              onModelFile={(file) => {
                const selection = ++modelSelection.current;
                aiModelRef.current = null;
                setModelReload(null); setAiModelId(null); setAiModelName(file.name);
                setAiUseState(true); setModelLoading(true);
                void (async () => {
                  try {
                    const bytes = await file.arrayBuffer();
                    const id = await modelContentId(bytes);
                    if (selection !== modelSelection.current) return;
                    aiModelRef.current = { name: file.name, id, bytes };
                    setAiModelId(id);
                  } catch (error) {
                    if (selection !== modelSelection.current) return;
                    setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
                  } finally {
                    if (selection === modelSelection.current) setModelLoading(false);
                  }
                })();
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
            canAddSample={Boolean(analysis) && !isColoc && !addingSample}
            disabled={analyzing}
            onAddSample={addSample}
            onUpdateSample={updateSample}
            onDesignChange={updateDesign}
            onResolveSources={resolveSources}
            resolvingSources={resolvingSources}
            onDeleteSample={(id) =>
              setProject((prev) => ({ ...prev,
                experimentalDesign: prev.experimentalDesign ? { ...prev.experimentalDesign, confirmed: false,
                  assignments: prev.experimentalDesign.assignments.filter((a) => a.sampleId !== id) } : undefined,
                samples: prev.samples.filter((s) => s.id !== id) }))
            }
            onStatus={(message, kind) => setStatus({ kind, message })}
            analysisResult={analysis}
            onStatsMetricChange={setStatsMetric}
          />
          {(isColoc || (project.ifSamples?.length ?? 0) > 0) && <IfSamplesPanel project={project} result={analysis} saving={addingSample}
            busy={analyzing || status.kind === 'busy'} onSave={addIfSample} onRestore={restoreIfSample}
            canRestore={(id) => Boolean(project.sources?.samples[id]?.image)}
            onDesign={(design) => setProject((prev) => ({ ...prev, ifExperimentalDesign: design }))}
            onUpdate={(id, patch) => setProject((prev) => ({ ...prev,
              ifExperimentalDesign: prev.ifExperimentalDesign ? { ...prev.ifExperimentalDesign, confirmed: false,
                assignments: prev.ifExperimentalDesign.assignments.map((a) => a.sampleId === id && patch.group !== undefined ? { ...a, group: patch.group } : a) } : undefined,
              ifSamples: prev.ifSamples?.map((record) => record.id === id ? { ...record, ...patch } : record) }))}
            onDelete={(id) => setProject((prev) => ({ ...prev,
              ifExperimentalDesign: prev.ifExperimentalDesign ? { ...prev.ifExperimentalDesign, confirmed: false,
                assignments: prev.ifExperimentalDesign.assignments.filter((a) => a.sampleId !== id) } : undefined,
              ifSamples: prev.ifSamples?.filter((record) => record.id !== id) }))} />}
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
