import { useRef, useState } from 'react';

interface UploadPanelProps {
  busy: boolean;
  onFile: (file: File) => void;
}

export default function UploadPanel({ busy, onFile }: UploadPanelProps) {
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
      <p className="dropzone-title">{busy ? '正在解码…' : '拖入显微图像，或'}</p>
      <button type="button" disabled={busy} onClick={() => inputRef.current?.click()}>
        选择文件
      </button>
      <p className="dropzone-hint">支持 PNG / JPEG / TIFF（8 与 16bit，多页取最大页）</p>
      <p className="dropzone-hint">厂商全切片格式（.svs/.ndpi/.mrxs）请先从采集软件导出 TIFF</p>
    </section>
  );
}
