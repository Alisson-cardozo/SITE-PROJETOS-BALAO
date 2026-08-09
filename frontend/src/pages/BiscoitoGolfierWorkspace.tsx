import { useEffect, useRef, useState } from 'react';
import { Box, Cookie, Download, FileImage, Layers, Printer, RefreshCw } from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildBiscoitoPdf, buildBiscoitoPlotterPdf } from '../lib/biscoitoPdf';
import { downloadBlob, downloadCanvasAsPng, slugifyFilename } from '../lib/pdfExport';
import { numericFieldProps } from '../lib/numericInput';

export function BiscoitoGolfierWorkspace() {
  // Entradas de medidas (em cm)
  const [nome, setNome] = useState('Biscoito de Golfier');
  
  // Opcao de como informar a boca do balao: por Arco ou por Diametro
  const [modoBoca, setModoBoca] = useState<'arco' | 'diametro'>('arco');
  const [arcoBocaCm, setArcoBocaCm] = useState<number>(40);
  const [diametroBocaDirectCm, setDiametroBocaDirectCm] = useState<number>(25.5);
  
  // Diametro e Altura do Biscoito
  const [diametroBiscoitoCm, setDiametroBiscoitoCm] = useState<number>(60);
  const [alturaBiscoitoCm, setAlturaBiscoitoCm] = useState<number>(15);

  // Tamanho do Taco do Papel em cm (Ex: 5, 10, 15, 20 cm)
  const [tacoCm, setTacoCm] = useState<number>(5);
  const [bainhaCm, setBainhaCm] = useState<number>(1);

  // Aba de visualizacao: 2D (Moldes Plano) ou 3D (Modelo Tridimensional)
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d');

  // Referencias para os canvas
  const canvas2dRef = useRef<HTMLCanvasElement | null>(null);
  const mount3dRef = useRef<HTMLDivElement | null>(null);

  // Calculos matematicos do Biscoito
  // Se informado por Arco, Diametro da Boca = (2 * Arco) / Math.PI
  const diametroBocaCalculado =
    modoBoca === 'arco'
      ? arcoBocaCm > 0
        ? (2 * arcoBocaCm) / Math.PI
        : 0
      : diametroBocaDirectCm || 0;

  const diametroBiscoitoEffective = Math.max(1, diametroBiscoitoCm || 1);
  const diametroBocaEffective = Math.min(diametroBiscoitoEffective - 0.5, Math.max(0.5, diametroBocaCalculado));
  const alturaBiscoitoEffective = Math.max(1, alturaBiscoitoCm || 1);
  const tacoCmEffective = Math.max(1, tacoCm || 5);
  const bainhaCmEffective = Math.max(0, bainhaCm || 0);

  // Perimetro/Circunferencia da Faixa Lateral = Math.PI * DiametroBiscoito
  const perimetroBiscoito = Math.PI * diametroBiscoitoEffective;

  // Calculo dos Tacos Quadriculados das 3 Partes
  const tacosTampo = Math.ceil(diametroBiscoitoEffective / tacoCmEffective) * Math.ceil(diametroBiscoitoEffective / tacoCmEffective);
  const tacosFundo = Math.ceil(diametroBiscoitoEffective / tacoCmEffective) * Math.ceil(diametroBiscoitoEffective / tacoCmEffective);
  const tacosLateral = Math.ceil(perimetroBiscoito / tacoCmEffective) * Math.ceil(alturaBiscoitoEffective / tacoCmEffective);
  const tacosTotal = tacosTampo + tacosFundo + tacosLateral;

  // Largura da coroa circular (borda do tampo superior)
  const larguraBorda = (diametroBiscoitoEffective - diametroBocaEffective) / 2;

  // Area total do material
  const areaTampo = Math.PI * Math.pow(diametroBiscoitoEffective / 2, 2) - Math.PI * Math.pow(diametroBocaEffective / 2, 2);
  const areaFundo = Math.PI * Math.pow(diametroBiscoitoEffective / 2, 2);
  const areaLateral = perimetroBiscoito * alturaBiscoitoEffective;
  const areaTotalCm2 = areaTampo + areaFundo + areaLateral;

  // Renderizacao do Canvas 2D dos Moldes
  useEffect(() => {
    if (viewMode !== '2d') return;
    const canvas = canvas2dRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Limpa fundo
    ctx.fillStyle = '#0f172a'; // slate-900
    ctx.fillRect(0, 0, width, height);

    // Grade sutil de fundo
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Escala dinamica para couber com folga total no canvas
    const maxCircleRadius = Math.min(width * 0.17, height * 0.19);
    const scale = (maxCircleRadius * 2) / (diametroBiscoitoEffective || 1);

    // Centro das figuras no Canvas 2D
    const c1x = width * 0.26;
    const c2x = width * 0.74;
    const c1y = height * 0.28;
    const c2y = height * 0.28;

    const rExt = (diametroBiscoitoEffective / 2) * scale;
    const rInt = (diametroBocaEffective / 2) * scale;
    const larguraBordaCm = (diametroBiscoitoEffective - diametroBocaEffective) / 2;

    // ----------------------------------------------------
    // DESENHO QUADRICULADO EM TACOS (X e Y) COM BAINHAS
    // ----------------------------------------------------
    const tacoPxCircle = ((rExt * 2) / Math.max(1, diametroBiscoitoEffective)) * tacoCmEffective;
    const bainhaPx = Math.max(0.5, (bainhaCmEffective || 1) * scale * 0.4);

    // 1. Parte 1: Tampo Superior (Com Furo)
    ctx.save();
    ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2.5;

    // Desenha anel (circulo externo menos circulo interno)
    ctx.beginPath();
    ctx.arc(c1x, c1y, rExt, 0, Math.PI * 2, false);
    ctx.arc(c1x, c1y, rInt, 0, Math.PI * 2, true);
    ctx.fill();
    ctx.stroke();

    // DESENHO QUADRICULADO X e Y NO TAMPO
    ctx.save();
    ctx.beginPath();
    ctx.arc(c1x, c1y, rExt, 0, Math.PI * 2, false);
    ctx.arc(c1x, c1y, rInt, 0, Math.PI * 2, true);
    ctx.clip();

    const startX1 = c1x - rExt;
    const startY1 = c1y - rExt;

    for (let x = startX1; x < c1x + rExt; x += tacoPxCircle) {
      for (let y = startY1; y < c1y + rExt; y += tacoPxCircle) {
        const cx = x + tacoPxCircle / 2;
        const cy = y + tacoPxCircle / 2;
        const distCenter = Math.hypot(cx - c1x, cy - c1y);
        if (distCenter >= rInt - tacoPxCircle * 0.4 && distCenter <= rExt + tacoPxCircle * 0.4) {
          const cellW = Math.min(tacoPxCircle, (c1x + rExt) - x);
          const cellH = Math.min(tacoPxCircle, (c1y + rExt) - y);

          ctx.fillStyle = ((Math.floor((x - startX1) / tacoPxCircle) + Math.floor((y - startY1) / tacoPxCircle)) % 2 === 0)
            ? 'rgba(6, 182, 212, 0.32)'
            : 'rgba(56, 189, 248, 0.18)';
          ctx.fillRect(x, y, cellW, cellH);

          ctx.strokeStyle = 'rgba(6, 182, 212, 0.75)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, cellW, cellH);

          if (bainhaPx > 0 && cellW > bainhaPx * 2 && cellH > bainhaPx * 2) {
            ctx.strokeStyle = 'rgba(250, 204, 21, 0.5)';
            ctx.setLineDash([2, 2]);
            ctx.strokeRect(x + bainhaPx, y + bainhaPx, cellW - bainhaPx * 2, cellH - bainhaPx * 2);
            ctx.setLineDash([]);
          }
        }
      }
    }
    ctx.restore();

    // Linha de centro horizontal
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(c1x - rExt - 12, c1y);
    ctx.lineTo(c1x + rExt + 12, c1y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Cota da BORDA em Amarelo (desenhada na vertical pra cima, no eixo Y)
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(c1x, c1y - rInt);
    ctx.lineTo(c1x, c1y - rExt);
    ctx.stroke();

    // Ticks da cota da borda (traços horizontais)
    ctx.beginPath();
    ctx.moveTo(c1x - 5, c1y - rInt);
    ctx.lineTo(c1x + 5, c1y - rInt);
    ctx.moveTo(c1x - 5, c1y - rExt);
    ctx.lineTo(c1x + 5, c1y - rExt);
    ctx.stroke();

    // Texto da cota de Borda
    ctx.fillStyle = '#facc15';
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.textAlign = 'left';
    const midBordaY = c1y - (rInt + rExt) / 2;
    ctx.fillText(`Borda: ${larguraBordaCm.toFixed(1)} cm`, c1x + 8, midBordaY + 4);

    // Título Parte 1
    ctx.fillStyle = '#93c5fd';
    ctx.font = 'bold 13px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`1. Tampo Superior (Quadriculado: Tacos de ${tacoCmEffective}cm)`, c1x, c1y - rExt - 16);

    // Texto do Furo da Boca (dentro do circulo interno)
    ctx.fillStyle = '#60a5fa';
    ctx.font = 'bold 11px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Ø Boca: ${diametroBocaEffective.toFixed(1)} cm`, c1x, c1y - 3);
    ctx.font = '10px Inter, sans-serif';
    ctx.fillStyle = '#93c5fd';
    ctx.fillText(`(Raio: ${(diametroBocaEffective / 2).toFixed(1)} cm)`, c1x, c1y + 10);

    // Texto do Diâmetro Total do Biscoito (abaixo do círculo)
    ctx.fillStyle = '#93c5fd';
    ctx.font = '12px Inter, sans-serif';
    ctx.fillText(`Ø Total Biscoito: ${diametroBiscoitoEffective.toFixed(1)} cm (Raio: ${(diametroBiscoitoEffective / 2).toFixed(1)} cm)`, c1x, c1y + rExt + 20);

    ctx.restore();

    // 2. Parte 2: Fundo Inferior (Circulo Macico sem Furo)
    ctx.save();
    ctx.fillStyle = 'rgba(34, 197, 94, 0.15)';
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 2.5;

    ctx.beginPath();
    ctx.arc(c2x, c2y, rExt, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // DESENHO QUADRICULADO X e Y NO FUNDO
    ctx.save();
    ctx.beginPath();
    ctx.arc(c2x, c2y, rExt, 0, Math.PI * 2);
    ctx.clip();

    const startX2 = c2x - rExt;
    const startY2 = c2y - rExt;

    for (let x = startX2; x < c2x + rExt; x += tacoPxCircle) {
      for (let y = startY2; y < c2y + rExt; y += tacoPxCircle) {
        const cx = x + tacoPxCircle / 2;
        const cy = y + tacoPxCircle / 2;
        const distCenter = Math.hypot(cx - c2x, cy - c2y);
        if (distCenter <= rExt + tacoPxCircle * 0.4) {
          const cellW = Math.min(tacoPxCircle, (c2x + rExt) - x);
          const cellH = Math.min(tacoPxCircle, (c2y + rExt) - y);

          ctx.fillStyle = ((Math.floor((x - startX2) / tacoPxCircle) + Math.floor((y - startY2) / tacoPxCircle)) % 2 === 0)
            ? 'rgba(34, 197, 94, 0.32)'
            : 'rgba(74, 222, 128, 0.18)';
          ctx.fillRect(x, y, cellW, cellH);

          ctx.strokeStyle = 'rgba(34, 197, 94, 0.75)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, cellW, cellH);

          if (bainhaPx > 0 && cellW > bainhaPx * 2 && cellH > bainhaPx * 2) {
            ctx.strokeStyle = 'rgba(250, 204, 21, 0.5)';
            ctx.setLineDash([2, 2]);
            ctx.strokeRect(x + bainhaPx, y + bainhaPx, cellW - bainhaPx * 2, cellH - bainhaPx * 2);
            ctx.setLineDash([]);
          }
        }
      }
    }
    ctx.restore();

    // Textos Cotas Fundo
    ctx.fillStyle = '#86efac';
    ctx.font = 'bold 13px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`2. Fundo Inferior (Quadriculado: Tacos de ${tacoCmEffective}cm)`, c2x, c2y - rExt - 16);

    ctx.fillStyle = '#86efac';
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.fillText(`Círculo Fechado Maciço`, c2x, c2y + 4);

    ctx.fillStyle = '#86efac';
    ctx.font = '12px Inter, sans-serif';
    ctx.fillText(`Ø Biscoito: ${diametroBiscoitoEffective.toFixed(1)} cm (Raio: ${(diametroBiscoitoEffective / 2).toFixed(1)} cm)`, c2x, c2y + rExt + 20);

    ctx.restore();

    // 3. Parte 3: Faixa Lateral (Retangulo da Parede)
    const rectY = height * 0.71;
    const rectH = Math.max(36, Math.min(50, alturaBiscoitoEffective * (scale * 0.35)));
    const rectW = Math.min(width - 120, perimetroBiscoito * (scale * 0.35));
    const rectX = (width - rectW) / 2;

    ctx.save();
    ctx.fillStyle = 'rgba(234, 179, 8, 0.15)';
    ctx.strokeStyle = '#eab308';
    ctx.lineWidth = 2.5;

    ctx.fillRect(rectX, rectY, rectW, rectH);
    ctx.strokeRect(rectX, rectY, rectW, rectH);

    // DESENHO QUADRICULADO X e Y NA FAIXA LATERAL (ESCALA EXATA DOS TACOS)
    const tacoStepXPx = (rectW / Math.max(1, perimetroBiscoito)) * tacoCmEffective;
    const tacoStepYPx = (rectH / Math.max(1, alturaBiscoitoEffective)) * tacoCmEffective;

    ctx.save();
    ctx.beginPath();
    ctx.rect(rectX, rectY, rectW, rectH);
    ctx.clip();

    for (let x = rectX; x < rectX + rectW; x += tacoStepXPx) {
      for (let y = rectY; y < rectY + rectH; y += tacoStepYPx) {
        const cellW = Math.min(tacoStepXPx, (rectX + rectW) - x);
        const cellH = Math.min(tacoStepYPx, (rectY + rectH) - y);

        ctx.fillStyle = ((Math.floor((x - rectX) / tacoStepXPx) + Math.floor((y - rectY) / tacoStepYPx)) % 2 === 0)
          ? 'rgba(234, 179, 8, 0.32)'
          : 'rgba(253, 224, 71, 0.18)';
        ctx.fillRect(x, y, cellW, cellH);

        ctx.strokeStyle = 'rgba(234, 179, 8, 0.75)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, cellW, cellH);

        if (bainhaPx > 0 && cellW > bainhaPx * 2 && cellH > bainhaPx * 2) {
          ctx.strokeStyle = 'rgba(59, 130, 246, 0.5)';
          ctx.setLineDash([2, 2]);
          ctx.strokeRect(x + bainhaPx, y + bainhaPx, cellW - bainhaPx * 2, cellH - bainhaPx * 2);
          ctx.setLineDash([]);
        }
      }
    }
    ctx.restore();

    // Textos Cotas Faixa Lateral (TODOS POSICIONADOS FORA DO RETÂNGULO PARA NUNCA EMBOLAR!)
    ctx.fillStyle = '#fde047';
    ctx.font = 'bold 13px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`3. Faixa Lateral (Quadriculada em Tacos de ${tacoCmEffective}cm)`, width / 2, rectY - 14);

    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.fillText(`Comprimento Exato (Perímetro): ${perimetroBiscoito.toFixed(1)} cm (${Math.ceil(perimetroBiscoito / tacoCmEffective)} Tacos de ${tacoCmEffective}cm)`, width / 2, rectY + rectH + 18);

    ctx.font = '12px Inter, sans-serif';
    ctx.fillText(`Altura da Parede: ${alturaBiscoitoEffective.toFixed(1)} cm (${Math.ceil(alturaBiscoitoEffective / tacoCmEffective)} Tacos de ${tacoCmEffective}cm)`, width / 2, rectY + rectH + 34);

  }, [viewMode, diametroBiscoitoEffective, diametroBocaEffective, alturaBiscoitoEffective, perimetroBiscoito, tacoCmEffective, bainhaCmEffective, tacosTampo, tacosFundo, tacosLateral]);

  // Renderizacao da Visualizacao 3D do Biscoito Montado em Three.js
  useEffect(() => {
    if (viewMode !== '3d') return;
    const container = mount3dRef.current;
    if (!container) return;

    container.innerHTML = '';

    const width = container.clientWidth || 600;
    const height = container.clientHeight || 450;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0b0f19');

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(40, 35, 50);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(30, 50, 40);
    dirLight.castShadow = true;
    scene.add(dirLight);

    const pointLight = new THREE.PointLight(0x3b82f6, 1.5, 100);
    pointLight.position.set(-20, 20, -20);
    scene.add(pointLight);

    const biscoitoGroup = new THREE.Group();

    const scale3d = 0.3;
    const rExt3d = (diametroBiscoitoEffective / 2) * scale3d;
    const rInt3d = (diametroBocaEffective / 2) * scale3d;
    const h3d = alturaBiscoitoEffective * scale3d;

    const biscoitoMaterial = new THREE.MeshStandardMaterial({
      color: 0x2563eb,
      roughness: 0.3,
      metalness: 0.2,
      side: THREE.DoubleSide,
    });

    // 1. Fundo Inferior (Circulo macico)
    const fundoShape = new THREE.Shape();
    fundoShape.absarc(0, 0, rExt3d, 0, Math.PI * 2, false);
    const fundoGeo = new THREE.ShapeGeometry(fundoShape);
    const fundoMesh = new THREE.Mesh(fundoGeo, biscoitoMaterial);
    fundoMesh.rotation.x = Math.PI / 2;
    fundoMesh.position.y = -h3d / 2;
    biscoitoGroup.add(fundoMesh);

    // 2. Tampo Superior (Anel com furo no meio)
    const tampoShape = new THREE.Shape();
    tampoShape.absarc(0, 0, rExt3d, 0, Math.PI * 2, false);
    const holePath = new THREE.Path();
    holePath.absarc(0, 0, rInt3d, 0, Math.PI * 2, true);
    tampoShape.holes.push(holePath);

    const tampoGeo = new THREE.ShapeGeometry(tampoShape);
    const tampoMesh = new THREE.Mesh(tampoGeo, biscoitoMaterial);
    tampoMesh.rotation.x = Math.PI / 2;
    tampoMesh.position.y = h3d / 2;
    biscoitoGroup.add(tampoMesh);

    // 3. Faixa Lateral (Cilindro da parede)
    const paredeGeo = new THREE.CylinderGeometry(rExt3d, rExt3d, h3d, 64, 1, true);
    const paredeMesh = new THREE.Mesh(paredeGeo, biscoitoMaterial);
    biscoitoGroup.add(paredeMesh);

    // Borda destacada do Furo da Boca
    const furoRingGeo = new THREE.TorusGeometry(rInt3d, 0.2, 16, 64);
    const furoRingMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
    const furoRingMesh = new THREE.Mesh(furoRingGeo, furoRingMat);
    furoRingMesh.rotation.x = Math.PI / 2;
    furoRingMesh.position.y = h3d / 2 + 0.05;
    biscoitoGroup.add(furoRingMesh);



    scene.add(biscoitoGroup);

    let animId: number;
    function animate() {
      animId = requestAnimationFrame(animate);
      biscoitoGroup.rotation.y += 0.005;
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    };
  }, [viewMode, diametroBiscoitoEffective, diametroBocaEffective, alturaBiscoitoEffective]);

  // Plotar Molde em Tamanho Real 1:1
  function handlePlotarMolde() {
    const blob = buildBiscoitoPlotterPdf({
      nome: nome.trim() || 'Biscoito de Golfier',
      diametroBiscoitoCm: diametroBiscoitoEffective,
      diametroBocaCm: diametroBocaEffective,
      alturaBiscoitoCm: alturaBiscoitoEffective,
      perimetroBiscoitoCm: perimetroBiscoito,
      larguraBordaCm: larguraBorda,
      areaTotalCm2,
      tacoCm: tacoCmEffective,
    });
    downloadBlob(blob, `plotter-${slugifyFilename(nome || 'biscoito-golfier')}-escala-1-1.pdf`);
  }

  // Exportar PDF do Molde
  function handleDownloadPdf() {
    const blob = buildBiscoitoPdf({
      nome: nome.trim() || 'Biscoito de Golfier',
      diametroBiscoitoCm: diametroBiscoitoEffective,
      diametroBocaCm: diametroBocaEffective,
      alturaBiscoitoCm: alturaBiscoitoEffective,
      perimetroBiscoitoCm: perimetroBiscoito,
      larguraBordaCm: larguraBorda,
      areaTotalCm2,
      tacoCm: tacoCmEffective,
    });
    downloadBlob(blob, `${slugifyFilename(nome || 'biscoito-golfier')}.pdf`);
  }

  // Exportar Imagem PNG
  function handleDownloadPng() {
    if (canvas2dRef.current) {
      downloadCanvasAsPng(canvas2dRef.current, `${slugifyFilename(nome || 'biscoito-golfier')}-molde`);
    }
  }

  return (
    <div className="bandeira-workspace" style={{ gap: '20px' }}>
      <div className="bandeira-main-panel">
        <div className="bandeira-panel-header">
          <h2>
            <Cookie size={22} style={{ color: '#eab308', verticalAlign: 'middle', marginRight: '8px' }} />
            Acabamentos — Molde do Biscoito de Golfier
          </h2>
          <p>Informe as medidas do seu balão para gerar automaticamente os moldes das 3 partes do biscoito de Golfier.</p>
        </div>

        {/* Alternador 2D / 3D */}
        <div className="bandeira-sidebar-tabs" style={{ marginBottom: '16px', background: '#0f172a', padding: '6px', borderRadius: '8px' }}>
          <button
            type="button"
            className={viewMode === '2d' ? 'active' : ''}
            onClick={() => setViewMode('2d')}
          >
            <Layers size={16} />
            Moldes 2D (Desenho Técnico)
          </button>
          <button
            type="button"
            className={viewMode === '3d' ? 'active' : ''}
            onClick={() => setViewMode('3d')}
          >
            <Box size={16} />
            Visualização 3D (Montado)
          </button>
        </div>

        {/* Palco de Desenho 2D ou 3D */}
        <div
          className="bandeira-canvas-container"
          style={{
            position: 'relative',
            width: '100%',
            height: '520px',
            background: '#090d16',
            borderRadius: '12px',
            overflow: 'hidden',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {viewMode === '2d' ? (
            <canvas ref={canvas2dRef} width={850} height={520} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          ) : (
            <div ref={mount3dRef} style={{ width: '100%', height: '100%' }} />
          )}
        </div>
      </div>

      {/* Painel Lateral de Entrada de Medidas e Opcoes */}
      <div className="bandeira-side-panel" style={{ width: '380px', flexShrink: 0 }}>
        <div className="bandeira-side-content">
          <h3>
            <RefreshCw size={16} /> Medidas do Biscoito
          </h3>

          <label className="auth-field">
            <span>Nome do Projeto</span>
            <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Biscoito Balão 12m" />
          </label>

          {/* Seletor do Modo de Medida da Boca */}
          <div style={{ marginTop: '12px', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#94a3b8' }}>Medida da Boca do Balão</span>
            <div className="bandeira-sidebar-tabs" style={{ marginTop: '6px', background: '#0f172a' }}>
              <button
                type="button"
                className={modoBoca === 'arco' ? 'active' : ''}
                onClick={() => setModoBoca('arco')}
              >
                Por Arco da Boca
              </button>
              <button
                type="button"
                className={modoBoca === 'diametro' ? 'active' : ''}
                onClick={() => setModoBoca('diametro')}
              >
                Por Diâmetro Directo
              </button>
            </div>
          </div>

          {modoBoca === 'arco' ? (
            <label className="auth-field">
              <span>Arco da Boca do Balão (cm)</span>
              <input
                type="number"
                min={1}
                step={0.5}
                {...numericFieldProps(arcoBocaCm, setArcoBocaCm, 1)}
                placeholder="Ex: 40 cm"
              />
            </label>
          ) : (
            <label className="auth-field">
              <span>Diâmetro do Furo da Boca (cm)</span>
              <input
                type="number"
                min={1}
                step={0.5}
                {...numericFieldProps(diametroBocaDirectCm, setDiametroBocaDirectCm, 1)}
                placeholder="Ex: 25.5 cm"
              />
            </label>
          )}

          <label className="auth-field">
            <span>Tamanho / Diâmetro do Biscoito (cm)</span>
            <input
              type="number"
              min={1}
              step={0.5}
              {...numericFieldProps(diametroBiscoitoCm, setDiametroBiscoitoCm, 1)}
              placeholder="Ex: 60 cm"
            />
          </label>

          <label className="auth-field">
            <span>Altura do Biscoito (cm)</span>
            <input
              type="number"
              min={1}
              step={0.5}
              {...numericFieldProps(alturaBiscoitoCm, setAlturaBiscoitoCm, 1)}
              placeholder="Ex: 15 cm"
            />
          </label>

          <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid rgba(255, 255, 255, 0.1)' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#94a3b8' }}>Configuração de Plotagem no Taco (Quadriculado)</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '8px' }}>
              <label className="auth-field" style={{ marginTop: 0 }}>
                <span>Tamanho do Taco (cm)</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  {...numericFieldProps(tacoCm, setTacoCm, 5)}
                  placeholder="Ex: 5 cm"
                />
              </label>
              <label className="auth-field" style={{ marginTop: 0 }}>
                <span>Bainha do Taco (cm)</span>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  {...numericFieldProps(bainhaCm, setBainhaCm, 1)}
                  placeholder="Ex: 1 cm"
                />
              </label>
            </div>
            <div style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)', padding: '10px', borderRadius: '8px', marginTop: '10px' }}>
              <span style={{ color: '#93c5fd', fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                Resumo da Malha Quadriculada (Taco {tacoCmEffective}cm | Bainha {bainhaCmEffective}cm)
              </span>
              <div style={{ color: '#ffffff', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <span>• Tampo Superior: <strong>{tacosTampo} tacos</strong></span>
                <span>• Fundo Inferior: <strong>{tacosFundo} tacos</strong></span>
                <span>• Faixa Lateral: <strong>{tacosLateral} tacos</strong></span>
                <span style={{ color: '#facc15', marginTop: '4px', fontWeight: 700, fontSize: '13px' }}>
                  Total a Plotar: {tacosTotal} Tacos
                </span>
              </div>
            </div>
          </div>



          <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <button type="button" className="mold-save-button" style={{ background: '#2563eb' }} onClick={handlePlotarMolde}>
              <Printer size={16} />
              Plotar Molde em Tamanho Real (1:1)
            </button>

            <button type="button" className="mold-secondary-button" onClick={handleDownloadPdf}>
              <Download size={16} />
              Baixar PDF com Relatório
            </button>

            <button type="button" className="mold-secondary-button" onClick={handleDownloadPng}>
              <FileImage size={16} />
              Baixar Imagem (PNG)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
