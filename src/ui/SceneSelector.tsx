import type { AnalysisScene } from './analysis-scenes.ts';

const SCENES: { id: AnalysisScene; label: string; description: string; symbol: string }[] = [
  { id: 'ihc', label: 'IHC 免疫组化', description: 'H-DAB · 阳性面积与细胞核', symbol: 'IHC' },
  { id: 'stain', label: '常规与特殊染色', description: 'H&E / Masson · 染色面积与光密度', symbol: 'STAIN' },
  { id: 'if', label: 'IF 免疫荧光', description: 'RGB 双通道 · 共定位分析', symbol: 'IF' },
];

interface SceneSelectorProps {
  scene: AnalysisScene;
  disabled: boolean;
  onChange: (scene: AnalysisScene) => void;
}

export default function SceneSelector({ scene, disabled, onChange }: SceneSelectorProps) {
  return (
    <section className="scene-selector" aria-label="分析场景">
      <div className="scene-selector-heading">
        <h2>选择分析场景</h2>
        <span>选择场景后，导入图像开始分析</span>
      </div>
      <div className="scene-options">
        {SCENES.map((item) => (
          <button
            type="button"
            key={item.id}
            className="scene-option"
            aria-label={item.label}
            aria-pressed={scene === item.id}
            disabled={disabled}
            onClick={() => onChange(item.id)}
          >
            <span className="scene-symbol" aria-hidden="true">{item.symbol}</span>
            <span className="scene-option-copy">
              <strong>{item.label}</strong>
              <span>{item.description}</span>
            </span>
            <span className="scene-indicator" aria-hidden="true">{scene === item.id ? '✓' : ''}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
