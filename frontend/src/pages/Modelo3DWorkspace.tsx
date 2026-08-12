import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { AlertTriangle, Box, Building2, ChevronLeft, Cloud, Cookie, Download, Eye, EyeOff, Film, Flag, ImagePlus, Lightbulb, Loader2, Moon, PaintBucket, RotateCcw, Sparkles, Sun, Triangle, X } from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MoldSilhouettePreview } from '../components/MoldSilhouettePreview';
import { LekWarpEditor, type WarpGrid } from '../components/LekWarpEditor';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { hexToRgb } from '../lib/colorMath';
import { renderLanternaGridToImageFile } from '../lib/lanternaGrid';
import type { LanternaProject } from '../types';

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

/** Quantas cordinhas desenhar no leque (converge na ponta do balao, abre na
 * borda de cima do banner) — mais que 2 fica com cara de "cordao de festa"
 * de verdade, igual a referencia. */
const BANNER_STRING_COUNT: number = 7;

/**
 * Banner retangular (bandeira/painel/letreiro) pendurado bem embaixo, no
 * meio, na ponta de baixo do balao — o cliente so importa uma imagem
 * qualquer do celular/PC (igual "Subir imagem" no balao), sem projeto salvo
 * nenhum envolvido. Sempre centralizado (nunca deslocado pro lado) pra bater
 * com a foto de referencia.
 */
function buildHangingBannerGroup(texture: THREE.Texture, tipWorldY: number, totalHeight: number, lineColor: number): THREE.Group {
  const image = texture.image as { width?: number; height?: number } | undefined;
  const aspect = image?.width && image.height ? image.width / image.height : 1;
  const width = totalHeight * 0.6;
  const height = width / Math.max(0.2, aspect);
  // corda mais comprida -> bandeira/painel/letreiro mais afastado do balao
  const stringLength = totalHeight * 0.9;
  const topY = -stringLength;

  const group = new THREE.Group();

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide })
  );
  plane.position.y = topY - height / 2;
  group.add(plane);

  const tip = new THREE.Vector3(0, 0, 0);
  const lineMaterial = new THREE.LineBasicMaterial({ color: lineColor });
  for (let i = 0; i < BANNER_STRING_COUNT; i += 1) {
    const t = BANNER_STRING_COUNT === 1 ? 0.5 : i / (BANNER_STRING_COUNT - 1);
    const corner = new THREE.Vector3(-width / 2 + t * width, topY, 0);
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([tip, corner]), lineMaterial));
  }

  group.position.set(0, tipWorldY, 0);
  return group;
}

/** Cor da cordinha que sempre aparece, seja fundo claro ou escuro (a
 * referencia usa preto num fundo branco -- aqui o fundo e configuravel). */
function contrastingLineColor(bgHex: string): number {
  const { r, g, b } = hexToRgb(bgHex);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 140 ? 0x1a1a1a : 0xe5e5e5;
}

function disposeHangingBannerGroup(group: THREE.Group) {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      if (obj.material instanceof THREE.MeshBasicMaterial) {
        obj.material.map?.dispose();
      }
      if (obj.material instanceof THREE.Material) {
        obj.material.dispose();
      }
    } else if (obj instanceof THREE.Line) {
      obj.geometry.dispose();
      if (obj.material instanceof THREE.Material) {
        obj.material.dispose();
      }
    }
  });
}

export const FOGOS_MAX_GAIOLAS = 6;
export const FOGOS_MAX_PRATOS = 60;

// Todos os pratos na MESMA cor (dourado). Antes cada prato pegava uma cor
// diferente de uma paleta; agora é uma cor só.
const PRATO_COLOR = 0xd4af37;

/**
 * Monta a ordem da corrente: 1a gaiola sempre no topo (encaixe com as
 * cordinhas), as gaiolas restantes espalhadas em intervalos IGUAIS dentro da
 * fileira de pratos — igual a referencia real, onde a gaiola aparece como
 * uma juncao periodica ao longo da corrente, nao so uma vez no topo.
 */
function buildFogosSequence(gaiolaCount: number, pratoCount: number): Array<'gaiola' | 'prato'> {
  const sequence: Array<'gaiola' | 'prato'> = [];
  if (gaiolaCount <= 0) {
    for (let i = 0; i < pratoCount; i += 1) {
      sequence.push('prato');
    }
    return sequence;
  }

  sequence.push('gaiola');
  const extraGaiolas = gaiolaCount - 1;
  const groups = extraGaiolas + 1;
  const base = Math.floor(pratoCount / groups);
  const remainder = pratoCount % groups;

  for (let g = 0; g < groups; g += 1) {
    const countForGroup = base + (g < remainder ? 1 : 0);
    for (let k = 0; k < countForGroup; k += 1) {
      sequence.push('prato');
    }
    if (g < groups - 1) {
      sequence.push('gaiola');
    }
  }

  return sequence;
}

/** Segmentos radiais dos pratos/gaiolas — 6 = sextavado (hexagonal), igual
 * aos modelos reais de referencia (nao redondo). */
const FOGOS_PRISM_SEGMENTS = 6;

/**
 * Corrente de gaiolas + pratos pendurada no meio, embaixo do balao (igual a
 * foto de referencia) — gaiola = caixinha escura ESPAÇADA (fica "boiando" na
 * cordinha, com distancia visivel pros vizinhos), prato = disco sextavado
 * colorido ENCOSTADO no vizinho (forma um tubo continuo, sem gap) — a mesma
 * distincao das fotos reais. Devolve tambem a altura local (Y) onde a
 * corrente termina, pra plugar o efeito de fogos ali.
 */
function buildFogosChainGroup(
  gaiolas: number,
  pratos: number,
  tipWorldY: number,
  totalHeight: number,
  lineColor: number
): { group: THREE.Group; bottomWorldY: number } {
  const group = new THREE.Group();
  const unitSize = totalHeight * 0.085;
  const pratoGap = unitSize * 0.04;
  const gaiolaGap = unitSize * 0.95;
  const stringLength = totalHeight * 0.3;
  const topY = -stringLength;
  let cursorY = topY;

  const gaiolaMaterial = new THREE.MeshPhongMaterial({ color: 0x262626, shininess: 15 });
  const gaiolaCount = Math.max(0, Math.min(FOGOS_MAX_GAIOLAS, Math.round(gaiolas)));
  const pratoCount = Math.max(0, Math.min(FOGOS_MAX_PRATOS, Math.round(pratos)));
  const pratoHeight = unitSize * 0.2; // prato = disco fino (mais baixo que a gaiola)

  const sequence = buildFogosSequence(gaiolaCount, pratoCount);
  sequence.forEach((unit, index) => {
    if (unit === 'gaiola') {
      const cube = new THREE.Mesh(
        new THREE.CylinderGeometry(unitSize * 0.5, unitSize * 0.5, unitSize * 0.7, FOGOS_PRISM_SEGMENTS),
        gaiolaMaterial
      );
      cube.position.y = cursorY - (unitSize * 0.7) / 2;
      group.add(cube);
      cursorY -= unitSize * 0.7;
    } else {
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(unitSize * 0.5, unitSize * 0.5, pratoHeight, FOGOS_PRISM_SEGMENTS),
        new THREE.MeshPhongMaterial({ color: PRATO_COLOR, shininess: 60 })
      );
      disc.position.y = cursorY - pratoHeight / 2;
      group.add(disc);
      cursorY -= pratoHeight;
    }

    const nextUnit = sequence[index + 1];
    if (nextUnit) {
      cursorY -= unit === 'gaiola' || nextUnit === 'gaiola' ? gaiolaGap : pratoGap;
    }
  });

  // Cordinhas correm o comprimento INTEIRO da corrente (balao ate o fundo do
  // ultimo prato/gaiola), nao so ate o primeiro elemento -- igual a foto de
  // referencia, onde o fio fica visivel nos vaos entre os elementos a
  // corrente toda (fica "escondido" atras dos elementos solidos, mas
  // reaparece em cada vao).
  // Uma cordinha em CADA PONTA (canto) do hexagono dos pratos/gaiolas — corre
  // reta do topo (boca do balao) ate o fundo da corrente, no raio dos
  // pratos. Angulo casado com os vertices da CylinderGeometry (x = r·senθ,
  // z = r·cosθ, thetaStart = 0) pra a linha cair exatamente na quina.
  const lineMaterial = new THREE.LineBasicMaterial({ color: lineColor });
  const cordaRadius = unitSize * 0.5;
  for (let k = 0; k < FOGOS_PRISM_SEGMENTS; k += 1) {
    const theta = (k / FOGOS_PRISM_SEGMENTS) * Math.PI * 2;
    const x = cordaRadius * Math.sin(theta);
    const z = cordaRadius * Math.cos(theta);
    group.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, 0, z),
        new THREE.Vector3(x, cursorY, z),
      ]),
      lineMaterial
    ));
  }

  group.position.set(0, tipWorldY, 0);
  return { group, bottomWorldY: tipWorldY + cursorY };
}

function disposeFogosChainGroup(group: THREE.Group) {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      if (obj.material instanceof THREE.Material) {
        obj.material.dispose();
      }
    } else if (obj instanceof THREE.Line) {
      obj.geometry.dispose();
      if (obj.material instanceof THREE.Material) {
        obj.material.dispose();
      }
    }
  });
}



interface FireworkParticleSystem {
  points: THREE.Object3D;
  update: (delta: number) => void;
  dispose: () => void;
}

const FOGOS_ROCKET_COUNT = 8;
const FOGOS_PARTICLE_PER_ROCKET = 90;
const FOGOS_STREAK_PER_ROCKET = 36;

const FOGOS_BURST_PALETTES = [
  // Ciano / Azul Elétrico (como na imagem de referência 3)
  { main: new THREE.Color(0x00d5ff), core: new THREE.Color(0x99f0ff), trail: new THREE.Color(0x0088ff) },
  // Ouro / Amarelo (como na imagem de referência 4)
  { main: new THREE.Color(0xffcc00), core: new THREE.Color(0xffff88), trail: new THREE.Color(0xff8800) },
  // Rosa / Magenta
  { main: new THREE.Color(0xff00aa), core: new THREE.Color(0xffaaff), trail: new THREE.Color(0xff0066) },
  // Verde Elétrico
  { main: new THREE.Color(0x00ff55), core: new THREE.Color(0x99ffcc), trail: new THREE.Color(0x00cc44) },
  // Violeta
  { main: new THREE.Color(0xcc00ff), core: new THREE.Color(0xee99ff), trail: new THREE.Color(0x8800cc) },
];

const FOGOS_POINT_VERTEX_SHADER = `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (16.0 / max(0.001, -mvPosition.z));
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FOGOS_POINT_FRAGMENT_SHADER = `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float edge = smoothstep(0.5, 0.05, d);
    gl_FragColor = vec4(vColor, vAlpha * edge);
  }
`;

const FOGOS_STREAK_VERTEX_SHADER = `
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FOGOS_STREAK_FRAGMENT_SHADER = `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    gl_FragColor = vec4(vColor, vAlpha);
  }
`;

interface FireworkParticleSystem {
  points: THREE.Object3D;
  update: (delta: number) => void;
  dispose: () => void;
}

function createFireworkParticleSystem(totalHeight: number): FireworkParticleSystem {
  const group = new THREE.Group();

  const numRockets = FOGOS_ROCKET_COUNT;
  const totalParticles = numRockets * FOGOS_PARTICLE_PER_ROCKET;
  const totalStreaks = numRockets * FOGOS_STREAK_PER_ROCKET;

  // Propriedades por foguete (Fase 1: Lançamento -> Fase 2: Explosão)
  const rocketState = new Array(numRockets);
  for (let r = 0; r < numRockets; r++) {
    rocketState[r] = {
      origin: new THREE.Vector3(),
      target: new THREE.Vector3(),
      clock: 0,
      launchDuration: 0.35 + Math.random() * 0.25,
      burstDuration: 0.9 + Math.random() * 0.6,
      paletteIdx: r % FOGOS_BURST_PALETTES.length,
      burstRadius: (0.4 + Math.random() * 0.4) * totalHeight,
    };
  }

  function launchRocket(rIdx: number) {
    const st = rocketState[rIdx];
    st.clock = 0;
    st.launchDuration = 0.3 + Math.random() * 0.25;
    st.burstDuration = 0.8 + Math.random() * 0.6;
    st.paletteIdx = Math.floor(Math.random() * FOGOS_BURST_PALETTES.length);
    st.burstRadius = (0.35 + Math.random() * 0.45) * totalHeight;

    // Origem ao longo da corrente de fogos
    const launchY = (-0.2 + Math.random() * 0.5) * totalHeight;
    st.origin.set(0, launchY, 0);

    // Alvo nos 4 LADOS ao redor da corrente (360 graus em 3D)
    const angle = Math.random() * Math.PI * 2; // Espalha em todos os 4 lados
    const dist = (0.5 + Math.random() * 0.75) * totalHeight;
    const heightSpread = launchY + (Math.random() - 0.2) * (totalHeight * 0.5);

    st.target.set(
      Math.cos(angle) * dist,
      heightSpread,
      Math.sin(angle) * dist
    );
  }

  for (let r = 0; r < numRockets; r++) {
    launchRocket(r);
    rocketState[r].clock = Math.random() * (rocketState[r].launchDuration + rocketState[r].burstDuration);
  }

  // 1. Linhas de Rastro de Lançamento (Estrelas Cadentes) + Raios de Explosão
  const streakPositions = new Float32Array((numRockets + totalStreaks) * 2 * 3);
  const streakColors = new Float32Array((numRockets + totalStreaks) * 2 * 3);
  const streakAlphas = new Float32Array((numRockets + totalStreaks) * 2);
  const streakDirs = new Float32Array(totalStreaks * 3);

  // Pré-gera direções radiais de explosão 360° para cada streak de bomba
  for (let i = 0; i < totalStreaks; i++) {
    let u = Math.random() * 2 - 1;
    let phi = Math.random() * Math.PI * 2;
    let rad = Math.sqrt(Math.max(0, 1 - u * u));
    streakDirs[i * 3] = rad * Math.cos(phi);
    streakDirs[i * 3 + 1] = u;
    streakDirs[i * 3 + 2] = rad * Math.sin(phi);
  }

  const streakGeometry = new THREE.BufferGeometry();
  streakGeometry.setAttribute('position', new THREE.BufferAttribute(streakPositions, 3));
  streakGeometry.setAttribute('aColor', new THREE.BufferAttribute(streakColors, 3));
  streakGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(streakAlphas, 1));

  const streakMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: FOGOS_STREAK_VERTEX_SHADER,
    fragmentShader: FOGOS_STREAK_FRAGMENT_SHADER,
  });

  const streakLines = new THREE.LineSegments(streakGeometry, streakMaterial);
  group.add(streakLines);

  // 2. Pontos / Estrelas da Explosão
  const positions = new Float32Array(totalParticles * 3);
  const colors = new Float32Array(totalParticles * 3);
  const alphas = new Float32Array(totalParticles);
  const sizes = new Float32Array(totalParticles);
  const velocities = new Float32Array(totalParticles * 3);

  // Velocidades radiais da explosão
  for (let i = 0; i < totalParticles; i++) {
    let u = Math.random() * 2 - 1;
    let phi = Math.random() * Math.PI * 2;
    let rad = Math.sqrt(Math.max(0, 1 - u * u));
    let spd = 0.8 + Math.random() * 1.5;
    velocities[i * 3] = rad * Math.cos(phi) * spd;
    velocities[i * 3 + 1] = u * spd + 0.2;
    velocities[i * 3 + 2] = rad * Math.sin(phi) * spd;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: FOGOS_POINT_VERTEX_SHADER,
    fragmentShader: FOGOS_POINT_FRAGMENT_SHADER,
  });

  const points = new THREE.Points(geometry, material);
  group.add(points);

  const currRocketPos = new THREE.Vector3();

  function update(delta: number) {
    const sPosAttr = streakGeometry.getAttribute('position') as THREE.BufferAttribute;
    const sColorAttr = streakGeometry.getAttribute('aColor') as THREE.BufferAttribute;
    const sAlphaAttr = streakGeometry.getAttribute('aAlpha') as THREE.BufferAttribute;

    const pPosAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const pColorAttr = geometry.getAttribute('aColor') as THREE.BufferAttribute;
    const pAlphaAttr = geometry.getAttribute('aAlpha') as THREE.BufferAttribute;
    const pSizeAttr = geometry.getAttribute('aSize') as THREE.BufferAttribute;

    for (let r = 0; r < numRockets; r++) {
      const st = rocketState[r];
      st.clock += delta;

      const totalTime = st.launchDuration + st.burstDuration;
      if (st.clock >= totalTime) {
        launchRocket(r);
      }

      const pal = FOGOS_BURST_PALETTES[st.paletteIdx];

      if (st.clock < st.launchDuration) {
        // FASE 1: Lançamento de Estrela Cadente (Rastro do tiro saindo das gaiolas pros 4 lados)
        const tL = st.clock / st.launchDuration;
        currRocketPos.lerpVectors(st.origin, st.target, tL);

        // Atualiza a linha da estrela cadente (frente brilhante, rastro atrás)
        const trailLen = 0.25;
        const trailT = Math.max(0, tL - trailLen);
        const trailPos = new THREE.Vector3().lerpVectors(st.origin, st.target, trailT);

        const sIdx = r;
        sPosAttr.setXYZ(sIdx * 2, trailPos.x, trailPos.y, trailPos.z);
        sPosAttr.setXYZ(sIdx * 2 + 1, currRocketPos.x, currRocketPos.y, currRocketPos.z);

        const colHead = pal.core;
        const colTail = pal.trail;

        sColorAttr.setXYZ(sIdx * 2, colTail.r * 0.2, colTail.g * 0.2, colTail.b * 0.2);
        sColorAttr.setXYZ(sIdx * 2 + 1, colHead.r, colHead.g, colHead.b);
        sAlphaAttr.setX(sIdx * 2, 0.4 * tL);
        sAlphaAttr.setX(sIdx * 2 + 1, 1.0);

        // Oculta partículas da explosão até o tiro chegar no alvo
        const pStart = r * FOGOS_PARTICLE_PER_ROCKET;
        for (let p = 0; p < FOGOS_PARTICLE_PER_ROCKET; p++) {
          pAlphaAttr.setX(pStart + p, 0);
        }

        const stStart = numRockets + r * FOGOS_STREAK_PER_ROCKET;
        for (let s = 0; s < FOGOS_STREAK_PER_ROCKET; s++) {
          sAlphaAttr.setX((stStart + s) * 2, 0);
          sAlphaAttr.setX((stStart + s) * 2 + 1, 0);
        }

      } else {
        // FASE 2: Explosão em Estrela / Esfera (O tiro chega no alvo e explode!)
        const tB = (st.clock - st.launchDuration) / st.burstDuration;
        const sIdx = r;
        sAlphaAttr.setX(sIdx * 2, 0);
        sAlphaAttr.setX(sIdx * 2 + 1, 0);

        // 2A. Raios da Explosão (LineSegments)
        const stStart = numRockets + r * FOGOS_STREAK_PER_ROCKET;
        const maxLen = st.burstRadius * 0.85;
        const growT = Math.min(1, tB / 0.25);
        const tipDist = maxLen * growT;
        const tailDist = Math.max(0, tipDist - maxLen * 0.55);
        const fadeStr = Math.max(0, 1 - tB);

        for (let s = 0; s < FOGOS_STREAK_PER_ROCKET; s++) {
          const globalS = stStart + s;
          const dx = streakDirs[globalS * 3];
          const dy = streakDirs[globalS * 3 + 1];
          const dz = streakDirs[globalS * 3 + 2];

          sPosAttr.setXYZ(
            globalS * 2,
            st.target.x + dx * tailDist,
            st.target.y + dy * tailDist,
            st.target.z + dz * tailDist
          );
          sPosAttr.setXYZ(
            globalS * 2 + 1,
            st.target.x + dx * tipDist,
            st.target.y + dy * tipDist,
            st.target.z + dz * tipDist
          );

          sColorAttr.setXYZ(globalS * 2, pal.core.r, pal.core.g, pal.core.b);
          sColorAttr.setXYZ(globalS * 2 + 1, pal.main.r, pal.main.g, pal.main.b);
          sAlphaAttr.setX(globalS * 2, fadeStr * 0.8);
          sAlphaAttr.setX(globalS * 2 + 1, fadeStr);
        }

        // 2B. Estrelas / Pontos da Explosão
        const pStart = r * FOGOS_PARTICLE_PER_ROCKET;
        const fadeP = Math.max(0, (1 - tB) * (1 - tB));

        for (let p = 0; p < FOGOS_PARTICLE_PER_ROCKET; p++) {
          const idx = pStart + p;

          const vx = velocities[idx * 3] * st.burstRadius * 1.2;
          const vy = (velocities[idx * 3 + 1] - tB * 0.6) * st.burstRadius * 1.2; // Gravidade caindo
          const vz = velocities[idx * 3 + 2] * st.burstRadius * 1.2;

          pPosAttr.setXYZ(
            idx,
            st.target.x + vx * tB,
            st.target.y + vy * tB,
            st.target.z + vz * tB
          );

          pColorAttr.setXYZ(idx, pal.main.r, pal.main.g, pal.main.b);
          pAlphaAttr.setX(idx, fadeP);
          const twinkle = 1.0 + Math.sin(tB * 20.0 + p) * 0.3;
          pSizeAttr.setX(idx, Math.max(1.0, (1 - tB * 0.4) * 11 * twinkle));
        }
      }
    }

    sPosAttr.needsUpdate = true;
    sColorAttr.needsUpdate = true;
    sAlphaAttr.needsUpdate = true;

    pPosAttr.needsUpdate = true;
    pColorAttr.needsUpdate = true;
    pAlphaAttr.needsUpdate = true;
    pSizeAttr.needsUpdate = true;
  }

  function dispose() {
    geometry.dispose();
    material.dispose();
    streakGeometry.dispose();
    streakMaterial.dispose();
  }

  return { points: group, update, dispose };
}

type TimeOfDay = 'dia' | 'tarde' | 'noite';
type EnvironmentType = 'cidade' | 'nuvens' | 'solido';

function createSkyTexture(timeOfDay: TimeOfDay, environmentType: EnvironmentType, bgColor: string): THREE.CanvasTexture | THREE.Color {
  if (environmentType === 'solido') {
    return new THREE.Color(bgColor);
  }
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.Color(0x091428);

  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  if (timeOfDay === 'dia') {
    grad.addColorStop(0, '#0f4c81');
    grad.addColorStop(0.35, '#2b7fb8');
    grad.addColorStop(0.7, '#70b5e8');
    grad.addColorStop(1, '#bfe3f7');
  } else if (timeOfDay === 'tarde') {
    grad.addColorStop(0, '#1b0b2e');
    grad.addColorStop(0.3, '#4a154b');
    grad.addColorStop(0.6, '#aa2b57');
    grad.addColorStop(0.82, '#de6338');
    grad.addColorStop(1, '#f7b154');
  } else {
    grad.addColorStop(0, '#02040a');
    grad.addColorStop(0.35, '#060d1f');
    grad.addColorStop(0.75, '#0d1a33');
    grad.addColorStop(1, '#152542');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);

  return new THREE.CanvasTexture(canvas);
}

function buildCelestialBodyGroup(timeOfDay: TimeOfDay): THREE.Group {
  const group = new THREE.Group();
  if (timeOfDay === 'dia') {
    const sunGeom = new THREE.SphereGeometry(0.35, 24, 24);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xfffae6 });
    const sunMesh = new THREE.Mesh(sunGeom, sunMat);
    sunMesh.position.set(3.2, 3.8, -5);
    group.add(sunMesh);

    const haloGeom = new THREE.PlaneGeometry(1.6, 1.6);
    const haloCanvas = document.createElement('canvas');
    haloCanvas.width = 128;
    haloCanvas.height = 128;
    const ctx = haloCanvas.getContext('2d');
    if (ctx) {
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(255, 252, 230, 0.9)');
      g.addColorStop(0.4, 'rgba(255, 220, 130, 0.4)');
      g.addColorStop(1, 'rgba(255, 200, 100, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    }
    const haloMat = new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(haloCanvas),
      transparent: true,
      depthWrite: false,
    });
    const haloMesh = new THREE.Mesh(haloGeom, haloMat);
    haloMesh.position.copy(sunMesh.position);
    haloMesh.position.z += 0.01;
    group.add(haloMesh);
  } else if (timeOfDay === 'tarde') {
    const sunGeom = new THREE.SphereGeometry(0.4, 24, 24);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xff8833 });
    const sunMesh = new THREE.Mesh(sunGeom, sunMat);
    sunMesh.position.set(3.5, 0.8, -5);
    group.add(sunMesh);

    const haloGeom = new THREE.PlaneGeometry(2.2, 2.2);
    const haloCanvas = document.createElement('canvas');
    haloCanvas.width = 128;
    haloCanvas.height = 128;
    const ctx = haloCanvas.getContext('2d');
    if (ctx) {
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(255, 140, 50, 0.95)');
      g.addColorStop(0.5, 'rgba(230, 80, 40, 0.35)');
      g.addColorStop(1, 'rgba(180, 40, 30, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    }
    const haloMat = new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(haloCanvas),
      transparent: true,
      depthWrite: false,
    });
    const haloMesh = new THREE.Mesh(haloGeom, haloMat);
    haloMesh.position.copy(sunMesh.position);
    haloMesh.position.z += 0.01;
    group.add(haloMesh);
  } else {
    const moonGeom = new THREE.SphereGeometry(0.38, 24, 24);
    const moonCanvas = document.createElement('canvas');
    moonCanvas.width = 256;
    moonCanvas.height = 256;
    const ctx = moonCanvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#e8ecf4';
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = '#b8c0d0';
      const craters: [number, number, number][] = [
        [80, 90, 22], [140, 150, 30], [180, 80, 18], [110, 190, 25], [50, 160, 15], [190, 180, 20]
      ];
      for (const [cx, cy, r] of craters) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const moonTex = new THREE.CanvasTexture(moonCanvas);
    const moonMat = new THREE.MeshBasicMaterial({ map: moonTex });
    const moonMesh = new THREE.Mesh(moonGeom, moonMat);
    moonMesh.position.set(-3.2, 4.0, -5);
    group.add(moonMesh);

    const haloGeom = new THREE.PlaneGeometry(1.8, 1.8);
    const haloCanvas = document.createElement('canvas');
    haloCanvas.width = 128;
    haloCanvas.height = 128;
    const hctx = haloCanvas.getContext('2d');
    if (hctx) {
      const g = hctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(210, 230, 255, 0.85)');
      g.addColorStop(0.4, 'rgba(120, 170, 255, 0.3)');
      g.addColorStop(1, 'rgba(60, 100, 200, 0)');
      hctx.fillStyle = g;
      hctx.fillRect(0, 0, 128, 128);
    }
    const haloMat = new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(haloCanvas),
      transparent: true,
      depthWrite: false,
    });
    const haloMesh = new THREE.Mesh(haloGeom, haloMat);
    haloMesh.position.copy(moonMesh.position);
    haloMesh.position.z += 0.01;
    group.add(haloMesh);
  }
  return group;
}

function buildStarFieldGroup(): THREE.Points {
  const count = 500;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const radius = 12 + Math.random() * 15;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 0.8 + 0.1);

    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = Math.abs(radius * Math.cos(phi));
    positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);

    const brightness = 0.6 + Math.random() * 0.4;
    colors[i * 3] = brightness;
    colors[i * 3 + 1] = brightness * (0.9 + Math.random() * 0.1);
    colors[i * 3 + 2] = brightness * (0.8 + Math.random() * 0.2);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 0.12,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
  });

  return new THREE.Points(geometry, material);
}

function createBuildingTexture(isNight: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  ctx.fillStyle = isNight ? '#0b101d' : '#2c3545';
  ctx.fillRect(0, 0, 128, 256);

  const cols = 6;
  const rows = 18;
  const w = 10;
  const h = 8;
  const padX = 8;
  const padY = 5;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (isNight) {
        const lit = Math.random() > 0.45;
        if (lit) {
          const randColor = Math.random();
          ctx.fillStyle = randColor > 0.3 ? '#ffcc44' : randColor > 0.15 ? '#ffaa22' : '#88e0ff';
        } else {
          ctx.fillStyle = '#141c2b';
        }
      } else {
        ctx.fillStyle = Math.random() > 0.3 ? '#5b7596' : '#3e526c';
      }
      ctx.fillRect(padX + c * (w + padX), padY + r * (h + padY), w, h);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function buildTerrainMesh(timeOfDay: TimeOfDay): THREE.Mesh {
  const isNight = timeOfDay === 'noite';
  const isSunset = timeOfDay === 'tarde';

  const geometry = new THREE.PlaneGeometry(70, 70, 64, 64);
  geometry.rotateX(-Math.PI / 2);

  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);

    const distFromCenter = Math.sqrt(x * x + z * z);
    const hillFactor = Math.max(0, (distFromCenter - 8) / 22);

    const h1 = Math.sin(x * 0.18) * Math.cos(z * 0.18) * 3.2;
    const h2 = Math.sin(x * 0.35 + 1.2) * Math.sin(z * 0.3 + 0.8) * 1.8;
    const h3 = Math.cos(x * 0.08) * Math.sin(z * 0.08) * 4.0;

    const elevation = (h1 + h2 + h3) * hillFactor;
    pos.setY(i, elevation);
  }
  geometry.computeVertexNormals();

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = isNight ? '#0b1612' : isSunset ? '#2c3322' : '#384d31';
    ctx.fillRect(0, 0, 512, 512);

    const roadColor = isNight ? '#151d2a' : '#4a505c';
    const lightColor = isNight ? '#ffbb44' : '#8899aa';

    ctx.lineWidth = 6;
    ctx.strokeStyle = roadColor;

    const gridSize = 48;
    for (let x = 24; x < 512; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 512);
      ctx.stroke();
    }
    for (let y = 24; y < 512; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(512, y);
      ctx.stroke();
    }

    if (isNight) {
      ctx.fillStyle = lightColor;
      for (let x = 24; x < 512; x += gridSize) {
        for (let y = 24; y < 512; y += 24) {
          ctx.beginPath();
          ctx.arc(x, y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      for (let y = 24; y < 512; y += gridSize) {
        for (let x = 24; x < 512; x += 24) {
          ctx.beginPath();
          ctx.arc(x, y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 4);

  const material = new THREE.MeshLambertMaterial({
    map: texture,
    color: isNight ? 0x666666 : 0xaaaaaa,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0, -9.5, -8);
  return mesh;
}

function buildCityHousesAndBuildingsGroup(timeOfDay: TimeOfDay): THREE.Group {
  const group = new THREE.Group();
  const isNight = timeOfDay === 'noite';
  const buildingTex = createBuildingTexture(isNight);

  const buildingMat = new THREE.MeshPhongMaterial({
    map: buildingTex,
    color: isNight ? 0x999999 : 0xcccccc,
    shininess: 25,
  });

  const houseMat = new THREE.MeshPhongMaterial({
    color: isNight ? 0x1f2b3e : 0x7c8c9e,
    shininess: 10,
  });

  const baseY = -9.5;

  // 1. Prédios do centro urbano
  const buildingCount = 70;
  for (let i = 0; i < buildingCount; i++) {
    const width = 0.5 + Math.random() * 0.9;
    const height = 1.5 + Math.random() * 3.8;
    const depth = 0.5 + Math.random() * 0.9;

    const geom = new THREE.BoxGeometry(width, height, depth);
    const mesh = new THREE.Mesh(geom, buildingMat);

    const x = (Math.random() - 0.5) * 18;
    const z = -4 - Math.random() * 18;
    mesh.position.set(x, baseY + height / 2, z);
    group.add(mesh);
  }

  // 2. Casas nos morros e quarteirões ao redor
  const houseCount = 130;
  for (let i = 0; i < houseCount; i++) {
    const width = 0.35 + Math.random() * 0.25;
    const height = 0.25 + Math.random() * 0.3;
    const depth = 0.35 + Math.random() * 0.25;

    const geom = new THREE.BoxGeometry(width, height, depth);
    const mesh = new THREE.Mesh(geom, houseMat);

    const x = (Math.random() - 0.5) * 36;
    const z = -2 - Math.random() * 26;

    const distFromCenter = Math.sqrt(x * x + (z + 12) * (z + 12));
    const hillFactor = Math.max(0, (distFromCenter - 8) / 22);
    const hillElevation = (Math.sin(x * 0.18) * Math.cos(z * 0.18) * 3.2) * hillFactor;

    mesh.position.set(x, baseY + hillElevation + height / 2, z);
    group.add(mesh);
  }

  return group;
}

function buildCloudClusterGroup(timeOfDay: TimeOfDay): THREE.Group {
  const group = new THREE.Group();
  let cloudColor = 0xffffff;
  let opacity = 0.85;

  if (timeOfDay === 'tarde') {
    cloudColor = 0xffd1b3;
    opacity = 0.9;
  } else if (timeOfDay === 'noite') {
    cloudColor = 0x223045;
    opacity = 0.7;
  }

  const mat = new THREE.MeshStandardMaterial({
    color: cloudColor,
    roughness: 0.9,
    transparent: true,
    opacity,
    flatShading: true,
  });

  const cloudCount = 10;
  for (let i = 0; i < cloudCount; i++) {
    const cloud = new THREE.Group();
    const puffCount = 5 + Math.floor(Math.random() * 4);

    for (let p = 0; p < puffCount; p++) {
      const radius = 0.5 + Math.random() * 0.6;
      const geom = new THREE.DodecahedronGeometry(radius, 1);
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 1.2);
      cloud.add(mesh);
    }

    const x = (Math.random() - 0.5) * 22;
    const y = -2.5 + Math.random() * 4.5;
    const z = -8.0 - Math.random() * 9;
    cloud.position.set(x, y, z);
    group.add(cloud);
  }

  return group;
}

function buildBiscoitoGolfier3DGroup(
  tipWorldY: number,
  mouthRadius: number,
  heightCm: number,
  diameterCm: number
): THREE.Group {
  const group = new THREE.Group();

  const biscoitoRadius = Math.max(mouthRadius * 1.4, (diameterCm / 2) * 0.05);
  const holeRadius = mouthRadius;
  const biscoitoHeight = Math.max(0.18, heightCm * 0.02);

  const mat = new THREE.MeshStandardMaterial({
    color: 0x2563eb,
    roughness: 0.3,
    metalness: 0.2,
    side: THREE.DoubleSide,
  });

  // 1. Fundo Inferior (Circulo macico)
  const fundoShape = new THREE.Shape();
  fundoShape.absarc(0, 0, biscoitoRadius, 0, Math.PI * 2, false);
  const fundoGeo = new THREE.ShapeGeometry(fundoShape);
  const fundoMesh = new THREE.Mesh(fundoGeo, mat);
  fundoMesh.rotation.x = Math.PI / 2;
  fundoMesh.position.y = -biscoitoHeight / 2;
  group.add(fundoMesh);

  // 2. Tampo Superior (Anel com furo no meio)
  const tampoShape = new THREE.Shape();
  tampoShape.absarc(0, 0, biscoitoRadius, 0, Math.PI * 2, false);
  const holePath = new THREE.Path();
  holePath.absarc(0, 0, holeRadius, 0, Math.PI * 2, true);
  tampoShape.holes.push(holePath);
  const tampoGeo = new THREE.ShapeGeometry(tampoShape);
  const tampoMesh = new THREE.Mesh(tampoGeo, mat);
  tampoMesh.rotation.x = Math.PI / 2;
  tampoMesh.position.y = biscoitoHeight / 2;
  group.add(tampoMesh);

  // 3. Faixa Lateral (Cilindro da parede)
  const paredeGeo = new THREE.CylinderGeometry(biscoitoRadius, biscoitoRadius, biscoitoHeight, 64, 1, true);
  const paredeMesh = new THREE.Mesh(paredeGeo, mat);
  group.add(paredeMesh);

  // Borda amarela destacada do Furo da Boca
  const ringGeo = new THREE.TorusGeometry(holeRadius, 0.015, 16, 64);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  ringMesh.rotation.x = Math.PI / 2;
  ringMesh.position.y = biscoitoHeight / 2 + 0.005;
  group.add(ringMesh);

  // Posiciona exatamente no final da boca do balão
  group.position.set(0, tipWorldY - biscoitoHeight / 2, 0);
  return group;
}

function dataURLtoFile(dataurl: string, filename: string): File | null {
  try {
    const arr = dataurl.split(',');
    const mimeMatch = arr[0].match(/:(.*?);/);
    if (!mimeMatch) return null;
    const mime = mimeMatch[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
  } catch {
    return null;
  }
}

/**
 * Recorta o LEK: recebe a imagem crua do gomo (desenho colorido sobre fundo
 * branco, tipo a foto de referencia) e devolve um PNG com o FUNDO BRANCO
 * REMOVIDO (transparente), pra so o desenho aparecer quando repetido no balao.
 *
 * Estrategia = "reconhecer o lek" automaticamente: flood-fill a partir das 4
 * bordas marcando todo pixel branco-ish que esta LIGADO na borda como
 * transparente. Isso apaga so o fundo em volta do desenho — os brancos DENTRO
 * do desenho (linhas/detalhes da arte) ficam intactos, porque nao encostam na
 * borda. `tolerancePct` (0-100) e o ajuste manual: quanto maior, mais tons
 * claros/acinzentados contam como fundo.
 */
function makeLekCutoutDataUrl(image: HTMLImageElement, tolerancePct: number): string | null {
  const maxDim = 1400;
  const scale = Math.min(1, maxDim / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
  const w = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
  const h = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, w, h);

  let imgData: ImageData;
  try {
    imgData = ctx.getImageData(0, 0, w, h);
  } catch {
    return null;
  }
  const data = imgData.data;

  // 0 (pixel puro branco removido so no 100%) ate ~120 (remove cinza claro).
  const tol = Math.max(0, Math.min(100, tolerancePct)) / 100 * 120;
  const minChannel = 255 - tol;
  const isBackgroundish = (idx: number): boolean => {
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    // Perto do branco = todos os canais altos E baixa saturacao (nao apagar
    // cores claras vivas tipo amarelo/ciano da arte).
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return min >= minChannel && (max - min) <= 24 + tol * 0.4;
  };

  const total = w * h;
  const visited = new Uint8Array(total);
  const stack: number[] = [];

  const pushIfBg = (px: number) => {
    if (visited[px]) return;
    if (isBackgroundish(px * 4)) {
      visited[px] = 1;
      stack.push(px);
    }
  };

  for (let x = 0; x < w; x++) {
    pushIfBg(x);
    pushIfBg((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    pushIfBg(y * w);
    pushIfBg(y * w + (w - 1));
  }

  while (stack.length > 0) {
    const px = stack.pop() as number;
    data[px * 4 + 3] = 0; // transparente

    const x = px % w;
    const y = (px - x) / w;
    if (x > 0) pushIfBg(px - 1);
    if (x < w - 1) pushIfBg(px + 1);
    if (y > 0) pushIfBg(px - w);
    if (y < h - 1) pushIfBg(px + w);
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/png');
}

/** Raio interpolado do perfil na altura y (perfil com y crescente). */
function radiusAtY(points: THREE.Vector2[], y: number): number {
  if (y <= points[0].y) return points[0].x;
  const last = points[points.length - 1];
  if (y >= last.y) return last.x;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a.y <= y && y <= b.y) {
      const t = b.y === a.y ? 0 : (y - a.y) / (b.y - a.y);
      return a.x + t * (b.x - a.x);
    }
  }
  return last.x;
}

/** Sub-perfil entre yA e yB (com pontos interpolados nas pontas). */
function subProfile(points: THREE.Vector2[], yA: number, yB: number): THREE.Vector2[] | null {
  const eps = 1e-6;
  const out: THREE.Vector2[] = [new THREE.Vector2(radiusAtY(points, yA), yA)];
  for (const p of points) {
    if (p.y > yA + eps && p.y < yB - eps) out.push(new THREE.Vector2(p.x, p.y));
  }
  out.push(new THREE.Vector2(radiusAtY(points, yB), yB));
  return out.length >= 2 ? out : null;
}

/** Fracao de altura (0..1) do ponto MAIS LARGO do perfil (equador do balao). */
function widestFraction(points: THREE.Vector2[]): number {
  if (points.length < 2) return 0.5;
  const yBottom = points[0].y;
  const yTop = points[points.length - 1].y;
  const span = yTop - yBottom;
  if (span <= 0) return 0.5;
  let maxR = -Infinity;
  let yAtMax = yBottom + span / 2;
  for (const p of points) {
    if (p.x > maxR) {
      maxR = p.x;
      yAtMax = p.y;
    }
  }
  return Math.max(0.15, Math.min(0.85, (yAtMax - yBottom) / span));
}

/** Fracoes das bordas das bandas (n-1 valores). 2 partes = equador; 3+ = iguais. */
function bandFractions(points: THREE.Vector2[], n: number): number[] {
  if (n <= 1) return [];
  if (n === 2) return [widestFraction(points)];
  const out: number[] = [];
  for (let i = 1; i < n; i++) out.push(i / n);
  return out;
}

/**
 * Divide o perfil em N bandas (de baixo pra cima). Retorna array de sub-perfis
 * (cada um vira uma LatheGeometry). bands[0] = mais de baixo, bands[n-1] = topo.
 */
function splitProfileIntoBands(points: THREE.Vector2[], n: number): (THREE.Vector2[] | null)[] {
  if (points.length < 2 || n < 1) return [];
  if (n === 1) return [points.map((p) => new THREE.Vector2(p.x, p.y))];
  const yBottom = points[0].y;
  const yTop = points[points.length - 1].y;
  const span = yTop - yBottom;
  const fracs = bandFractions(points, n).slice().sort((a, b) => a - b);
  const bounds = [yBottom, ...fracs.map((f) => yBottom + f * span), yTop];
  const bands: (THREE.Vector2[] | null)[] = [];
  for (let k = 0; k < n; k++) {
    bands.push(subProfile(points, bounds[k], bounds[k + 1]));
  }
  return bands;
}

export function Modelo3DWorkspace() {
  const { token } = useAuth();

  const draft3D = (() => {
    try {
      const saved = window.localStorage.getItem('sistema-novo:draft:3d');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  })();

  const [currentData, setCurrentData] = useState<Record<string, MoldData> | null>(null);
  const [allModels, setAllModels] = useState<MoldModel[]>([]);
  const [modelsByCategory, setModelsByCategory] = useState<Record<string, MoldModel[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMoldKey, setSelectedMoldKey] = useState<string>(() => draft3D?.selectedMoldKey ?? '');

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [webglError, setWebglError] = useState(false);
  const [bgColor, setBgColor] = useState(() => draft3D?.bgColor ?? '#222222');

  // "Usar Lanternagem de Bojo" -- pega um projeto salvo (Meus Projetos >
  // Lanternagem de Bojo) e pendura a grade como uma FRANJA SEPARADA embaixo
  // do bojo (nunca no imageFile/texMesh do balao -- lanternagem e a imagem do
  // balao sao coisas independentes, cada uma pode estar ligada ou nao).
  const [showLanternaPicker, setShowLanternaPicker] = useState(false);
  const [lanternaProjects, setLanternaProjects] = useState<LanternaProject[]>([]);
  const [loadingLanternaProjects, setLoadingLanternaProjects] = useState(false);
  const [lanternaPickerError, setLanternaPickerError] = useState<string | null>(null);
  const [applyingLanternaId, setApplyingLanternaId] = useState<number | null>(() => draft3D?.applyingLanternaId ?? null);
  const [appliedLanternaLabel, setAppliedLanternaLabel] = useState<string | null>(() => draft3D?.appliedLanternaLabel ?? null);

  // Bandeira/Painel/Letreiro pendurados embaixo do balao -- so importa uma
  // imagem qualquer do celular/PC (igual "Subir imagem"), sem projeto salvo.
  // Os 3 sao o MESMO formato de imagem (banner retangular), entao usam um so
  // botao/slot -- nao faz sentido 1 upload separado pra cada rotulo.
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);

  // Fogos: corrente de gaiolas + pratos pendurada embaixo do balao, com
  // efeito continuo de faisca saindo do fundo -- gaiolas/pratos sao
  // independentes (o cliente escolhe cada quantidade a parte), sem imagem
  // nenhuma envolvida (so geometria + particulas).
  const [fogosActive, setFogosActive] = useState(() => draft3D?.fogosActive ?? false);
  const [fogosGaiolas, setFogosGaiolas] = useState(() => draft3D?.fogosGaiolas ?? 1);
  const [fogosPratos, setFogosPratos] = useState(() => draft3D?.fogosPratos ?? 10);

  // Biscoito de Golfier 3D acoplado na boca do balao
  const [biscoitoActive, setBiscoitoActive] = useState(() => draft3D?.biscoitoActive ?? false);
  const [biscoitoDiametroCm, setBiscoitoDiametroCm] = useState(() => draft3D?.biscoitoDiametroCm ?? 60);
  const [biscoitoAlturaCm, setBiscoitoAlturaCm] = useState(() => draft3D?.biscoitoAlturaCm ?? 15);
  const biscoitoGroupRef = useRef<THREE.Group | null>(null);

  const [imageDataUrl, setImageDataUrl] = useState<string | null>(() => draft3D?.imageDataUrl ?? null);
  const [bannerDataUrl, setBannerDataUrl] = useState<string | null>(() => draft3D?.bannerDataUrl ?? null);

  // LEK: o cliente sobe o desenho de UM gomo (triangulo de cima + de baixo,
  // sobre fundo branco). O sistema "reconhece" o lek removendo o fundo branco
  // (recorte automatico, ajustavel pelo slider de tolerancia) e repete o gomo
  // recortado N vezes em volta do balao. Independente do "Subir Imagem".
  const [lekFile, setLekFile] = useState<File | null>(null);
  const [lekDataUrl, setLekDataUrl] = useState<string | null>(() => draft3D?.lekDataUrl ?? null);
  const [lekCutoutUrl, setLekCutoutUrl] = useState<string | null>(null);
  // Tolerancia fixa da remocao automatica do fundo branco (sem slider).
  const lekTolerance = 12;
  const [lekProcessing, setLekProcessing] = useState(false);
  const [lekError, setLekError] = useState<string | null>(null);

  // Warp por PARTES: o cliente diz quantas partes o lek tem (ex: boca/bojo/bico),
  // molda a grade de cada uma e escolhe a repeticao de cada parte. lekParts =
  // grades; lekPartRepeats = quantas voltas cada parte da; lekPartUrls = as
  // texturas retificadas resultantes (uma por parte) usadas no 3D.
  const [lekParts, setLekParts] = useState<WarpGrid[] | null>(() => draft3D?.lekParts ?? null);
  const [lekPartRepeats, setLekPartRepeats] = useState<number[] | null>(() => draft3D?.lekPartRepeats ?? null);
  const [lekPartUrls, setLekPartUrls] = useState<(string | null)[]>([]);

  const [currentCategory, setCurrentCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  type ThreeDTab = 'imagem' | 'lek' | 'lanternagem' | 'bandeira' | 'biscoito' | 'fogos' | 'exportar' | 'modelos';
  const [threeDTab, setThreeDTab] = useState<ThreeDTab>(() => draft3D?.threeDTab ?? 'imagem');
  const [showingTex, setShowingTex] = useState(false);

  // Cenário 3D e Horário do dia (Sol, Lua, Estrelas, Cidade, Nuvens)
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>(() => draft3D?.timeOfDay ?? 'noite');
  const [environmentType, setEnvironmentType] = useState<EnvironmentType>(() => draft3D?.environmentType ?? 'cidade');

  // Video recording states
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSecondsLeft, setRecordingSecondsLeft] = useState(10);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const ambientLightRef = useRef<THREE.AmbientLight | null>(null);
  const keyLightRef = useRef<THREE.DirectionalLight | null>(null);
  const fillLightRef = useRef<THREE.DirectionalLight | null>(null);
  const hemiLightRef = useRef<THREE.HemisphereLight | null>(null);
  const environmentGroupRef = useRef<THREE.Group | null>(null);
  const fillMeshRef = useRef<THREE.Mesh | null>(null);
  const wireMeshRef = useRef<THREE.Mesh | null>(null);
  const texMeshRef = useRef<THREE.Mesh | null>(null);
  const geometryRef = useRef<THREE.LatheGeometry | null>(null);
  const yOffsetRef = useRef(0);
  const profilePointsRef = useRef<THREE.Vector2[]>([]);

  // Franja de lanternagem: mesh proprio, textura propria, independente do
  // texMesh (que so serve pra "Subir imagem"/foto do balao inteiro).
  const lanternaMeshRef = useRef<THREE.Mesh | null>(null);
  const lanternaTextureRef = useRef<THREE.Texture | null>(null);
  const lanternaGridRef = useRef<{ gridWidth: number; gridHeight: number } | null>(null);

  const bannerGroupRef = useRef<THREE.Group | null>(null);

  // Lek: base clara opaca (corpo do balao "papel") + 1 banda por PARTE, cada
  // uma com a textura retificada da sua grade e sua propria repeticao.
  const lekBaseMeshRef = useRef<THREE.Mesh | null>(null);
  const lekPartMeshesRef = useRef<(THREE.Mesh | null)[]>([]);

  const fogosGroupRef = useRef<THREE.Group | null>(null);
  const fogosParticlesRef = useRef<FireworkParticleSystem | null>(null);
  const clockRef = useRef(new THREE.Clock());

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
        setSelectedMoldKey((prev) => prev || defaultKey);
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

  // Hook de Auto-salvamento dos estados do workspace 3D (persiste tudo ao dar F5)
  useEffect(() => {
    try {
      const draft = {
        selectedMoldKey,
        bgColor,
        applyingLanternaId,
        appliedLanternaLabel,
        fogosActive,
        fogosGaiolas,
        fogosPratos,
        biscoitoActive,
        biscoitoDiametroCm,
        biscoitoAlturaCm,
        timeOfDay,
        environmentType,
        threeDTab,
        imageDataUrl,
        bannerDataUrl,
        lekDataUrl,
        lekParts,
        lekPartRepeats,
      };
      window.localStorage.setItem('sistema-novo:draft:3d', JSON.stringify(draft));
    } catch {}
  }, [
    selectedMoldKey,
    bgColor,
    applyingLanternaId,
    appliedLanternaLabel,
    fogosActive,
    fogosGaiolas,
    fogosPratos,
    biscoitoActive,
    biscoitoDiametroCm,
    biscoitoAlturaCm,
    timeOfDay,
    environmentType,
    threeDTab,
    imageDataUrl,
    bannerDataUrl,
    lekDataUrl,
    lekParts,
    lekPartRepeats,
  ]);

  // Restaura imagens salvas no localStorage (DataURL -> File) ao carregar F5
  useEffect(() => {
    if (draft3D?.imageDataUrl && !imageFile) {
      const restored = dataURLtoFile(draft3D.imageDataUrl, 'balao-textura.png');
      if (restored) setImageFile(restored);
    }
    if (draft3D?.bannerDataUrl && !bannerFile) {
      const restored = dataURLtoFile(draft3D.bannerDataUrl, 'bandeira-textura.png');
      if (restored) setBannerFile(restored);
    }
    if (draft3D?.lekDataUrl && !lekFile) {
      const restored = dataURLtoFile(draft3D.lekDataUrl, 'lek-gomo.png');
      if (restored) setLekFile(restored);
    }
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth || 1, container.clientHeight || 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
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

    const ambLight = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambLight);
    ambientLightRef.current = ambLight;

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
    keyLight.position.set(4, 7, 5);
    scene.add(keyLight);
    keyLightRef.current = keyLight;

    const fillLight = new THREE.DirectionalLight(0xfff8ee, 0.9);
    fillLight.position.set(-5, 4, -4);
    scene.add(fillLight);
    fillLightRef.current = fillLight;

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x556677, 1.0);
    scene.add(hemiLight);
    hemiLightRef.current = hemiLight;

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
    clockRef.current.start();
    const animate = () => {
      controls.update();
      const delta = clockRef.current.getDelta();
      fogosParticlesRef.current?.update(delta);
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

      if (lanternaMeshRef.current) {
        scene.remove(lanternaMeshRef.current);
        lanternaMeshRef.current.geometry.dispose();
        if (lanternaMeshRef.current.material instanceof THREE.Material) {
          lanternaMeshRef.current.material.dispose();
        }
      }
      lanternaTextureRef.current?.dispose();

      if (bannerGroupRef.current) {
        scene.remove(bannerGroupRef.current);
        disposeHangingBannerGroup(bannerGroupRef.current);
        bannerGroupRef.current = null;
      }

      if (fogosGroupRef.current) {
        scene.remove(fogosGroupRef.current);
        disposeFogosChainGroup(fogosGroupRef.current);
        fogosGroupRef.current = null;
      }
      if (fogosParticlesRef.current) {
        scene.remove(fogosParticlesRef.current.points);
        fogosParticlesRef.current.dispose();
        fogosParticlesRef.current = null;
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
      lanternaMeshRef.current = null;
      lanternaTextureRef.current = null;
    };
  }, []);

  // Effect Environment: Atualiza o cenário 3D (Céu, Sol/Lua, Estrelas, Cidade, Nuvens)
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // 1. Fundo do céu (textura de gradiente procedural ou cor sólida)
    const skyBackground = createSkyTexture(timeOfDay, environmentType, bgColor);
    scene.background = skyBackground;

    // 2. Iluminação dinâmica dependendo do horário do dia (vibrante e sem sombras escuras)
    if (ambientLightRef.current && keyLightRef.current && fillLightRef.current && hemiLightRef.current) {
      if (timeOfDay === 'dia') {
        ambientLightRef.current.color.setHex(0xffffff);
        ambientLightRef.current.intensity = 1.35;
        keyLightRef.current.color.setHex(0xfff8ee);
        keyLightRef.current.intensity = 1.5;
        keyLightRef.current.position.set(4, 7, 5);
        fillLightRef.current.intensity = 0.95;
        hemiLightRef.current.intensity = 1.0;
      } else if (timeOfDay === 'tarde') {
        ambientLightRef.current.color.setHex(0xffebdd);
        ambientLightRef.current.intensity = 1.15;
        keyLightRef.current.color.setHex(0xff9944);
        keyLightRef.current.intensity = 1.6;
        keyLightRef.current.position.set(5, 3, 4);
        fillLightRef.current.intensity = 0.85;
        hemiLightRef.current.intensity = 0.9;
      } else {
        // noite — iluminado e nítido, sem deixar o balão apagado!
        ambientLightRef.current.color.setHex(0xddeeff);
        ambientLightRef.current.intensity = 0.95;
        keyLightRef.current.color.setHex(0x99ccff);
        keyLightRef.current.intensity = 1.25;
        keyLightRef.current.position.set(-3, 6, 4);
        fillLightRef.current.intensity = 0.85;
        hemiLightRef.current.intensity = 0.8;
      }
    }

    // 3. Névoa atmosférica de altitude (FogExp2) que funde o horizonte com o céu
    let fogColor = 0x152542;
    if (timeOfDay === 'dia') fogColor = 0xbfe3f7;
    else if (timeOfDay === 'tarde') fogColor = 0xf7b154;

    if (environmentType !== 'solido') {
      scene.fog = new THREE.FogExp2(fogColor, 0.028);
    } else {
      scene.fog = null;
    }

    // 4. Limpa grupo de cenário anterior
    if (environmentGroupRef.current) {
      scene.remove(environmentGroupRef.current);
      environmentGroupRef.current = null;
    }

    const envGroup = new THREE.Group();

    if (environmentType !== 'solido') {
      // Sol ou Lua 3D
      envGroup.add(buildCelestialBodyGroup(timeOfDay));

      // Estrelas piscantes na noite
      if (timeOfDay === 'noite') {
        envGroup.add(buildStarFieldGroup());
      }

      // Cidade 3D com ruas, morros, casas e prédios
      if (environmentType === 'cidade') {
        envGroup.add(buildTerrainMesh(timeOfDay));
        envGroup.add(buildCityHousesAndBuildingsGroup(timeOfDay));
        envGroup.add(buildCloudClusterGroup(timeOfDay));
      } else if (environmentType === 'nuvens') {
        envGroup.add(buildCloudClusterGroup(timeOfDay));
      }
    }

    scene.add(envGroup);
    environmentGroupRef.current = envGroup;

    return () => {
      if (environmentGroupRef.current) {
        scene.remove(environmentGroupRef.current);
        environmentGroupRef.current = null;
      }
    };
  }, [timeOfDay, environmentType, bgColor]);

  // Cor de fundo do preview 3D (nao e a cor do balao, so o cenario atras dele
  // -- util pra simular fundo escuro/noite igual foto real de balao com luz).
  // Tambem reajusta a cor das cordinhas dos banners pendurados, pra sempre
  // aparecer visivel (preto some num fundo escuro, por exemplo).
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.background = new THREE.Color(bgColor);

    const lineColor = contrastingLineColor(bgColor);
    bannerGroupRef.current?.traverse((obj) => {
      if (obj instanceof THREE.Line && obj.material instanceof THREE.LineBasicMaterial) {
        obj.material.color.setHex(lineColor);
      }
    });
    fogosGroupRef.current?.traverse((obj) => {
      if (obj instanceof THREE.Line && obj.material instanceof THREE.LineBasicMaterial) {
        obj.material.color.setHex(lineColor);
      }
    });
  }, [bgColor]);

  /**
   * (Re)constroi a franja de lanternagem pendurada embaixo do bojo — anel de
   * encaixe no ponto mais LARGO do perfil (fim do bojo/inicio do rabo, igual
   * a foto real de balao com luzinhas penduradas), como um cone levemente
   * alargado (bell/lampshade) puxado pra fora do corpo do balao. Roda de novo
   * sempre que troca de molde (o anel muda de posicao/raio) ou troca/remove o
   * projeto de lanternagem aplicado — nunca mexe no texMesh/imageFile.
   */
  const rebuildLanternaSkirt = useCallback(() => {
    const scene = sceneRef.current;

    if (lanternaMeshRef.current) {
      scene?.remove(lanternaMeshRef.current);
      lanternaMeshRef.current.geometry.dispose();
      if (lanternaMeshRef.current.material instanceof THREE.Material) {
        lanternaMeshRef.current.material.dispose();
      }
      lanternaMeshRef.current = null;
    }

    const texture = lanternaTextureRef.current;
    const grid = lanternaGridRef.current;
    const points = profilePointsRef.current;
    if (!scene || !texture || !grid || points.length < 2) {
      return;
    }

    let maxRadius = 0;
    let ringLocalY = points[0].y;
    for (const p of points) {
      if (p.x > maxRadius) {
        maxRadius = p.x;
        ringLocalY = p.y;
      }
    }
    if (maxRadius <= 0) {
      return;
    }

    const totalHeight = Math.max(0.001, points[points.length - 1].y - points[0].y);
    const ringWorldY = yOffsetRef.current + ringLocalY;

    // Alarga pra fora tipo sininho/cupula, igual a franja penduarada na foto
    // real (mais larga que o rabo do balao logo acima dela).
    const topRadius = maxRadius;
    const bottomRadius = maxRadius * 1.3;
    const avgRadius = (topRadius + bottomRadius) / 2;
    const circumference = 2 * Math.PI * avgRadius;
    const aspect = grid.gridHeight / Math.max(1, grid.gridWidth);
    const desiredHeight = circumference * aspect;
    const skirtHeight = Math.min(Math.max(desiredHeight, totalHeight * 0.12), totalHeight * 0.45);

    const skirtGeometry = new THREE.CylinderGeometry(topRadius, bottomRadius, skirtHeight, 60, 1, true);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide,
      alphaTest: 0.1,
    });

    const mesh = new THREE.Mesh(skirtGeometry, material);
    mesh.position.y = ringWorldY - skirtHeight / 2;
    scene.add(mesh);
    lanternaMeshRef.current = mesh;
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
    yOffsetRef.current = yOffset;
    profilePointsRef.current = points;

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
      // Fogos atira faisca pro lado, bem pra fora do raio do balao -- com
      // fogos ligado, afasta mais a camera de partida pra caber o jato
      // inteiro no enquadramento padrao (o usuario ainda pode dar zoom).
      const margin = fogosActive ? 2.1 : 1.4;
      const distance = (sphere.radius / Math.sin(fovRad / 2)) * margin;
      camera.position.set(sphere.center.x, sphere.center.y + sphere.radius * 0.25, sphere.center.z + distance);
      camera.near = Math.max(0.01, distance - sphere.radius * 3);
      camera.far = distance + sphere.radius * 3;
      camera.updateProjectionMatrix();
      controls.target.copy(sphere.center);
      controls.update();
    }

    // Molde trocado = anel de encaixe (ponto mais largo do perfil) mudou de
    // posicao/raio -- reconstroi a franja de lanternagem (se tiver alguma
    // aplicada) pro anel novo.
    rebuildLanternaSkirt();
  }, [selectedMoldKey, currentData, rebuildLanternaSkirt, fogosActive]);

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
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        if (rendererRef.current) {
          texture.anisotropy = rendererRef.current.capabilities.getMaxAnisotropy();
        }

        const mat = new THREE.MeshStandardMaterial({
          map: texture,
          side: THREE.DoubleSide,
          roughness: 0.3,
          metalness: 0.05,
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
  }, [imageFile, selectedMoldKey, currentData]);

  // Effect C2: processa o LEK cru -> PNG recortado (fundo branco removido).
  // Roda quando o arquivo do lek ou a tolerancia (ajuste manual) muda.
  useEffect(() => {
    if (!lekFile) {
      setLekCutoutUrl(null);
      setLekError(null);
      return;
    }
    let cancelled = false;
    setLekProcessing(true);
    setLekError(null);
    const url = URL.createObjectURL(lekFile);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (cancelled) return;
      const cut = makeLekCutoutDataUrl(img, lekTolerance);
      if (cancelled) return;
      if (cut) {
        setLekCutoutUrl(cut);
      } else {
        setLekError('Não foi possível recortar esse lek. Tente outra imagem.');
      }
      setLekProcessing(false);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      if (cancelled) return;
      setLekError('Não foi possível carregar essa imagem.');
      setLekProcessing(false);
    };
    img.src = url;
    return () => {
      cancelled = true;
    };
  }, [lekFile, lekTolerance]);

  // Effect C3: aplica o lek no balao em N BANDAS (uma por parte) — base clara
  // opaca (corpo do balao) + cada parte na sua banda, com sua propria
  // repeticao. Parte 0 (boca) fica no topo, ultima (bico) embaixo. Reconstroi
  // quando as texturas/partes, as repeticoes ou o molde mudam.
  useEffect(() => {
    const scene = sceneRef.current;
    const fillMesh = fillMeshRef.current;
    const wireMesh = wireMeshRef.current;
    if (!scene || !fillMesh || !wireMesh) return;

    const cleanup = () => {
      lekPartMeshesRef.current.forEach((mesh) => {
        if (!mesh) return;
        scene.remove(mesh);
        mesh.geometry.dispose();
        const m = mesh.material;
        if (m instanceof THREE.MeshStandardMaterial) m.map?.dispose();
        if (m instanceof THREE.Material) m.dispose();
      });
      lekPartMeshesRef.current = [];
      if (lekBaseMeshRef.current) {
        scene.remove(lekBaseMeshRef.current);
        if (lekBaseMeshRef.current.material instanceof THREE.Material) {
          lekBaseMeshRef.current.material.dispose();
        }
        lekBaseMeshRef.current = null;
      }
    };

    cleanup();

    const points = profilePointsRef.current;
    const urls = lekPartUrls;
    const nParts = urls.length;
    const hasAny = urls.some((u) => !!u);
    if (!hasAny || !geometryRef.current || points.length < 2) {
      if (!imageFile) {
        fillMesh.visible = true;
        wireMesh.visible = true;
      }
      return;
    }

    const yOffset = yOffsetRef.current;
    const reps = lekPartRepeats ?? [];

    // Base opaca clara = "papel" do balao aparecendo onde o fundo foi recortado.
    const baseMesh = new THREE.Mesh(
      geometryRef.current,
      new THREE.MeshStandardMaterial({ color: 0xf5f4f0, side: THREE.DoubleSide, roughness: 0.55, metalness: 0.02 })
    );
    baseMesh.position.y = yOffset;
    scene.add(baseMesh);
    lekBaseMeshRef.current = baseMesh;

    // Divide o perfil em N bandas (de baixo pra cima).
    const bands = splitProfileIntoBands(points, nParts);
    if (bands.length !== nParts) return;

    fillMesh.visible = false;
    wireMesh.visible = false;
    lekPartMeshesRef.current = new Array(nParts).fill(null);

    const loader = new THREE.TextureLoader();
    let cancelled = false;

    urls.forEach((url, partIndex) => {
      if (!url) return;
      // parte 0 (bico, ponta de cima) => banda mais de cima (bands[nParts-1-partIndex])
      const bandPoints = bands[nParts - 1 - partIndex];
      if (!bandPoints) return;
      const rep = Math.max(1, Math.min(60, Math.round(reps[partIndex] ?? 4)));
      loader.load(url, (texture) => {
        if (cancelled) {
          texture.dispose();
          return;
        }
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.repeat.set(rep, 1);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        if (rendererRef.current) {
          texture.anisotropy = rendererRef.current.capabilities.getMaxAnisotropy();
        }
        const geo = new THREE.LatheGeometry(bandPoints, 60);
        const mesh = new THREE.Mesh(
          geo,
          new THREE.MeshStandardMaterial({
            map: texture,
            transparent: true,
            alphaTest: 0.5,
            side: THREE.DoubleSide,
            roughness: 0.35,
            metalness: 0.05,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
          })
        );
        mesh.position.y = yOffset;
        scene.add(mesh);
        lekPartMeshesRef.current[partIndex] = mesh;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [lekPartUrls, lekPartRepeats, selectedMoldKey, currentData, imageFile]);

  /**
   * Effect D: Bandeira/Painel/Letreiro pendurado embaixo do balao — os 3 sao
   * o mesmo formato de imagem, entao usam 1 slot so. So importa uma imagem
   * qualquer (sem projeto salvo), reconstroi quando a imagem OU o molde muda
   * (a ponta de baixo do balao muda de posicao quando troca de molde). Roda
   * depois do Effect B (nessa ordem no arquivo), entao
   * profilePointsRef/yOffsetRef ja estao atualizados.
   */
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (bannerGroupRef.current) {
      scene.remove(bannerGroupRef.current);
      disposeHangingBannerGroup(bannerGroupRef.current);
      bannerGroupRef.current = null;
    }
    if (!bannerFile) return;

    setBannerError(null);
    let cancelled = false;
    const url = URL.createObjectURL(bannerFile);
    new THREE.TextureLoader().load(
      url,
      (texture) => {
        URL.revokeObjectURL(url);
        if (cancelled) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        const points = profilePointsRef.current;
        if (points.length === 0) {
          texture.dispose();
          return;
        }
        const totalHeight = Math.max(0.001, points[points.length - 1].y - points[0].y);
        const tipWorldY = yOffsetRef.current + points[0].y;
        const group = buildHangingBannerGroup(texture, tipWorldY, totalHeight, contrastingLineColor(bgColor));
        scene.add(group);
        bannerGroupRef.current = group;
      },
      undefined,
      () => {
        if (!cancelled) {
          setBannerError('Nao foi possivel carregar essa imagem.');
        }
        URL.revokeObjectURL(url);
      }
    );

    return () => {
      cancelled = true;
    };
  }, [bannerFile, selectedMoldKey, currentData]);

  /**
   * Effect E: Fogos (corrente de gaiolas/pratos + faisca continua) pendurado
   * embaixo do balao — reconstroi quando ligado/desligado, quando muda a
   * quantidade de gaiolas/pratos, ou quando troca de molde (a ponta de baixo
   * muda de posicao). Sem imagem nenhuma envolvida, so geometria parametrica.
   */
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (fogosGroupRef.current) {
      scene.remove(fogosGroupRef.current);
      disposeFogosChainGroup(fogosGroupRef.current);
      fogosGroupRef.current = null;
    }
    if (fogosParticlesRef.current) {
      scene.remove(fogosParticlesRef.current.points);
      fogosParticlesRef.current.dispose();
      fogosParticlesRef.current = null;
    }
    if (!fogosActive) return;

    const points = profilePointsRef.current;
    if (points.length === 0) return;

    const totalHeight = Math.max(0.001, points[points.length - 1].y - points[0].y);
    const tipWorldY = yOffsetRef.current + points[0].y;
    const { group, bottomWorldY } = buildFogosChainGroup(fogosGaiolas, fogosPratos, tipWorldY, totalHeight, contrastingLineColor(bgColor));
    scene.add(group);
    fogosGroupRef.current = group;

    const particles = createFireworkParticleSystem(totalHeight);
    particles.points.position.set(0, bottomWorldY, 0);
    scene.add(particles.points);
    fogosParticlesRef.current = particles;
  }, [fogosActive, fogosGaiolas, fogosPratos, selectedMoldKey, currentData]);

  /**
   * Effect F: Biscoito de Golfier acoplado na boca do balao 3D
   */
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (biscoitoGroupRef.current) {
      scene.remove(biscoitoGroupRef.current);
      biscoitoGroupRef.current = null;
    }

    if (!biscoitoActive) return;

    const points = profilePointsRef.current;
    if (points.length === 0) return;

    const tipWorldY = yOffsetRef.current + points[0].y;
    const mouthRadius = points[0].x;

    const group = buildBiscoitoGolfier3DGroup(
      tipWorldY,
      mouthRadius,
      biscoitoAlturaCm,
      biscoitoDiametroCm
    );
    scene.add(group);
    biscoitoGroupRef.current = group;

    return () => {
      if (biscoitoGroupRef.current) {
        scene.remove(biscoitoGroupRef.current);
        biscoitoGroupRef.current = null;
      }
    };
  }, [biscoitoActive, biscoitoDiametroCm, biscoitoAlturaCm, selectedMoldKey, currentData]);

  const handleImageChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setImageFile(file);
    event.target.value = '';

    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => setImageDataUrl(e.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setImageDataUrl(null);
    }
  }, []);

  const handleBannerFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setBannerFile(file);
    if (file) {
      setFogosActive(false);
      const reader = new FileReader();
      reader.onload = (e) => setBannerDataUrl(e.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setBannerDataUrl(null);
    }
    event.target.value = '';
  }, []);

  const handleLekChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setLekFile(file);
    // Lek novo = zera as grades/repeticoes/texturas anteriores.
    setLekParts(null);
    setLekPartRepeats(null);
    setLekPartUrls([]);
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => setLekDataUrl(e.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setLekDataUrl(null);
    }
    event.target.value = '';
  }, []);

  const handleRemoveLek = useCallback(() => {
    setLekFile(null);
    setLekDataUrl(null);
    setLekCutoutUrl(null);
    setLekError(null);
    setLekParts(null);
    setLekPartRepeats(null);
    setLekPartUrls([]);
  }, []);

  // Callbacks do editor de partes
  const handleLekConfigChange = useCallback((parts: WarpGrid[], repeats: number[]) => {
    setLekParts(parts);
    setLekPartRepeats(repeats);
    // Garante o array de urls do tamanho certo (preenchido pelo onWarpedChange).
    setLekPartUrls((prev) => {
      const next = parts.map((_, i) => prev[i] ?? null);
      return next;
    });
  }, []);

  const handleLekWarpedChange = useCallback((index: number, url: string | null) => {
    setLekPartUrls((prev) => {
      const next = prev.slice();
      while (next.length <= index) next.push(null);
      next[index] = url;
      return next;
    });
  }, []);

  const handleOpenLanternaPicker = useCallback(() => {
    setShowLanternaPicker(true);
    if (!token) {
      return;
    }
    setLoadingLanternaProjects(true);
    setLanternaPickerError(null);
    api
      .listLanternaProjects(token)
      .then((res) => setLanternaProjects(res.data))
      .catch((err) => {
        setLanternaPickerError(err instanceof ApiError ? err.message : 'Nao foi possivel carregar os projetos.');
      })
      .finally(() => setLoadingLanternaProjects(false));
  }, [token]);

  const handleApplyLanternaProject = useCallback(
    async (project: LanternaProject) => {
      setApplyingLanternaId(project.id);
      setLanternaPickerError(null);
      try {
        const { colors, gridWidth, gridHeight, bolinha } = project.state;
        const file = await renderLanternaGridToImageFile(colors, gridWidth, gridHeight, {
          bolinha,
          transparentBackground: true,
          filename: `${project.nome || 'lanternagem-de-bojo'}.png`,
        });
        const url = URL.createObjectURL(file);
        const texture = await new Promise<THREE.Texture>((resolve, reject) => {
          new THREE.TextureLoader().load(
            url,
            (tex) => resolve(tex),
            undefined,
            () => reject(new Error('Nao foi possivel carregar a textura da lanternagem.'))
          );
        });
        URL.revokeObjectURL(url);
        texture.colorSpace = THREE.SRGBColorSpace;

        lanternaTextureRef.current?.dispose();
        lanternaTextureRef.current = texture;
        lanternaGridRef.current = { gridWidth, gridHeight };
        rebuildLanternaSkirt();

        setAppliedLanternaLabel(project.nome);
        setShowLanternaPicker(false);
      } catch (err) {
        setLanternaPickerError(err instanceof Error ? err.message : 'Nao foi possivel aplicar esse projeto.');
      } finally {
        setApplyingLanternaId(null);
      }
    },
    [rebuildLanternaSkirt]
  );

  const handleRemoveLanterna = useCallback(() => {
    lanternaGridRef.current = null;
    lanternaTextureRef.current?.dispose();
    lanternaTextureRef.current = null;
    rebuildLanternaSkirt();
    setAppliedLanternaLabel(null);
  }, [rebuildLanternaSkirt]);

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

    // MP4/H.264 PRIMEIRO — é o que abre em qualquer lugar (iPhone, WhatsApp,
    // players do Windows). WebM só como último recurso, se o navegador não
    // suportar gravar em mp4 (Chrome/Edge atuais suportam).
    const types = [
      'video/mp4;codecs=avc1.42E01E', // H.264 baseline — máxima compatibilidade
      'video/mp4;codecs=avc1',
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
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

        <div className="auth-tabs bandeira-sidebar-tabs" role="tablist">
          <button type="button" className={threeDTab === 'imagem' ? 'active' : ''} onClick={() => setThreeDTab('imagem')}>
            Subir Imagem
          </button>
          <button type="button" className={threeDTab === 'lek' ? 'active' : ''} onClick={() => setThreeDTab('lek')}>
            Lek (Gomo)
          </button>
          <button type="button" className={threeDTab === 'lanternagem' ? 'active' : ''} onClick={() => setThreeDTab('lanternagem')}>
            Lanternagem
          </button>
          <button type="button" className={threeDTab === 'bandeira' ? 'active' : ''} onClick={() => setThreeDTab('bandeira')}>
            Bandeira / Letreiro
          </button>
          <button type="button" className={threeDTab === 'biscoito' ? 'active' : ''} onClick={() => setThreeDTab('biscoito')}>
            <Cookie size={14} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
            Biscoito Golfier
          </button>
          <button type="button" className={threeDTab === 'fogos' ? 'active' : ''} onClick={() => setThreeDTab('fogos')}>
            Fogos
          </button>
          <button type="button" className={threeDTab === 'exportar' ? 'active' : ''} onClick={() => setThreeDTab('exportar')}>
            Fundo / Exportar
          </button>
          <button type="button" className={threeDTab === 'modelos' ? 'active' : ''} onClick={() => setThreeDTab('modelos')}>
            Modelos 3D
          </button>
        </div>

        <div className="modelo3d-actions-row">
          {threeDTab === 'imagem' ? (
            <>
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
            </>
          ) : null}

          {threeDTab === 'lek' ? (
            <div className="modelo3d-fogos-controls" style={{ gap: '12px', width: '100%' }}>
              <label className="mold-save-button modelo3d-upload-label">
                <ImagePlus size={16} />
                {lekFile ? 'Trocar Lek' : 'Subir Lek (1 gomo)'}
                <input type="file" accept="image/*" onChange={handleLekChange} className="modelo3d-file-input" />
              </label>

              {lekFile && (
                <>
                  {lekCutoutUrl && (
                    <LekWarpEditor
                      sourceUrl={lekCutoutUrl}
                      parts={lekParts}
                      repeats={lekPartRepeats}
                      onConfigChange={handleLekConfigChange}
                      onWarpedChange={handleLekWarpedChange}
                    />
                  )}

                  {lekProcessing && (
                    <p className="bandeira-size-hint">
                      <Loader2 size={14} className="mold-import-spinner" /> Reconhecendo o lek...
                    </p>
                  )}

                  <button type="button" className="mold-secondary-button" onClick={handleRemoveLek}>
                    <RotateCcw size={16} />
                    Remover lek
                  </button>
                </>
              )}
            </div>
          ) : null}

          {threeDTab === 'lanternagem' ? (
            <>
              <div className="modelo3d-lanterna-picker-anchor">
                <button type="button" className="mold-secondary-button" onClick={handleOpenLanternaPicker}>
                  <Lightbulb size={16} />
                  Usar Lanternagem de Bojo
                </button>

                {showLanternaPicker && (
                  <div className="modelo3d-lanterna-picker">
                    <div className="modelo3d-lanterna-picker-header">
                      <span>Projetos de Lanternagem de Bojo</span>
                      <button type="button" onClick={() => setShowLanternaPicker(false)}>
                        <X size={14} />
                      </button>
                    </div>
                    {loadingLanternaProjects ? (
                      <p className="bandeira-size-hint">
                        <Loader2 size={14} className="mold-import-spinner" /> Carregando projetos...
                      </p>
                    ) : lanternaPickerError ? (
                      <p className="mold-import-error">{lanternaPickerError}</p>
                    ) : lanternaProjects.length === 0 ? (
                      <p className="bandeira-size-hint">
                        Nenhum projeto salvo ainda. Va em <strong>Lanternagem de Bojo</strong>, desenhe o padrao e clique
                        em <strong>Salvar projeto</strong>.
                      </p>
                    ) : (
                      <div className="modelo3d-lanterna-picker-list">
                        {lanternaProjects.map((project) => (
                          <button
                            type="button"
                            key={project.id}
                            className="modelo3d-lanterna-picker-item"
                            disabled={applyingLanternaId === project.id}
                            onClick={() => void handleApplyLanternaProject(project)}
                          >
                            <span className="modelo3d-lanterna-picker-item-name">{project.nome}</span>
                            <span className="modelo3d-lanterna-picker-item-meta">
                              {project.gomos} gomos · {project.lanternas_por_gomo}/gomo
                            </span>
                            {applyingLanternaId === project.id && <Loader2 size={14} className="mold-import-spinner" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {appliedLanternaLabel && (
                <button type="button" className="mold-secondary-button" onClick={handleRemoveLanterna}>
                  <RotateCcw size={16} />
                  Remover lanternagem
                </button>
              )}
            </>
          ) : null}

          {threeDTab === 'bandeira' ? (
            <>
              <label className="mold-save-button modelo3d-upload-label">
                <ImagePlus size={16} />
                {bannerFile ? 'Trocar Bandeira/Painel/Letreiro' : 'Adicionar Bandeira/Painel/Letreiro'}
                <input type="file" accept="image/*" onChange={handleBannerFileChange} className="modelo3d-file-input" />
              </label>
              {bannerFile && (
                <button type="button" className="mold-secondary-button" onClick={() => setBannerFile(null)}>
                  <RotateCcw size={16} />
                  Remover Bandeira/Painel/Letreiro
                </button>
              )}
            </>
          ) : null}

          {threeDTab === 'biscoito' ? (
            <div className="modelo3d-fogos-controls" style={{ gap: '12px', width: '100%' }}>
              <label className="bandeira-toolbar-check" style={{ width: '100%' }}>
                <input
                  type="checkbox"
                  checked={biscoitoActive}
                  onChange={(e) => setBiscoitoActive(e.target.checked)}
                />
                <Cookie size={16} style={{ color: '#eab308' }} />
                Acoplar Biscoito de Golfier na Boca do Balão 3D
              </label>

              {biscoitoActive ? (
                <div className="modelo3d-biscoito-grid" style={{ display: 'flex', gap: '16px', width: '100%', flexWrap: 'wrap', marginTop: '8px' }}>
                  <label style={{ flex: 1, minWidth: '140px' }}>
                    <span>Diâmetro do Biscoito (cm)</span>
                    <input
                      type="number"
                      min={10}
                      value={biscoitoDiametroCm === 0 ? '' : biscoitoDiametroCm}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === '') setBiscoitoDiametroCm(0);
                        else setBiscoitoDiametroCm(parseInt(v, 10) || 0);
                      }}
                      placeholder="60"
                    />
                  </label>
                  <label style={{ flex: 1, minWidth: '140px' }}>
                    <span>Altura do Biscoito (cm)</span>
                    <input
                      type="number"
                      min={1}
                      value={biscoitoAlturaCm === 0 ? '' : biscoitoAlturaCm}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === '') setBiscoitoAlturaCm(0);
                        else setBiscoitoAlturaCm(parseInt(v, 10) || 0);
                      }}
                      placeholder="15"
                    />
                  </label>
                </div>
              ) : null}
            </div>
          ) : null}

          {threeDTab === 'fogos' ? (
            <div className="modelo3d-fogos-controls">
              <label>
                <span>Gaiolas</span>
                <input
                  type="number"
                  min={0}
                  max={FOGOS_MAX_GAIOLAS}
                  value={fogosGaiolas === 0 ? '' : fogosGaiolas}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '') setFogosGaiolas(0);
                    else setFogosGaiolas(Math.max(0, Math.min(FOGOS_MAX_GAIOLAS, parseInt(v, 10) || 0)));
                  }}
                  placeholder="0"
                />
              </label>
              <label>
                <span>Pratos</span>
                <input
                  type="number"
                  min={0}
                  max={FOGOS_MAX_PRATOS}
                  value={fogosPratos === 0 ? '' : fogosPratos}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '') setFogosPratos(0);
                    else setFogosPratos(Math.max(0, Math.min(FOGOS_MAX_PRATOS, parseInt(v, 10) || 0)));
                  }}
                  placeholder="0"
                />
              </label>
              <button
                type="button"
                className="mold-secondary-button"
                onClick={() => {
                  setFogosActive((prev: boolean) => {
                    const next = !prev;
                    if (next) {
                      setBannerFile(null);
                    }
                    return next;
                  });
                }}
                title="Corrente de gaiolas e pratos pendurada embaixo do balao"
              >
                <Sparkles size={16} />
                {fogosActive ? 'Remover Fogos' : 'Adicionar Fogos'}
              </button>
            </div>
          ) : null}

          {threeDTab === 'exportar' ? (
            <div className="modelo3d-environment-controls">
              <div className="bandeira-env-section">
                <h3>Horário do Dia</h3>
                <div className="painel-malha-switch">
                  <button
                    type="button"
                    className={timeOfDay === 'dia' ? 'active' : ''}
                    onClick={() => setTimeOfDay('dia')}
                  >
                    <Sun size={15} />
                    Dia (Sol)
                  </button>
                  <button
                    type="button"
                    className={timeOfDay === 'tarde' ? 'active' : ''}
                    onClick={() => setTimeOfDay('tarde')}
                  >
                    <Sun size={15} />
                    Tarde (Pôr do Sol)
                  </button>
                  <button
                    type="button"
                    className={timeOfDay === 'noite' ? 'active' : ''}
                    onClick={() => setTimeOfDay('noite')}
                  >
                    <Moon size={15} />
                    Noite (Lua e Estrelas)
                  </button>
                </div>
              </div>

              <div className="bandeira-env-section">
                <h3>Cenário 3D ao Fundo</h3>
                <div className="painel-malha-switch">
                  <button
                    type="button"
                    className={environmentType === 'cidade' ? 'active' : ''}
                    onClick={() => setEnvironmentType('cidade')}
                  >
                    <Building2 size={15} />
                    Cidade + Céu
                  </button>
                  <button
                    type="button"
                    className={environmentType === 'nuvens' ? 'active' : ''}
                    onClick={() => setEnvironmentType('nuvens')}
                  >
                    <Cloud size={15} />
                    Apenas Nuvens
                  </button>
                  <button
                    type="button"
                    className={environmentType === 'solido' ? 'active' : ''}
                    onClick={() => setEnvironmentType('solido')}
                  >
                    <PaintBucket size={15} />
                    Cor Sólida
                  </button>
                </div>
              </div>

              {environmentType === 'solido' && (
                <label className="modelo3d-bg-color-field" title="Cor de fundo do preview">
                  <PaintBucket size={16} />
                  Cor de fundo
                  <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} />
                </label>
              )}

              <div className="modelo3d-export-btns-row">
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
            </div>
          ) : null}
        </div>

        {imageError && <p className="mold-import-error">{imageError}</p>}
        {bannerError && <p className="mold-import-error">{bannerError}</p>}
        {lekError && <p className="mold-import-error">{lekError}</p>}
        {threeDTab === 'imagem' && !imageFile && (
          <p className="bandeira-size-hint">
            Sem imagem, o balão aparece só com uma cor sólida — suba uma foto pra ela envolver o modelo 3D.
          </p>
        )}
        {threeDTab === 'lek' && !lekFile && (
          <p className="bandeira-size-hint">
            Suba o desenho do lek (sobre fundo branco). O sistema remove o fundo sozinho; depois escolha
            <strong> quantas partes</strong> o lek tem (ex: boca/bojo/bico) e a repetição de cada parte.
          </p>
        )}
        {threeDTab === 'lek' && lekCutoutUrl && (
          <p className="bandeira-size-hint">
            Cada <strong>parte</strong> tem sua grade e sua repetição — bojo com <strong>1</strong> = corrido; pontas com
            mais repetições viram os gomos em volta do balão.
          </p>
        )}
        {appliedLanternaLabel && (
          <p className="bandeira-size-hint">
            Lanternagem <strong>{appliedLanternaLabel}</strong> pendurada embaixo do bojo — independente da imagem do
            balão (as duas podem estar ligadas ao mesmo tempo).
          </p>
        )}
      </div>

      {threeDTab === 'modelos' ? (
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
      ) : null}

      <nav className="bandeira-mobile-bottom-bar" aria-label="Navegação inferior móvel 3D">
        <button
          type="button"
          className={`mobile-bar-btn ${threeDTab === 'imagem' ? 'active' : ''}`}
          onClick={() => {
            setThreeDTab('imagem');
            document.querySelector('.modelo3d-actions-row')?.scrollIntoView({ behavior: 'smooth' });
          }}
          title="Aba de Imagem do Balão"
        >
          <ImagePlus size={17} />
          <span>Imagem</span>
        </button>
        <button
          type="button"
          className={`mobile-bar-btn ${threeDTab === 'lek' ? 'active' : ''}`}
          onClick={() => {
            setThreeDTab('lek');
            document.querySelector('.modelo3d-actions-row')?.scrollIntoView({ behavior: 'smooth' });
          }}
          title="Aba Lek (Gomo)"
        >
          <Triangle size={17} />
          <span>Lek</span>
        </button>
        <button
          type="button"
          className={`mobile-bar-btn ${threeDTab === 'lanternagem' ? 'active' : ''}`}
          onClick={() => {
            setThreeDTab('lanternagem');
            document.querySelector('.modelo3d-actions-row')?.scrollIntoView({ behavior: 'smooth' });
          }}
          title="Aba Lanternagem de Bojo"
        >
          <Lightbulb size={17} />
          <span>Lanternagem</span>
        </button>
        <button
          type="button"
          className={`mobile-bar-btn ${threeDTab === 'bandeira' ? 'active' : ''}`}
          onClick={() => {
            setThreeDTab('bandeira');
            document.querySelector('.modelo3d-actions-row')?.scrollIntoView({ behavior: 'smooth' });
          }}
          title="Aba Bandeira/Painel/Letreiro"
        >
          <Flag size={17} />
          <span>Bandeira</span>
        </button>
        <button
          type="button"
          className={`mobile-bar-btn ${threeDTab === 'biscoito' ? 'active' : ''}`}
          onClick={() => {
            setThreeDTab('biscoito');
            document.querySelector('.modelo3d-actions-row')?.scrollIntoView({ behavior: 'smooth' });
          }}
          title="Aba Biscoito de Golfier"
        >
          <Cookie size={17} />
          <span>Biscoito</span>
        </button>
        <button
          type="button"
          className={`mobile-bar-btn ${threeDTab === 'fogos' ? 'active' : ''}`}
          onClick={() => {
            setThreeDTab('fogos');
            document.querySelector('.modelo3d-actions-row')?.scrollIntoView({ behavior: 'smooth' });
          }}
          title="Aba Fogos"
        >
          <Sparkles size={17} />
          <span>Fogos</span>
        </button>
        <button
          type="button"
          className={`mobile-bar-btn ${threeDTab === 'exportar' ? 'active' : ''}`}
          onClick={() => {
            setThreeDTab('exportar');
            document.querySelector('.modelo3d-actions-row')?.scrollIntoView({ behavior: 'smooth' });
          }}
          title="Aba Exportar e Fundo"
        >
          <Download size={17} />
          <span>Exportar</span>
        </button>
        <button
          type="button"
          className={`mobile-bar-btn ${threeDTab === 'modelos' ? 'active' : ''}`}
          onClick={() => {
            setThreeDTab('modelos');
            document.querySelector('.bandeira-side-panel')?.scrollIntoView({ behavior: 'smooth' });
          }}
          title="Aba Modelos 3D"
        >
          <Box size={17} />
          <span>Modelos</span>
        </button>
      </nav>
    </div>
  );
}
