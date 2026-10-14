import { useRef } from 'react';

interface AiPanelProps {
  modelName: string | null;
  aiActive: boolean;
  onModelFile: (file: File) => void;
  onUseAiChange: (value: boolean) => void;
  useAi: boolean;
}

export default function AiPanel({
  modelName,
  aiActive,
  onModelFile,
  onUseAiChange,
  useAi,
}: AiPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <section className="panel">
      <h3>AI 核分割（可选）</h3>
      <input
        ref={inputRef}
        type="file"
        accept=".onnx"
        aria-label="AI 模型文件"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onModelFile(file);
          event.target.value = '';
        }}
      />
      <div className="field-row">
        <button type="button" onClick={() => inputRef.current?.click()}>
          {modelName ? '更换模型' : '加载 ONNX 模型'}
        </button>
        {modelName && <span className="field-value" title={modelName}>{modelName}</span>}
      </div>
      {modelName && (
        <label className="check-row">
          <input
            type="checkbox"
            checked={useAi}
            onChange={(event) => onUseAiChange(event.target.checked)}
          />
          用 AI 概率图替代苏木精 Otsu 分割
        </label>
      )}
      <p className="panel-note">
        模型在本地推理，兼容输出单通道核概率图的分割模型（StarDist/CellPose 类 U-Net 导出，
        动态 [1,1,H,W] 输入）。失败自动回落 Otsu 并提示。模型仅驻留内存，刷新后需重新加载。
        {aiActive && ' ✓ 本轮分析已使用 AI 掩膜。'}
      </p>
    </section>
  );
}
