import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, Flag, ImagePlus, Loader2, MonitorSmartphone } from 'lucide-react';
import { downloadBlob } from '../lib/pdfExport';

type OutputFormat = 'jpeg' | 'webp' | 'png';

const FORMAT_MIME: Record<OutputFormat, string> = {
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  png: 'image/png',
};

const FORMAT_EXT: Record<OutputFormat, string> = {
  jpeg: 'jpg',
  webp: 'webp',
  png: 'png',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function baseName(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : filename;
}

interface ReduzirImagemPageProps {
  /** Opcional — se passado, mostra os botoes "Usar na aba X" que mandam a
   * imagem ja reduzida direto pro upload de Bandeira/Painel, sem precisar
   * baixar e escolher o arquivo nesses de novo. */
  onUseIn?: (file: File, target: 'bandeiras' | 'painel-letreiros') => void;
}

export function ReduzirImagemPage({ onUseIn }: ReduzirImagemPageProps) {
  const [file, setFile] = useState<File | null>(null);
  const [naturalWidth, setNaturalWidth] = useState(0);
  const [naturalHeight, setNaturalHeight] = useState(0);
  const [maxWidth, setMaxWidth] = useState(0);
  const [quality, setQuality] = useState(0.8);
  const [format, setFormat] = useState<OutputFormat>('webp');
  const [error, setError] = useState<string | null>(null);

  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  const imageRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    setError(null);
    setResultBlob(null);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl(null);

    const objectUrl = URL.createObjectURL(selected);
    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      setNaturalWidth(img.naturalWidth);
      setNaturalHeight(img.naturalHeight);
      setMaxWidth(img.naturalWidth);
      setFile(selected);
      URL.revokeObjectURL(objectUrl);
    };
    img.onerror = () => {
      setError('Não foi possível abrir essa imagem.');
      URL.revokeObjectURL(objectUrl);
    };
    img.src = objectUrl;
  }

  // Reprocessa (redimensiona + recomprime) toda vez que largura/qualidade/formato
  // mudam — com um pequeno debounce pra nao travar arrastando o slider.
  useEffect(() => {
    const img = imageRef.current;
    if (!img || !file || maxWidth === 0) return;

    let cancelled = false;
    setProcessing(true);
    const timer = setTimeout(() => {
      const scale = Math.min(1, maxWidth / img.naturalWidth);
      const targetWidth = Math.max(1, Math.round(img.naturalWidth * scale));
      const targetHeight = Math.max(1, Math.round(img.naturalHeight * scale));

      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setProcessing(false);
        return;
      }
      if (format === 'jpeg') {
        // JPEG nao tem canal alfa — fundo branco por baixo, senao area
        // transparente vira preto na hora de exportar.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetWidth, targetHeight);
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

      canvas.toBlob(
        (blob) => {
          if (cancelled || !blob) {
            setProcessing(false);
            return;
          }
          setResultBlob(blob);
          setResultUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return URL.createObjectURL(blob);
          });
          setProcessing(false);
        },
        FORMAT_MIME[format],
        format === 'png' ? undefined : quality
      );
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [file, maxWidth, quality, format]);

  function handleDownload() {
    if (!resultBlob || !file) return;
    downloadBlob(resultBlob, `${baseName(file.name)}-reduzida.${FORMAT_EXT[format]}`);
  }

  function handleReset() {
    setFile(null);
    setNaturalWidth(0);
    setNaturalHeight(0);
    setMaxWidth(0);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl(null);
    setResultBlob(null);
    imageRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const reduction = file && resultBlob ? Math.round((1 - resultBlob.size / file.size) * 100) : null;

  return (
    <div className="bandeira-workspace">
      <div className="bandeira-main-panel">
        <div className="bandeira-panel-header">
          <h2>Reduzir Imagem HD</h2>
          <p>Diminua o tamanho do arquivo (KB/MB) de uma foto em alta resolução, ajustando largura e qualidade, sem perder a proporção.</p>
        </div>

        {!file ? (
          <div className="bandeira-upload-card">
            <div className="bandeira-upload-options">
              <label className="bandeira-upload-option bandeira-upload-option-primary">
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="bandeira-file-input-hidden" />
                <span className="bandeira-upload-option-icon">
                  <ImagePlus size={20} />
                </span>
                <span className="bandeira-upload-option-text">
                  <strong>Escolher imagem</strong>
                  <small>Carregue a foto que você quer deixar mais leve</small>
                </span>
              </label>
            </div>
            {error ? <p className="mold-import-error">{error}</p> : null}
          </div>
        ) : (
          <div className="bandeira-create-panel" style={{ maxWidth: '560px' }}>
            <div className="bandeira-preview-box">
              {resultUrl ? <img src={resultUrl} alt="Preview reduzida" className="bandeira-preview-canvas" /> : null}
              {processing ? (
                <div className="bandeira-preview-loading">
                  <Loader2 size={16} className="mold-import-spinner" />
                </div>
              ) : null}
            </div>

            <div className="bandeira-info-grid" style={{ margin: '14px 0' }}>
              <div>
                <span>Tamanho original</span>
                <strong>{formatBytes(file.size)}</strong>
              </div>
              <div>
                <span>Tamanho reduzido</span>
                <strong style={{ color: reduction && reduction > 0 ? '#4fd394' : undefined }}>
                  {resultBlob ? formatBytes(resultBlob.size) : '—'}
                  {reduction !== null && reduction > 0 ? ` (-${reduction}%)` : ''}
                </strong>
              </div>
              <div>
                <span>Dimensões originais</span>
                <strong>{naturalWidth} x {naturalHeight} px</strong>
              </div>
              <div>
                <span>Dimensões finais</span>
                <strong>
                  {Math.max(1, Math.round(naturalWidth * Math.min(1, maxWidth / naturalWidth)))} x{' '}
                  {Math.max(1, Math.round(naturalHeight * Math.min(1, maxWidth / naturalWidth)))} px
                </strong>
              </div>
            </div>

            <label className="criar-field">
              <span>Largura máxima: {maxWidth}px</span>
              <input
                type="range"
                min={Math.min(20, naturalWidth)}
                max={naturalWidth}
                value={maxWidth}
                onChange={(e) => setMaxWidth(Number(e.target.value))}
              />
            </label>

            <label className="auth-field" style={{ marginBottom: '14px' }}>
              <span>Formato de saída</span>
              <select value={format} onChange={(e) => setFormat(e.target.value as OutputFormat)}>
                <option value="webp">WebP (recomendado — mais leve pra qualquer tipo de imagem)</option>
                <option value="jpeg">JPEG (bom pra fotos, mas pesa mais em desenhos/ilustrações)</option>
                <option value="png">PNG (sem perda de qualidade, arquivo maior)</option>
              </select>
            </label>

            {format !== 'png' ? (
              <label className="criar-field">
                <span>Qualidade: {Math.round(quality * 100)}%</span>
                <input type="range" min={0.1} max={1} step={0.05} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
              </label>
            ) : null}

            {error ? <p className="mold-import-error">{error}</p> : null}

            {resultBlob && reduction !== null && reduction <= 0 ? (
              <p className="bandeira-hint">
                Esse arquivo ficou do mesmo tamanho ou maior que o original — tenta baixar mais a qualidade, diminuir a largura, ou trocar pra
                WebP.
              </p>
            ) : null}

            <div className="modelo3d-export-btns-row" style={{ marginTop: '14px' }}>
              <button type="button" className="mold-secondary-button" onClick={handleReset}>
                Trocar imagem
              </button>
              <button type="button" className="mold-save-button" onClick={handleDownload} disabled={!resultBlob || processing}>
                {resultBlob && !processing ? <CheckCircle2 size={16} /> : <Download size={16} />}
                Baixar imagem reduzida
              </button>
            </div>

            {onUseIn ? (
              <div className="modelo3d-export-btns-row" style={{ marginTop: '10px' }}>
                <button
                  type="button"
                  className="mold-secondary-button"
                  onClick={() => resultBlob && file && onUseIn(new File([resultBlob], `${baseName(file.name)}-reduzida.${FORMAT_EXT[format]}`, { type: FORMAT_MIME[format] }), 'bandeiras')}
                  disabled={!resultBlob || processing}
                >
                  <Flag size={16} /> Usar na aba Bandeira
                </button>
                <button
                  type="button"
                  className="mold-secondary-button"
                  onClick={() => resultBlob && file && onUseIn(new File([resultBlob], `${baseName(file.name)}-reduzida.${FORMAT_EXT[format]}`, { type: FORMAT_MIME[format] }), 'painel-letreiros')}
                  disabled={!resultBlob || processing}
                >
                  <MonitorSmartphone size={16} /> Usar na aba Painel
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
