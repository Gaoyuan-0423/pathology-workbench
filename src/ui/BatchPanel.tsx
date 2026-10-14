import { useRef } from 'react';

export interface BatchState {
  running: boolean;
  total: number;
  done: number;
  current: string;
  errors: string[];
  cancelled: boolean;
}

interface BatchPanelProps {
  disabled: boolean;
  batch: BatchState | null;
  onBatch: (files: File[], group: string) => void;
  onCancel: () => void;
}

export default function BatchPanel({ disabled, batch, onBatch, onCancel }: BatchPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const groupRef = useRef<HTMLInputElement>(null);

  return (
    <section className="panel">
      <h3>批处理</h3>
      <div className="field-row">
        <input
          ref={groupRef}
          type="text"
          defaultValue="对照组"
          aria-label="批处理分组"
          disabled={disabled || Boolean(batch?.running)}
        />
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".png,.jpg,.jpeg,.tif,.tiff"
          aria-label="批处理图像"
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            if (files.length > 0) {
              onBatch(files, groupRef.current?.value.trim() || '对照组');
            }
            event.target.value = '';
          }}
        />
        {batch?.running ? (
          <button type="button" className="button-danger" onClick={onCancel}>
            取消
          </button>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            选择多张图像
          </button>
        )}
      </div>
      <p className="panel-note">
        按当前预设与参数逐张分析，整图指标写入样本库（不替换当前画布、不保留像素）。分组以上方输入为准。
      </p>
      {batch && batch.total > 0 && (
        <div className="batch-progress">
          <div className="batch-bar">
            <div
              className="batch-bar-fill"
              style={{ width: `${Math.round((batch.done / batch.total) * 100)}%` }}
            />
          </div>
          <p className="panel-note">
            {batch.running
              ? `正在处理 ${batch.done + 1}/${batch.total}：${batch.current}`
              : batch.cancelled
                ? `已取消：完成 ${batch.done}/${batch.total}`
                : `批处理完成：成功 ${batch.done - batch.errors.length}，失败 ${batch.errors.length}`}
          </p>
          {batch.errors.length > 0 && (
            <ul className="batch-errors">
              {batch.errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
