import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, ImagePlus, Loader2, RotateCcw } from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MoldSilhouettePreview } from '../components/MoldSilhouettePreview';
import { buildProfilePoints, SECTION_COLORS } from '../lib/moldGeometry';
import { buildLatheGeometry } from '../lib/moldeLathe';
import { slugifyFilename } from '../lib/pdfExport';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Modelo3D } from '../types';

const SCENE_BACKGROUND = 0x0f1726;
const PLACEHOLDER_COLOR = SECTION_COLORS.bojo;

export function Modelo3DWorkspace() {
  const { token } = useAuth();
  const [molds, setMolds] = useState<Modelo3D[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMoldId, setSelectedMoldId] = useState<number | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .listModelos3D(token)
      .then((response) => {
        if (cancelled) return;
        setMolds(response.data);
        setSelectedMoldId((current) => current ?? response.data[0]?.id ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Nao foi possivel carregar os modelos.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Efeito A: monta a cena uma unica vez.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(SCENE_BACKGROUND);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    camera.position.set(0, 1, 2.5);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth || 1, container.clientHeight || 1, false);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controlsRef.current = controls;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x1a2436, 1.3));
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(2, 3, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.6);
    fill.position.set(-3, 1, -2);
    scene.add(fill);

    const material = new THREE.MeshStandardMaterial({
      color: PLACEHOLDER_COLOR,
      side: THREE.DoubleSide,
      roughness: 0.6,
      metalness: 0.05,
    });
    materialRef.current = material;

    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    meshRef.current = mesh;
    scene.add(mesh);

    let rafId = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      rafId = requestAnimationFrame(animate);
    };
    animate();

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width === 0 || height === 0) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      controls.dispose();
      material.map?.dispose();
      material.dispose();
      mesh.geometry.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      rendererRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      meshRef.current = null;
      materialRef.current = null;
    };
  }, []);

  const selectedMold = molds.find((mold) => mold.id === selectedMoldId) ?? null;

  // Efeito B: reconstroi a geometria quando o molde selecionado muda.
  useEffect(() => {
    const mesh = meshRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!mesh || !camera || !controls || !selectedMold) return;

    const geometry = buildLatheGeometry(selectedMold.pontos, selectedMold.quantidade_gomos);
    if (!geometry) return;

    mesh.geometry.dispose();
    mesh.geometry = geometry;

    const sphere = geometry.boundingSphere;
    if (sphere && sphere.radius > 0) {
      const fovRad = (camera.fov * Math.PI) / 180;
      const margin = 1.4;
      const distance = (sphere.radius / Math.sin(fovRad / 2)) * margin;
      camera.position.set(sphere.center.x, sphere.center.y + sphere.radius * 0.25, sphere.center.z + distance);
      camera.near = Math.max(0.01, distance - sphere.radius * 3);
      camera.far = distance + sphere.radius * 3;
      camera.updateProjectionMatrix();
      controls.target.copy(sphere.center);
      controls.update();
    }
  }, [selectedMold]);

  // Efeito C: recarrega a textura quando a imagem muda.
  useEffect(() => {
    const material = materialRef.current;
    if (!material) return;

    if (!imageFile) {
      material.map?.dispose();
      material.map = null;
      material.color.set(PLACEHOLDER_COLOR);
      material.needsUpdate = true;
      return;
    }

    setImageError(null);
    const url = URL.createObjectURL(imageFile);
    const loader = new THREE.TextureLoader();
    let cancelled = false;
    loader.load(
      url,
      (texture) => {
        if (cancelled) {
          texture.dispose();
          URL.revokeObjectURL(url);
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        material.map?.dispose();
        material.color.set(0xffffff);
        material.map = texture;
        material.needsUpdate = true;
        URL.revokeObjectURL(url);
      },
      undefined,
      () => {
        if (cancelled) return;
        setImageError('Nao foi possivel carregar essa imagem.');
        URL.revokeObjectURL(url);
      }
    );

    return () => {
      cancelled = true;
    };
  }, [imageFile]);

  const handleImageChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setImageFile(file);
    event.target.value = '';
  }, []);

  const handleDownloadImage = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const dataUrl = renderer.domElement.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `${slugifyFilename(selectedMold?.nome ?? 'modelo-3d')}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, [selectedMold]);

  return (
    <div className="bandeira-workspace">
      <div className="bandeira-main-panel">
        <div className="bandeira-panel-header">
          <h2>3D e Fotos — Preview do Molde</h2>
          <p>Escolha um modelo 3D, suba a foto do cliente e veja ela aplicada no balao em 3D.</p>
        </div>

        <div className="modelo3d-canvas-stage">
          <div ref={containerRef} className="modelo3d-canvas-container" />
        </div>

        <div className="modelo3d-actions-row">
          <label className="mold-save-button modelo3d-upload-label">
            <ImagePlus size={16} />
            {imageFile ? 'Trocar imagem' : 'Subir imagem'}
            <input type="file" accept="image/*" onChange={handleImageChange} className="modelo3d-file-input" />
          </label>
          {imageFile ? (
            <button type="button" className="mold-secondary-button" onClick={() => setImageFile(null)}>
              <RotateCcw size={16} />
              Remover imagem
            </button>
          ) : null}
          <button type="button" className="mold-secondary-button" onClick={handleDownloadImage} disabled={!selectedMold}>
            <Download size={16} />
            Baixar imagem
          </button>
        </div>

        {imageError ? <p className="mold-import-error">{imageError}</p> : null}
        {!imageFile ? (
          <p className="bandeira-size-hint">
            Sem imagem, o balao aparece so com uma cor solida — suba uma foto pra ela envolver o modelo 3D.
          </p>
        ) : null}
      </div>

      <div className="bandeira-side-panel">
        <h3>Modelos 3D</h3>
        {loading ? (
          <p className="bandeira-size-hint">
            <Loader2 size={14} className="mold-import-spinner" /> Carregando modelos...
          </p>
        ) : error ? (
          <p className="mold-import-error">{error}</p>
        ) : molds.length === 0 ? (
          <p className="bandeira-size-hint">Nenhum modelo 3D cadastrado ainda.</p>
        ) : (
          <div className="modelo3d-mold-list">
            {molds.map((mold) => (
              <button
                key={mold.id}
                type="button"
                className={`modelo3d-mold-item${mold.id === selectedMoldId ? ' selected' : ''}`}
                onClick={() => setSelectedMoldId(mold.id)}
              >
                <MoldSilhouettePreview
                  points={buildProfilePoints(mold.pontos).map((p) => ({
                    alturaAcumuladaCm: p.yCm,
                    larguraMeiaCm: p.halfWidthCm,
                  }))}
                />
                <strong>{mold.nome}</strong>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
