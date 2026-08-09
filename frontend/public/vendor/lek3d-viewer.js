// Viewer 3D do balão (Three.js). Carregado sob demanda via import() pelo
// lek.html — mantém o Three.js (ES module) fora do script clássico.
// 'three' resolve pelo import map do lek.html; OrbitControls é relativo.
import * as THREE from './three.module.min.js';
import { OrbitControls } from './OrbitControls.js';

const CM = 0.01; // 1cm = 0.01 unidade de mundo (metro), igual moldeLathe.ts
let renderer, scene, camera, controls, mesh, animId;

function ensureSetup() {
    if (renderer) return;
    const wrap = document.getElementById('lek-3d-canvas-wrap');
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(wrap.clientWidth || 800, wrap.clientHeight || 600);
    wrap.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0b0f);

    camera = new THREE.PerspectiveCamera(45, (wrap.clientWidth || 800) / (wrap.clientHeight || 600), 0.01, 1000);
    camera.position.set(0, 0, 4);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const d1 = new THREE.DirectionalLight(0xffffff, 0.85); d1.position.set(3, 5, 4); scene.add(d1);
    const d2 = new THREE.DirectionalLight(0xffffff, 0.35); d2.position.set(-4, -2, -3); scene.add(d2);

    window.addEventListener('resize', onResize);
}

function onResize() {
    if (!renderer) return;
    const wrap = document.getElementById('lek-3d-canvas-wrap');
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
}

function animate() {
    animId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

function disposeMesh() {
    if (!mesh) return;
    scene.remove(mesh);
    mesh.geometry.dispose();
    if (mesh.material.map) mesh.material.map.dispose();
    mesh.material.dispose();
    mesh = null;
}

function addBalloon(geometry, material) {
    disposeMesh();
    mesh = new THREE.Mesh(geometry, material);
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    const bs = geometry.boundingSphere;
    const center = bs ? bs.center.clone() : new THREE.Vector3();
    mesh.position.y = -center.y;           // centraliza na vertical
    scene.add(mesh);
    const radius = bs ? bs.radius : 1;
    camera.position.set(0, 0, radius * 3.0);
    controls.target.set(0, 0, 0);
    controls.update();
}

/** config: { profile: [[raioCm, alturaCm]...] boca->bico, textureUrl, repeatX, total } */
export function openBalloon(config) {
    ensureSetup();
    onResize();
    const pts = config.profile.map(([r, y]) => new THREE.Vector2(Math.max(0, r) * CM, y * CM));
    let curvePts = pts;
    if (pts.length >= 3) {
        const curve = new THREE.SplineCurve(pts);
        curvePts = curve.getPoints(Math.max(pts.length, 140));
        curvePts.forEach(p => { p.x = Math.max(0, p.x); });
    }
    const segments = Math.max(3, config.total | 0);
    const geometry = new THREE.LatheGeometry(curvePts, segments);
    geometry.computeBoundingSphere();

    new THREE.TextureLoader().load(config.textureUrl, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.repeat.x = config.repeatX;
        tex.needsUpdate = true;
        addBalloon(geometry, new THREE.MeshStandardMaterial({
            map: tex, side: THREE.DoubleSide, metalness: 0.0, roughness: 0.85
        }));
    }, undefined, () => {
        addBalloon(geometry, new THREE.MeshStandardMaterial({
            color: 0xcfd8dc, side: THREE.DoubleSide, metalness: 0.0, roughness: 0.9
        }));
    });
    if (!animId) animate();
}

export function closeViewer() {
    if (animId) { cancelAnimationFrame(animId); animId = null; }
    disposeMesh();
}
