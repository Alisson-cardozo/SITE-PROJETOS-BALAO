/**
 * Converte um arquivo enviado (PDF ou imagem) num arquivo de imagem pronto pra
 * ler pixel a pixel. PDF renderiza so a 1a pagina via pdf.js pra um canvas
 * TRANSPARENTE (sem preencher fundo nenhum) e devolve como PNG -- as areas
 * vazias da pagina ficam com alpha 0, que readLanternaPixelGridFromFile trata
 * como "sem lanterna" (preto), igual um fundo preto de verdade. Imagem comum
 * (PNG/JPG/etc) volta sem nenhuma alteracao.
 */
export async function renderFileToImageFile(file: File): Promise<File> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) {
    return file;
  }

  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  const page = await pdf.getPage(1);

  const TARGET_LONG_SIDE = 1600;
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = TARGET_LONG_SIDE / Math.max(baseViewport.width, baseViewport.height);
  const viewport = page.getViewport({ scale: Math.max(0.1, scale) });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) {
    throw new Error('Nao foi possivel preparar o PDF pra leitura.');
  }

  await page.render({ canvas, canvasContext: ctx, viewport }).promise;

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) {
    throw new Error('Nao foi possivel converter o PDF em imagem.');
  }
  return new File([blob], file.name.replace(/\.pdf$/i, '.png'), { type: 'image/png' });
}
