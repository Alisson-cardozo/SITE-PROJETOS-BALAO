import * as THREE from 'three';
import type { MoldPoint } from '../types';
import { buildProfilePoints } from './moldGeometry';

/** 1 unidade Three.js = 1 metro; moldes sao cadastrados em cm. */
export const CM_TO_WORLD = 0.01;

/** Acima desse raio (cm) no ultimo ponto, NAO forca polo — deixa um disco
 * achatado no topo em vez de arriscar fechar um bico que na verdade tem
 * ponta larga. */
const TIP_SNAP_THRESHOLD_CM = 1;

/**
 * Converte os pontos do molde no perfil que THREE.LatheGeometry espera:
 * y crescente (boca -> bico), x = raio em unidades de mundo (metros).
 *
 * IMPORTANTE: `largura_meia_cm` e a METADE da largura do gomo plano (a peca
 * de tecido de UM gomo so, o padrao de corte) — nao e o raio da peca ja
 * montada. Cada gomo contribui com `2 * largura_meia_cm` de arco na
 * circunferencia naquela altura; com `quantidadeGomos` gomos ao redor, a
 * circunferencia total = quantidadeGomos * 2 * largura_meia_cm, e o raio
 * real = circunferencia / (2*PI) = quantidadeGomos * largura_meia_cm / PI.
 * Usar largura_meia_cm direto como raio (sem essa conta) deixa a forma um
 * fiapo fino, porque e so 1/N do tamanho real.
 */
export function buildLatheProfile(pontos: MoldPoint[], quantidadeGomos: number): THREE.Vector2[] {
  const profile = buildProfilePoints(pontos);
  if (profile.length < 2) {
    return [];
  }

  const gomos = Math.max(3, Math.round(Number(quantidadeGomos)) || 32);
  const radiusScale = gomos / Math.PI;

  const rawPoints = profile.map(
    (p) => new THREE.Vector2(Math.max(0, p.halfWidthCm) * radiusScale * CM_TO_WORLD, p.yCm * CM_TO_WORLD)
  );

  const lastIdx = rawPoints.length - 1;
  const lastHalfCm = profile[lastIdx].halfWidthCm;
  if (lastHalfCm > 0 && lastHalfCm * radiusScale <= TIP_SNAP_THRESHOLD_CM) {
    rawPoints[lastIdx].x = 0; // forca polo verdadeiro no bico -> ponta fechada e normal suave
  }

  if (rawPoints.length < 3) {
    return rawPoints;
  }

  // Liga os pontos cadastrados com uma curva suave (Catmull-Rom) em vez de
  // reta — a tabela do molde tem so um ponto a cada N cm, e ligando eles
  // direto o torno 3D sai com "quinas" visiveis em cada ponto, bem diferente
  // do acabamento liso de um balao de verdade. A curva passa exatamente
  // pelos pontos cadastrados, so preenche o meio de forma arredondada.
  const curve = new THREE.SplineCurve(rawPoints);
  const samples = Math.max(rawPoints.length * 4, 64);
  const smoothPoints = curve.getPoints(samples);
  for (const pt of smoothPoints) {
    pt.x = Math.max(0, pt.x); // a curva pode "passar" um pouco do raio 0 perto do polo forcado
  }
  return smoothPoints;
}

export function buildLatheGeometry(pontos: MoldPoint[], quantidadeGomos: number): THREE.LatheGeometry | null {
  const segments = Math.max(3, Math.round(Number(quantidadeGomos)) || 32);
  const points = buildLatheProfile(pontos, segments);
  if (points.length < 2) {
    return null;
  }
  const geometry = new THREE.LatheGeometry(points, segments);
  geometry.computeBoundingSphere();
  // NAO chamar computeVertexNormals() aqui: LatheGeometry ja calcula normais
  // corretas por vertice (com tratamento especial de polo) — recalcular por
  // cima reintroduz artefato de sombreamento na ponta.
  return geometry;
}
