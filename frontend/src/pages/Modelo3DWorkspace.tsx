import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { AlertTriangle, ChevronLeft, Download, Eye, EyeOff, Film, ImagePlus, Loader2, RotateCcw, X } from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MoldSilhouettePreview } from '../components/MoldSilhouettePreview';

interface MoldData {
  name?: string;
  perimeter: number[];
  heightAcum: number[];
}

interface MoldModel {
  key: string;
  name: string;
  category: string;
}

const CATEGORY_ORDER = [
  'Modelado',
  'Piao',
  'Bagda',
  'Truffy',
  'Careca',
  'Golfier',
  'Pigolbag',
  'Lapidado',
  'Hally',
  'Barrica',
  'Tangerina',
  'Magico',
  'Otros',
  'Corte Recto',
];

const CATEGORY_RULES: [string, RegExp][] = [
  ['Corte Recto', /corte.?ret[oa]/i],
  ['Tangerina', /tangerin/i],
  ['Barrica', /barrica/i],
  ['Hally', /hally/i],
  ['Lapidado', /lapidado/i],
  ['Pigolbag', /pi[gn]ol?bag|pigobald|piglbag/i],
  ['Golfier', /golfier/i],
  ['Careca', /careca/i],
  ['Bagda', /bagda/i],
  ['Truffy', /truff/i],
  ['Piao', /piao/i],
  ['Magico', /magico/i],
  ['Modelado', /modelado/i],
];

function categorize(key: string): string {
  for (const [name, re] of CATEGORY_RULES) {
    if (re.test(key)) return name;
  }
  return 'Otros';
}

export function Modelo3DWorkspace() {
  const [currentData, setCurrentData] = useState<Record<string, MoldData> | null>(null);
  const [allModels, setAllModels] = useState<MoldModel[]>([]);
  const [modelsByCategory, setModelsByCategory] = useState<Record<string, MoldModel[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMoldKey, setSelectedMoldKey] = useState<string>('');

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [webglError, setWebglError] = useState(false);

  const [currentCategory, setCurrentCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showingTex, setShowingTex] = useState(false);

  // Video recording states
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSecondsLeft, setRecordingSecondsLeft] = useState(10);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const fillMeshRef = useRef<THREE.Mesh | null>(null);
  const wireMeshRef = useRef<THREE.Mesh | null>(null);
  const texMeshRef = useRef<THREE.Mesh | null>(null);
  const geometryRef = useRef<THREE.LatheGeometry | null>(null);

  // Load static models data.json
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch('/data.json')
      .then((res) => {
        if (!res.ok) throw new Error('Não foi possível carregar o arquivo data.json');
        return res.json();
      })
      .then((data: Record<string, MoldData>) => {
        if (cancelled) return;
        setCurrentData(data);

        const modelsList = Object.keys(data)
          .map((key) => ({
            key,
            name: data[key].name || key,
            category: categorize(key),
          }))
          .sort((a, b) => a.name.localeCompare(b.name, 'pt'));

        setAllModels(modelsList);

        const byCat: Record<string, MoldModel[]> = {};
        modelsList.forEach((m) => {
          if (!byCat[m.category]) byCat[m.category] = [];
          byCat[m.category].push(m);
        });
        setModelsByCategory(byCat);

        // Default to Piao3 or fallback to first key
        const defaultKey = data['Piao3'] ? 'Piao3' : (Object.keys(data)[0] || '');
        setSelectedMoldKey(defaultKey);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Erro ao carregar dados do arquivo JSON.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Effect A: Mount Three.js scene once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    setWebglError(false);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x222222);
    sceneRef.current = scene;

    const initialAspect = (container.clientWidth || 1) / (container.clientHeight || 1);
    const camera = new THREE.PerspectiveCamera(45, initialAspect, 0.01, 100);
    camera.position.z = 5;
    cameraRef.current = camera;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch {
      setWebglError(true);
      return;
    }
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth || 1, container.clientHeight || 1);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      setWebglError(true);
    };
    const handleContextRestored = () => setWebglError(false);
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.5;
    controlsRef.current = controls;

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const keyLight = new THREE.DirectionalLight(0xedc240, 0.8);
    keyLight.position.set(3, 5, 3);
    scene.add(keyLight);

    const dummyGeometry = new THREE.BufferGeometry();

    const fillMesh = new THREE.Mesh(
      dummyGeometry,
      new THREE.MeshPhongMaterial({
        color: 0xedc240,
        emissive: 0x2a1e00,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
      })
    );
    scene.add(fillMesh);
    fillMeshRef.current = fillMesh;

    const wireMesh = new THREE.Mesh(
      dummyGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xedc240,
        wireframe: true,
        transparent: true,
        opacity: 0.95,
      })
    );
    scene.add(wireMesh);
    wireMeshRef.current = wireMesh;

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
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);
      controls.dispose();

      if (texMeshRef.current) {
        scene.remove(texMeshRef.current);
        if (texMeshRef.current.material instanceof THREE.Material) {
          texMeshRef.current.material.dispose();
        }
      }

      fillMesh.material.dispose();
      wireMesh.material.dispose();
      dummyGeometry.dispose();

      if (geometryRef.current) {
        geometryRef.current.dispose();
      }

      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      rendererRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      fillMeshRef.current = null;
      wireMeshRef.current = null;
      texMeshRef.current = null;
      geometryRef.current = null;
    };
  }, []);

  // Effect B: Rebuild geometry when selectedMoldKey or data changes
  useEffect(() => {
    const fillMesh = fillMeshRef.current;
    const wireMesh = wireMeshRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const container = containerRef.current;
    if (!fillMesh || !wireMesh || !scene || !camera || !controls || !currentData || !selectedMoldKey) return;

    const g = currentData[selectedMoldKey];
    if (!g) return;

    if (container && container.clientWidth > 0 && container.clientHeight > 0) {
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
    }

    const srcX = g.perimeter;
    const srcY = g.heightAcum;

    let points: THREE.Vector2[] = [];
    for (let i = 0; i < srcX.length; i++) {
      points.push(new THREE.Vector2(srcX[i] / (2 * Math.PI), srcY[i]));
    }

    const rawH = points[points.length - 1].y;
    const rawR = Math.max(...points.map((p) => p.x));
    const norm = 2.0 / Math.max(rawH, rawR * 2);
    points = points.map((p) => new THREE.Vector2(p.x * norm, p.y * norm));

    const yOffset = -rawH * norm / 2;

    const geometry = new THREE.LatheGeometry(points, 60);

    if (geometryRef.current) {
      geometryRef.current.dispose();
    }
    geometryRef.current = geometry;

    fillMesh.geometry = geometry;
    fillMesh.position.y = yOffset;

    wireMesh.geometry = geometry;
    wireMesh.position.y = yOffset;

    if (texMeshRef.current) {
      texMeshRef.current.geometry = geometry;
      texMeshRef.current.position.y = yOffset;
    }

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
  }, [selectedMoldKey, currentData]);

  // Effect C: Reload texture when imageFile changes
  useEffect(() => {
    const scene = sceneRef.current;
    const fillMesh = fillMeshRef.current;
    const wireMesh = wireMeshRef.current;
    if (!scene || !fillMesh || !wireMesh) return;

    if (!imageFile) {
      if (texMeshRef.current) {
        scene.remove(texMeshRef.current);
        if (texMeshRef.current.material instanceof THREE.Material) {
          texMeshRef.current.material.dispose();
        }
        texMeshRef.current = null;
      }
      fillMesh.visible = true;
      wireMesh.visible = true;
      setShowingTex(false);
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
        texture.wrapS = THREE.RepeatWrapping;
        texture.colorSpace = THREE.SRGBColorSpace;

        const mat = new THREE.MeshPhongMaterial({
          map: texture,
          side: THREE.DoubleSide,
          shininess: 20,
        });

        if (texMeshRef.current) {
          scene.remove(texMeshRef.current);
          if (texMeshRef.current.material instanceof THREE.Material) {
            texMeshRef.current.material.dispose();
          }
        }

        if (geometryRef.current) {
          const texMesh = new THREE.Mesh(geometryRef.current, mat);
          texMesh.position.y = fillMesh.position.y;
          scene.add(texMesh);
          texMeshRef.current = texMesh;

          fillMesh.visible = false;
          wireMesh.visible = false;
          setShowingTex(true);
        }

        URL.revokeObjectURL(url);
      },
      undefined,
      () => {
        if (cancelled) return;
        setImageError('Não foi possível carregar essa imagem.');
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

  const handleToggleWireframe = useCallback(() => {
    const nextShowing = !showingTex;
    setShowingTex(nextShowing);

    const fillMesh = fillMeshRef.current;
    const wireMesh = wireMeshRef.current;
    const texMesh = texMeshRef.current;

    if (fillMesh && wireMesh) {
      fillMesh.visible = !nextShowing;
      wireMesh.visible = !nextShowing;
    }
    if (texMesh) {
      texMesh.visible = nextShowing;
    }
  }, [showingTex]);

  const handleDownloadImage = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const currentMold = allModels.find((m) => m.key === selectedMoldKey);
    const filename = currentMold ? currentMold.name.replace(/\s+/g, '-').toLowerCase() : 'modelo-3d';
    const dataUrl = renderer.domElement.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `${filename}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, [allModels, selectedMoldKey]);

  const handleDownloadVideo = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer || isRecording) return;

    const canvas = renderer.domElement;
    let stream: MediaStream;
    try {
      stream = (canvas as any).captureStream ? (canvas as any).captureStream(30) : (canvas as any).mozCaptureStream(30);
    } catch (e) {
      alert('Não foi possível capturar o vídeo do canvas neste navegador.');
      return;
    }

    const types = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4;codecs=avc1',
      'video/mp4',
    ];
    let selectedType = '';
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        selectedType = type;
        break;
      }
    }

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, selectedType ? { mimeType: selectedType } : undefined);
    } catch (e) {
      alert('Não foi possível iniciar o gravador de vídeo neste dispositivo.');
      return;
    }

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      const extension = selectedType.includes('mp4') ? 'mp4' : 'webm';
      const blob = new Blob(chunks, { type: selectedType || 'video/webm' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;

      const currentMold = allModels.find((m) => m.key === selectedMoldKey);
      const filename = currentMold ? currentMold.name.replace(/\s+/g, '-').toLowerCase() : 'modelo-3d';

      link.download = `video-${filename}.${extension}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setIsRecording(false);
    };

    setIsRecording(true);
    setRecordingSecondsLeft(10);
    recorder.start();

    const interval = setInterval(() => {
      setRecordingSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          if (recorder.state !== 'inactive') {
            recorder.stop();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [allModels, selectedMoldKey, isRecording]);

  const handleSelectMold = useCallback((key: string) => {
    setSelectedMoldKey(key);
  }, []);

  const handleSelectCategory = useCallback((cat: string) => {
    setCurrentCategory(cat);
    setSearchQuery('');
  }, []);

  const handleBackToCategories = useCallback(() => {
    setCurrentCategory(null);
    setSearchQuery('');
  }, []);

  // Filter models based on search or category select
  const filteredModels = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      const pool = currentCategory ? (modelsByCategory[currentCategory] || []) : allModels;
      return pool.filter((m) => m.name.toLowerCase().includes(q));
    }
    if (currentCategory) {
      return modelsByCategory[currentCategory] || [];
    }
    return [];
  }, [allModels, modelsByCategory, currentCategory, searchQuery]);

  return (
    <div className="bandeira-workspace">
      <div className="bandeira-main-panel">
        <div className="bandeira-panel-header">
          <h2>3D e Fotos — Preview do Molde</h2>
          <p>Escolha um modelo 3D, suba a foto do cliente e veja ela aplicada no balão em 3D.</p>
        </div>

        <div className="modelo3d-canvas-stage">
          {webglError && (
            <div className="modelo3d-canvas-fallback">
              <AlertTriangle size={28} />
              <p>Não foi possível abrir a prévia 3D nesse navegador ou aparelho.</p>
              <span>Você ainda pode escolher o modelo e enviar a foto — só a prévia em 3D que não aparece aqui.</span>
            </div>
          )}
          {isRecording && (
            <div className="modelo3d-recording-overlay">
              <div className="modelo3d-recording-badge">
                <span className="modelo3d-recording-dot"></span>
                Gravando Vídeo: {recordingSecondsLeft}s
              </div>
            </div>
          )}
          <div
            ref={containerRef}
            className="modelo3d-canvas-container"
            style={webglError ? { display: 'none' } : undefined}
          />
        </div>

        <div className="modelo3d-actions-row">
          <label className="mold-save-button modelo3d-upload-label">
            <ImagePlus size={16} />
            {imageFile ? 'Trocar imagem' : 'Subir imagem'}
            <input type="file" accept="image/*" onChange={handleImageChange} className="modelo3d-file-input" />
          </label>
          
          {imageFile && (
            <>
              <button type="button" className="mold-secondary-button" onClick={() => setImageFile(null)}>
                <RotateCcw size={16} />
                Remover imagem
              </button>
              
              <button type="button" className="mold-secondary-button" onClick={handleToggleWireframe}>
                {showingTex ? <EyeOff size={16} /> : <Eye size={16} />}
                {showingTex ? 'Ver Wireframe' : 'Ver Imagem'}
              </button>
            </>
          )}

          <button
            type="button"
            className="mold-secondary-button"
            onClick={handleDownloadImage}
            disabled={!selectedMoldKey || webglError}
          >
            <Download size={16} />
            Baixar imagem
          </button>

          <button
            type="button"
            className="mold-secondary-button"
            onClick={handleDownloadVideo}
            disabled={!selectedMoldKey || webglError || isRecording}
          >
            <Film size={16} />
            {isRecording ? `Gravando (${recordingSecondsLeft}s)` : 'Baixar Vídeo (10s)'}
          </button>
        </div>

        {imageError && <p className="mold-import-error">{imageError}</p>}
        {!imageFile && (
          <p className="bandeira-size-hint">
            Sem imagem, o balão aparece só com uma cor sólida — suba uma foto pra ela envolver o modelo 3D.
          </p>
        )}
      </div>

      <div className="bandeira-side-panel">
        <h3>Modelos 3D</h3>
        {loading ? (
          <p className="bandeira-size-hint flex items-center justify-center p-4">
            <Loader2 size={14} className="animate-spin mr-2" /> Carregando modelos...
          </p>
        ) : error ? (
          <p className="mold-import-error">{error}</p>
        ) : (
          <div className="modelo3d-sidebar-content">
            <div className="modelo3d-search-box">
              <input
                type="text"
                placeholder="Buscar molde..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="modelo3d-search-input-field"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="modelo3d-search-clear-btn"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {searchQuery || currentCategory ? (
              <div className="modelo3d-list-wrapper">
                <div className="modelo3d-list-header">
                  <button
                    type="button"
                    onClick={handleBackToCategories}
                    className="modelo3d-back-btn"
                  >
                    <ChevronLeft size={16} />
                    <span>Categorias</span>
                  </button>
                  {currentCategory && !searchQuery && (
                    <span className="modelo3d-category-title">{currentCategory}</span>
                  )}
                </div>

                <div className="modelo3d-mold-grid">
                  {filteredModels.length === 0 ? (
                    <div className="modelo3d-empty-state">Nenhum molde encontrado</div>
                  ) : (
                    filteredModels.map((m) => {
                      const isSelected = m.key === selectedMoldKey;
                      const g = currentData?.[m.key];
                      const previewPoints = g
                        ? g.perimeter.map((perim, idx) => ({
                            alturaAcumuladaCm: g.heightAcum[idx] || 0,
                            larguraMeiaCm: perim / (2 * Math.PI),
                          }))
                        : [];

                      return (
                        <button
                          key={m.key}
                          type="button"
                          className={`modelo3d-mold-item-card${isSelected ? ' selected' : ''}`}
                          onClick={() => handleSelectMold(m.key)}
                        >
                          <div className="modelo3d-mold-preview-wrap">
                            <MoldSilhouettePreview points={previewPoints} />
                          </div>
                          <span className="modelo3d-mold-name" title={m.name}>
                            {m.name}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            ) : (
              <div className="modelo3d-categories-grid">
                {CATEGORY_ORDER.map((cat) => {
                  const items = modelsByCategory[cat];
                  if (!items || items.length === 0) return null;

                  return (
                    <button
                      key={cat}
                      type="button"
                      className="modelo3d-category-card"
                      onClick={() => handleSelectCategory(cat)}
                    >
                      <span className="modelo3d-category-name">{cat}</span>
                      <span className="modelo3d-category-badge">{items.length}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
