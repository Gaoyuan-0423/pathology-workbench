import { useRef, useState } from 'react';

interface UploadPanelProps {
  busy: boolean;
  prompt?: string;
  onFile: (file: File) => void;
}

export default function UploadPanel({ busy, prompt = '拖入显微图像，开始分析', onFile }: UploadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <section
      className={`dropzone${dragging ? ' dropzone-active' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file) onFile(file);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.tif,.tiff,image/png,image/jpeg,image/tiff"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = '';
        }}
      />
      <span className="upload-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 16V4m-4 4 4-4 4 4M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
      <div className="dropzone-copy">
        <p className="dropzone-title">{busy ? '正在解码图像…' : prompt}</p>
        <p className="dropzone-hint">PNG / JPEG / TIFF · 8 / 16-bit · 多页取最大页</p>
        <p className="dropzone-format-note">全切片 .svs / .ndpi / .mrxs 请先导出为 TIFF</p>
      </div>
      <button type="button" disabled={busy} onClick={() => inputRef.current?.click()}>选择文件</button>
    </section>
  );
}
