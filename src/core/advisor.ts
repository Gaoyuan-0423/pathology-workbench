/**
 * 诊断顾问：对分析配置与结果做体检，输出分级问题与优化方向。
 * 规则全部可解释（无黑盒打分），每条 suggestion 给出可操作动作。
 */
import type { AnalysisResult, IfUndefinedReason, ProjectState, RoiMetrics } from './types.ts';
import type { AnalysisQc } from './types.ts';
import { ifSampleStatistics } from './if-statistics.ts';

export type Severity = 'error' | 'warn' | 'info' | 'ok';

export interface DiagnosticIssue {
  severity: Severity;
  category: '图像质量' | '阈值' | '核分割' | '工作流' | '统计';
  message: string;
  /** 优化方向（可操作动作） */
  suggestion?: string;
}

export interface DiagnosticsReport {
  issues: DiagnosticIssue[];
  /** 总评（一句话） */
  summary: string;
  /** 0–100 体检分 */
  score: number;
}

export interface AdvisorContext {
  project: ProjectState;
  /** 当前图像分析结果（染色或共定位） */
  result: AnalysisResult | null;
  /** 引擎 QC 指标（染色预设分析时存在） */
  qc: AnalysisQc | null;
  /** 样本库组间统计（存在时参与统计体检） */
  statsReport: import('./analysis/statistics.ts').GroupStatsReport | null;
}

const IF_UNDEFINED_MESSAGES: Record<IfUndefinedReason, string> = {
  pearson_all_insufficient_pixels: '全像素 Pearson：有效像素少于 2 个。',
  pearson_all_zero_variance: '全像素 Pearson：至少一个通道为零方差。',
  pearson_masked_insufficient_pixels: '掩膜 Pearson：并集内像素少于 2 个。',
  pearson_masked_zero_variance: '掩膜 Pearson：至少一个通道为零方差。',
  manders_m1_zero_denominator: 'Manders M1：区域 A 总强度为零。',
  manders_m2_zero_denominator: 'Manders M2：区域 B 总强度为零。',
};

export function evaluateDiagnostics(ctx: AdvisorContext): DiagnosticsReport {
  const issues: DiagnosticIssue[] = [];
  const { project, result, qc, statsReport } = ctx;
  const isColoc = project.profileId === 'if_coloc';
  // External stain reports cannot authorize IF inference.
  const ifStats = isColoc ? ifSampleStatistics(project.ifSamples ?? [], project.ifExperimentalDesign) : null;
  const activeStatsReport = ifStats?.report ?? statsReport;

  // ── 图像质量 ──
  if (project.image) {
    const longest = Math.max(project.image.workingWidth, project.image.workingHeight);
    if (longest < 400) {
      issues.push({
        severity: 'warn',
        category: '图像质量',
        message: `工作图最长边仅 ${longest} px`,
        suggestion: isColoc
          ? '工作图像素较少可能限制空间细节；请核对原始采集分辨率和 ROI 内有效像素数，放大图像不会增加独立信息。'
          : '分辨率过低会限制核分割精度；建议使用 ≥1200 px 的原始图像。',
      });
    }
    if (!isColoc && qc && qc.saturatedFraction > 0.05) {
      issues.push({
        severity: 'warn',
        category: '图像质量',
        message: `饱和像素占比 ${(qc.saturatedFraction * 100).toFixed(1)}%`,
        suggestion: '高光饱和丢失光密度信息；建议降低采集曝光或扫描亮度后重新导出。',
      });
    }
    if (!isColoc && qc && qc.tissueFraction < 0.08) {
      issues.push({
        severity: 'info',
        category: '图像质量',
        message: `组织占比仅 ${(qc.tissueFraction * 100).toFixed(1)}%`,
        suggestion: '大部分画面是空白背景；建议框选 ROI 只分析组织区域，避免稀释阳性面积。',
      });
    }
  }

  // ── 阈值 ──
  if (!isColoc && result) {
    const positive = result.overall.positiveFraction;
    if (positive > 0.6) {
      issues.push({
        severity: 'warn',
        category: '阈值',
        message: `阳性面积 ${(positive * 100).toFixed(1)}% 异常偏高`,
        suggestion: '阈值可能过松（或图像大面积强阳性）。建议切换手动模式微调，并对照叠加层确认 specificity。',
      });
    } else if (positive < 0.003 && result.overall.pixelCount > 10000) {
      issues.push({
        severity: 'warn',
        category: '阈值',
        message: `阳性面积 ${(positive * 100).toFixed(2)}% 接近于零`,
        suggestion: '阈值可能过严或染色失败；建议切换 Otsu 自动并查看直方图分离度。',
      });
    }
    if (qc && qc.otsuSeparation < 0.35 && project.threshold.mode === 'auto') {
      issues.push({
        severity: 'warn',
        category: '阈值',
        message: `直方图分离度低（${qc.otsuSeparation.toFixed(2)}），Otsu 阈值不可靠`,
        suggestion: '阳性与背景在 OD 直方图上未形成双峰；建议导入未染色对照片做阈值标定，或改手动模式。',
      });
    }
    if (project.profileId === 'h_dab' && result.thresholdUsed < result.nuclearThresholdUsed) {
      issues.push({
        severity: 'warn',
        category: '阈值',
        message: `DAB 定量阈值（${result.thresholdUsed}）低于核复染阈值（${result.nuclearThresholdUsed}）`,
        suggestion: '淡染细胞核会被误计为 DAB 阳性，labeling index 系统性偏高；建议提高阳性阈值（手动模式或对照片标定）后复核。',
      });
    }
    if (project.threshold.mode === 'control' && project.threshold.controlThreshold === null) {
      issues.push({
        severity: 'warn',
        category: '阈值',
        message: '选择了对照片模式但尚未标定',
        suggestion: '导入未染色对照片完成标定（按允许假阳率自动定阈），可统一批内阈值。',
      });
    }
    if (project.threshold.mode !== 'control' && !isColoc) {
      issues.push({
        severity: 'info',
        category: '阈值',
        message: '未使用对照片标定',
        suggestion: '批间比较时建议对每组导入一张未染色对照片做阈值统一，消除批间漂移。',
      });
    }
  }

  // ── 核分割 ──
  if (!isColoc && result) {
    const { overall } = result;
    if (overall.totalNuclei === 0) {
      issues.push({
        severity: qc && qc.rejectedByArea + qc.rejectedByCircularity > 0 ? 'warn' : 'info',
        category: '核分割',
        message: '未检出任何细胞核',
        suggestion: '若图像确有细胞核：检查第一染色通道对比度、放宽最小面积/圆度门控，或启用 AI 核分割。',
      });
    }
    if (qc && qc.rejectedByArea + qc.rejectedByCircularity > 0 && overall.totalNuclei > 0) {
      const rejectedShare = (qc.rejectedByArea + qc.rejectedByCircularity) /
        (qc.rejectedByArea + qc.rejectedByCircularity + overall.totalNuclei);
      if (rejectedShare > 0.4) {
        issues.push({
          severity: 'info',
          category: '核分割',
          message: `${Math.round(rejectedShare * 100)}% 的分割目标被门控滤除`,
          suggestion: '面积/圆度门控偏严。若被滤除的是碎片噪声可保持；若怀疑误删真核，请放宽最小面积并查看掩膜叠加。',
        });
      }
    }
    if (qc && qc.borderFraction > 0.3 && overall.totalNuclei > 0) {
      issues.push({
        severity: 'info',
        category: '核分割',
        message: `${Math.round(qc.borderFraction * 100)}% 的核与视野边界相交`,
        suggestion: '触边比例高时计数偏差大；建议框选不贴边的 ROI，软件已按 n+b·n/(n+b) 折算修正。',
      });
    }
    if (project.calibration.mpp === null) {
      issues.push({
        severity: 'info',
        category: '工作流',
        message: '未标定像素尺寸',
        suggestion: '在图像信息中输入 μm/px（或用画标尺线标定），即可输出细胞密度（个/mm²）。',
      });
    }
  }

  // ── IF 共定位 ──
  if (isColoc && result) {
    const canonical = result.ifAnalysis;
    const measurement = canonical?.overall ?? result.coloc;
    if (canonical) {
      const undefinedReasons = new Set([canonical.overall, ...canonical.perRoi].flatMap((region) => region.undefinedReasons));
      for (const reason of undefinedReasons) issues.push({ severity: 'info', category: '工作流', message: IF_UNDEFINED_MESSAGES[reason],
        suggestion: '请在 IF 区域结果中核对对应区域与原因；未定义系数保留为空，不解释为零相关或弱共定位。' });
    } else if (measurement && [measurement.pearsonAll, measurement.pearsonMasked, measurement.mandersM1, measurement.mandersM2].some((value) => value === null || !Number.isFinite(value))) {
      issues.push({ severity: 'info', category: '工作流', message: '旧格式 IF 结果含不可计算系数',
        suggestion: '旧结果未记录完整区域计数和未定义原因；请载入原图与配置复算，不把缺失值解释为零。' });
    }
    const pearsonAll = measurement?.pearsonAll;
    const pearsonMasked = measurement?.pearsonMasked;
    if (typeof pearsonAll === 'number' && Number.isFinite(pearsonAll) && typeof pearsonMasked === 'number' && Number.isFinite(pearsonMasked)
      && Math.abs(pearsonAll) > 0.3 && pearsonAll * pearsonMasked < 0) {
      issues.push({
        severity: 'warn',
        category: '阈值',
        message: '掩膜 Pearson 与全像素 Pearson 符号相反',
        suggestion: '两种 Pearson 使用不同像素集合；符号差异不能证明背景主导。请核对通道、并集掩膜和实验对照，并按预声明口径报告。',
      });
    }
    if (typeof pearsonMasked === 'number' && Number.isFinite(pearsonMasked) && Math.abs(pearsonMasked) < 0.2) {
      issues.push({
        severity: 'info',
        category: '统计',
        message: `掩膜 Pearson 为 ${pearsonMasked.toFixed(3)}，所选像素的线性相关接近零`,
        suggestion: '该系数不能单独判断生物学共定位。请结合实验对照核对通道和掩膜，按预先确定的规则设置阈值并记录敏感性分析。',
      });
    }
  }

  // ── 统计 ──
  if (isColoc && (project.image || result || (project.ifSamples?.length ?? 0) > 0)) {
    issues.push({ severity: 'info', category: '工作流',
      message: ifStats!.inference ? 'IF 组间检验基于已确认的独立单位' : 'IF 当前仅提供描述统计',
      suggestion: ifStats!.inference
        ? '按所选指标与区域规则汇总至独立单位后检验；ROI、像素和记录数量不是 nBio。确认设计只记录实验者声明，不证明抽样独立性或科学结论有效。'
        : '保存原始区域结果并核对 IF 指标、所选 ROI、来源、视野、切片、独立单位及分组；设计未确认、存在冲突或可用单位不足时不提供 IF 组间推断。' });
    for (const issue of ifStats!.aggregation.issues) {
      issues.push({ severity: ifStats!.aggregation.designStatus === 'invalid' ? 'warn' : 'info', category: '统计', message: issue.message });
    }
    if (ifStats!.report.recommendation) issues.push({ severity: 'info', category: '统计', message: ifStats!.report.recommendation });
  }
  if (activeStatsReport?.designStatus === 'confirmed') {
    if (activeStatsReport.ns.some((n) => n < 3)) {
      issues.push({
        severity: 'warn',
        category: '统计',
        message: `存在独立单位数 <3 的组（${activeStatsReport.groupNames.map((name, i) => `${name}:nBio=${activeStatsReport.ns[i]}`).join('，')}）`,
        suggestion: '独立单位较少时估计可能不稳定；样本量应结合预期效应、单位间变异、实验设计和目标检验效力确定，增加同一单位的图像不能替代独立重复。',
      });
    }
    if (activeStatsReport.leveneP !== null && activeStatsReport.leveneP < 0.05) {
      issues.push({
        severity: 'info',
        category: '统计',
        message: '组间方差不齐（Brown–Forsythe p<0.05）',
        suggestion: '两组 Welch t 允许不等方差；普通 ANOVA 与 Dunnett 不属于异方差稳健检验，当前未实现 Welch ANOVA。请按预声明方案解释并报告方差检查。',
      });
    }
  } else if (!isColoc && project.samples.length === 0 && project.pixels) {
    issues.push({
      severity: 'info',
      category: '统计',
      message: '样本库为空',
      suggestion: '保存记录后需核对独立单位、切片、视野及分组并确认设计；只有满足单位级数据条件时才提供组间检验，图像条目数不等于生物学样本量。',
    });
  }

  // ── 评分与总评 ──
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warns = issues.filter((issue) => issue.severity === 'warn').length;
  const infos = issues.filter((issue) => issue.severity === 'info').length;
  const score = Math.max(0, Math.min(100, 100 - errors * 30 - warns * 12 - infos * 4));
  const summary =
    errors > 0
      ? `发现 ${errors} 个阻断性问题、${warns} 个警告：请先处理 error 项再采信定量结果。`
      : warns > 0
        ? `基本可用，但有 ${warns} 项警告值得关注；详见下方优化方向。`
        : infos > 0
          ? '未发现阻断性问题，仅有几项可选优化。'
          : '各项检查全部通过，配置与结果质量良好。';

  return { issues, summary, score };
}

/** 供指标快速引用（报告 JSON 用） */
export function summarizeMetrics(overall: RoiMetrics | null): Record<string, number | null> {
  if (!overall) return {};
  return {
    positiveFraction: overall.positiveFraction,
    positiveNuclei: overall.positiveNuclei,
    totalNuclei: overall.totalNuclei,
    labelingIndex: overall.labelingIndex,
    integratedOpticalDensity: overall.integratedOpticalDensity,
    meanOpticalDensity: overall.meanOpticalDensity,
    densityPerMm2: overall.densityPerMm2,
  };
}
