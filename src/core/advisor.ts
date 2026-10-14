/**
 * 诊断顾问：对分析配置与结果做体检，输出分级问题与优化方向。
 * 规则全部可解释（无黑盒打分），每条 suggestion 给出可操作动作。
 */
import type { AnalysisResult, ProjectState, RoiMetrics } from './types.ts';
import type { AnalysisQc } from './types.ts';

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

export function evaluateDiagnostics(ctx: AdvisorContext): DiagnosticsReport {
  const issues: DiagnosticIssue[] = [];
  const { project, result, qc, statsReport } = ctx;
  const isColoc = project.profileId === 'if_coloc';

  // ── 图像质量 ──
  if (project.image) {
    const longest = Math.max(project.image.workingWidth, project.image.workingHeight);
    if (longest < 400) {
      issues.push({
        severity: 'warn',
        category: '图像质量',
        message: `工作图最长边仅 ${longest} px`,
        suggestion: '分辨率过低会限制核分割精度；建议使用 ≥1200 px 的原始图像。',
      });
    }
    if (qc && qc.saturatedFraction > 0.05) {
      issues.push({
        severity: 'warn',
        category: '图像质量',
        message: `饱和像素占比 ${(qc.saturatedFraction * 100).toFixed(1)}%`,
        suggestion: '高光饱和丢失光密度信息；建议降低采集曝光或扫描亮度后重新导出。',
      });
    }
    if (qc && qc.tissueFraction < 0.08) {
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
  if (isColoc && result?.coloc) {
    const { pearsonMasked, pearsonAll } = result.coloc;
    if (Math.abs(pearsonAll) > 0.3 && Math.sign(pearsonAll) !== Math.sign(pearsonMasked || 0)) {
      issues.push({
        severity: 'warn',
        category: '阈值',
        message: '掩膜 Pearson 与全像素 Pearson 符号相反',
        suggestion: '背景像素主导了全像素相关性；请以掩膜 Pearson 为准，并检查各通道阈值是否合理。',
      });
    }
    if (Math.abs(pearsonMasked) < 0.2) {
      issues.push({
        severity: 'info',
        category: '阈值',
        message: `掩膜 Pearson 仅 ${pearsonMasked.toFixed(3)}，共定位很弱`,
        suggestion: '若预期强共定位：降低两通道阈值会引入噪声，升高会聚焦高表达区——建议扫动阈值观察变化，或检查通道分配是否正确。',
      });
    }
  }

  // ── 统计 ──
  if (statsReport) {
    if (statsReport.ns.some((n) => n < 3)) {
      issues.push({
        severity: 'warn',
        category: '统计',
        message: `存在样本数 <3 的组（${statsReport.groupNames.map((name, i) => `${name}:n=${statsReport.ns[i]}`).join('，')}）`,
        suggestion: '每组建议 ≥5 张图像（非参数检验 ≥8 更稳）；样本过少时检验效力不足，结论仅作探索。',
      });
    }
    if (statsReport.leveneP !== null && statsReport.leveneP < 0.05 && statsReport.omnibusParametric) {
      issues.push({
        severity: 'info',
        category: '统计',
        message: '组间方差不齐（Brown–Forsythe p<0.05）',
        suggestion: '以 Welch t / ANOVA（稳健）结果为准，并在论文中报告 Levene 检验。',
      });
    }
  } else if (project.samples.length === 0 && project.pixels) {
    issues.push({
      severity: 'info',
      category: '统计',
      message: '样本库为空',
      suggestion: '批处理导入或逐张"加入样本"并标注分组后，可做组间统计检验。',
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
