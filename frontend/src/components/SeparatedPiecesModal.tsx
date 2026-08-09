import { useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { GomoSvgTrueScale } from './GomoTacoPreview';
import { buildSeparatedPieces } from '../lib/moldGeometry';
import type { MoldPlotterConfig, MoldPoint } from '../types';

interface SeparatedPiecesModalProps {
  nome: string;
  pontos: MoldPoint[];
  plotterConfig: MoldPlotterConfig;
  bainhaCm?: number;
  onClose: () => void;
}

function formatCm(value: number): string {
  const n = Number(value);
  const text = Number.isFinite(n) ? n.toFixed(1).replace(/\.0$/, '').replace('.', ',') : '0';
  return `${text} cm`;
}

export function SeparatedPiecesModal({ nome, pontos, plotterConfig, bainhaCm = 1.0, onClose }: SeparatedPiecesModalProps) {
  const pieces = useMemo(
    () =>
      buildSeparatedPieces(pontos, plotterConfig.taco_configs, plotterConfig.section_ratios, plotterConfig.section_colors, bainhaCm),
    [pontos, plotterConfig, bainhaCm]
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="pieces-modal-backdrop" onClick={onClose}>
      <div className="pieces-modal" onClick={(event) => event.stopPropagation()}>
        <div className="pieces-modal-header">
          <div>
            <h2>Peças separadas — {nome}</h2>
            <p>Cada faixa do molde pronta pra cortar/imprimir separada, igual sai numa plotagem real.</p>
          </div>
          <button type="button" className="pieces-modal-close" onClick={onClose} aria-label="Fechar">
            <X size={20} />
          </button>
        </div>

        {pieces.length === 0 ? (
          <div className="mold-gallery-empty">
            <span>Nenhuma peca para mostrar — configure os tacos na aba Plotar e salve novamente.</span>
          </div>
        ) : (
          <div className="pieces-modal-grid">
            {pieces.map((piece) => (
              <div key={piece.id} className="piece-card">
                <div className="piece-card-svg">
                  <GomoSvgTrueScale profile={piece.profile} tacoConfigs={piece.tacoConfigs} showDetails={false} bainhaCm={bainhaCm} />
                </div>
                <div className="piece-card-info">
                  <span className="piece-card-dot" style={{ background: piece.color }} />
                  <strong>{piece.label}</strong>
                  <span>{formatCm(piece.alturaCm)}</span>
                  <span>{piece.tacosPorGomo} tacos/gomo</span>
                  <span>{piece.tacosSubindo} tacos subindo</span>
                  <span>taco {Math.floor(piece.alturaTacoCm)} cm</span>
                  <span>total {piece.totalTacos} tacos</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
