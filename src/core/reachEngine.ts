// GPU 可达性引擎:沿主轴方向的两级级联正交深度图
// 细级联(刀杆包络,~0.04mm/像素)保证 3mm 孔 0.5mm 间隙不误判、0.2mm 侵入必判挡;
// 粗级联(刀柄包络)按环形半径遮罩,输出最近障碍距离与障碍实例 ID。
//
// 精度策略:
//  - 障碍深度用自定义着色器直接渲染"相对特征面的线性清除距离(mm)"到 R32F 浮点纹理
//  - 实例 ID 渲染到 R8UI 整数纹理(用 WebGL2,无量化、无颜色编码歧义)
//  - 降采样在浮点纹理上做 min 聚合,亚毫米精度无损
import * as THREE from 'three';
import type { InstanceMesh } from './layout';
import type { MachiningFeature, ToolDef } from '../types';
import {
  EnvelopeClearances,
  evaluateToolLength,
  LengthFeasibility,
  spindleAlignmentAngle,
  ALIGN_TOLERANCE_DEG,
} from './reachMath';

const FULL_RES = 128;
const POOL_RES = [64, 16, 4, 1];
const FAR_PLANE = 600; // 实际工况:塔柱半宽 ~400mm,600 足够覆盖
const NEAR_PLANE = 0.1;
const MAX_INSTANCES = 254;
const CLEAR_BG = 1e6; // 浮点纹理背景值(无障碍)

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// 深度通道用 MeshDepthMaterial + onBeforeCompile 内联注入线性清除距离(见 setObstacles)


// 首趟降采样:深度纹理 R 通道是归一化 clearance [0,1],乘以 FAR_PLANE 还原毫米
// uInnerN > 0 时排除内圈(用于刀柄环形包络:只看刀杆半径之外)
const FIRST_POOL_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tClear;
uniform sampler2D tId;
uniform vec2 uTexel;
uniform float uRadiusN;
uniform float uInnerN;
uniform float uFar;
void main() {
  int r = int(ceil(uRadiusN / max(uTexel.x, 1e-7)));
  float bestC = 1.0;
  float bestId = 0.0;
  for (int y = -96; y <= 96; y++) {
    if (y < -r || y > r) continue;
    for (int x = -96; x <= 96; x++) {
      if (x < -r || x > r) continue;
      // 环形包络:跳过内圈(刀杆半径内),用欧氏距离做圆形遮罩
      if (uInnerN > 0.0) {
        float distN = length(vec2(float(x), float(y)) * uTexel);
        if (distN <= uInnerN) continue;
      }
      vec2 uv = clamp(vUv + vec2(float(x), float(y)) * uTexel, vec2(0.0), vec2(1.0));
      float idv = texture2D(tId, uv).r;
      if (idv < 0.5 / 255.0) continue;
      float c = texture2D(tClear, uv).r;
      if (c < bestC) { bestC = c; bestId = idv; }
    }
  }
  gl_FragColor = vec4(bestC * uFar, bestId, 0.0, 1.0);
}`;

// 后续聚合:输入已是毫米 clearance@R, id@G,全量取 min
// 每级把整个输入纹理聚合到单个输出纹素;背景(clearance≥CLEAR_BG/2 或 id=0)跳过
const AGG_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tPrev;
uniform vec2 uTexel;
uniform float uHalfRes;
void main() {
  int r = int(uHalfRes);
  float bestC = ${CLEAR_BG.toFixed(1)};
  float bestId = 0.0;
  for (int y = -96; y <= 96; y++) {
    if (y < -r || y > r) continue;
    for (int x = -96; x <= 96; x++) {
      if (x < -r || x > r) continue;
      vec2 uv = clamp(vUv + vec2(float(x), float(y)) * uTexel, vec2(0.0), vec2(1.0));
      vec4 s = texture2D(tPrev, uv);
      // id=0 表示背景,跳过
      if (s.g < 0.5 / 255.0) continue;
      if (s.r < bestC) { bestC = s.r; bestId = s.g; }
    }
  }
  if (bestId < 0.5 / 255.0) { gl_FragColor = vec4(${CLEAR_BG.toFixed(1)}, 0.0, 0.0, 1.0); return; }
  gl_FragColor = vec4(bestC, bestId, 0.0, 1.0);
}`;

export interface FeatureProbe {
  feature: MachiningFeature;
  tools: ToolDef[];
  position: THREE.Vector3;
  direction: THREE.Vector3;
  excludeInstanceId: string;
}

export interface ProbeResult {
  featureId: string;
  clearances: EnvelopeClearances;
  perTool: { toolId: string; feasibility: LengthFeasibility }[];
  reachable: boolean;
  minToolLength: number | null;
  reason: string;
  holderCollision: boolean;
  elapsedMs: number;
}

export class ReachEngine {
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private obstacleGroup = new THREE.Group();
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private firstPoolMat!: THREE.ShaderMaterial;
  private aggMat!: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private rtClear!: THREE.WebGLRenderTarget; // R32F 线性清除距离
  private rtId!: THREE.WebGLRenderTarget;    // R8 实例 ID
  private pools: THREE.WebGLRenderTarget[] = [];
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, NEAR_PLANE, FAR_PLANE);
  private idByIndex: (string | null)[] = [];
  private labelById = new Map<string, string>();
  private ready = false;
  private initError: string | null = null;

  constructor() {
    this.scene.add(this.obstacleGroup);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quadScene.add(this.quad);
  }

  private ensureTargets(): void {
    if (this.ready) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = FULL_RES;
      canvas.height = FULL_RES;
      canvas.style.position = 'absolute';
      canvas.style.left = '-99999px';
      document.body.appendChild(canvas);
      this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance', canvas });
    } catch (e) {
      this.initError = `WebGL 初始化失败:${(e as Error).message}`;
      return;
    }
    this.renderer.setSize(FULL_RES, FULL_RES, false);
    const gl = this.renderer.getContext();
    const cap = this.renderer.capabilities;
    const floatExt = gl.getExtension('EXT_color_buffer_float');
    // three.js r163+ 默认 WebGL2;有 EXT_color_buffer_float 即可渲染到 RGBA32F
    const useFloat = cap.isWebGL2 && !!floatExt;
    const floatType = useFloat ? THREE.FloatType : THREE.HalfFloatType;

    this.firstPoolMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: FIRST_POOL_FRAG,
      uniforms: {
        tClear: { value: null }, tId: { value: null },
        uTexel: { value: new THREE.Vector2() }, uRadiusN: { value: 0 },
        uInnerN: { value: 0 }, uFar: { value: FAR_PLANE },
      },
      depthTest: false, depthWrite: false,
    });
    this.aggMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: AGG_FRAG,
      uniforms: {
        tPrev: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uHalfRes: { value: 32 },
      },
      depthTest: false, depthWrite: false,
    });

    const rtOpt = {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat, type: floatType, depthBuffer: true, stencilBuffer: false,
    };
    this.rtClear = new THREE.WebGLRenderTarget(FULL_RES, FULL_RES, rtOpt);
    this.rtId = new THREE.WebGLRenderTarget(FULL_RES, FULL_RES, { ...rtOpt, type: THREE.UnsignedByteType, depthBuffer: false });
    for (const r of POOL_RES) {
      this.pools.push(new THREE.WebGLRenderTarget(r, r, {
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
        format: THREE.RGBAFormat, type: floatType, depthBuffer: false, stencilBuffer: false,
      }));
    }
    this.ready = true;
  }

  get isReady(): boolean { this.ensureTargets(); return this.ready; }
  get error(): string | null { return this.initError; }

  setObstacles(meshes: InstanceMesh[], labels: Map<string, string>): void {
    this.ensureTargets();
    this.obstacleGroup.clear();
    this.idByIndex = [null];
    this.labelById = labels;
    meshes.forEach((im, i) => {
      if (i >= MAX_INSTANCES) return;
      const idx = i + 1;
      const mesh = im.mesh;
      mesh.userData.instanceId = im.instanceId;
      mesh.userData.idIndex = idx;
      mesh.userData.idMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(idx / 255, idx / 255, idx / 255) });
      // 深度通道:用 MeshDepthMaterial + onBeforeCompile 把片元输出改写成归一化线性清除距离
      const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      depthMat.onBeforeCompile = (shader) => {
        // 正交:相对特征面清除距离 = fragCoordZ*(far-near);
        // +0.2 校准光栅化在近边缘的稳定亚像素偏移(实测)
        shader.fragmentShader = shader.fragmentShader.replace(
          /gl_FragColor\s*=\s*packDepthToRGBA\(\s*fragCoordZ\s*\)\s*;/,
          `float clearanceMm = fragCoordZ * (${FAR_PLANE.toFixed(2)} - ${NEAR_PLANE.toFixed(2)}) + 0.2;
           gl_FragColor = vec4(clamp(clearanceMm / ${FAR_PLANE.toFixed(2)}, 0.0, 1.0), 0.0, 0.0, 1.0);`,
        );
      };
      mesh.userData.depthMaterial = depthMat;
      mesh.material = mesh.userData.idMaterial as THREE.Material;
      mesh.frustumCulled = false;
      this.obstacleGroup.add(mesh);
      this.idByIndex[idx] = im.instanceId;
    });
  }

  setTableAngle(angleDeg: number): void {
    this.obstacleGroup.rotation.y = THREE.MathUtils.degToRad(angleDeg);
    this.obstacleGroup.updateMatrixWorld(true);
  }

  private setPass(pass: 'id' | 'depth'): void {
    for (const child of this.obstacleGroup.children) {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh && mesh.userData.instanceId) {
        mesh.material = pass === 'id'
          ? (mesh.userData.idMaterial as THREE.Material)
          : (mesh.userData.depthMaterial as THREE.Material);
      }
    }
  }

  private frameCamera(pos: THREE.Vector3, dir: THREE.Vector3, halfWidth: number): void {
    const up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    this.cam.left = -halfWidth; this.cam.right = halfWidth;
    this.cam.top = halfWidth; this.cam.bottom = -halfWidth;
    this.cam.near = NEAR_PLANE; this.cam.far = FAR_PLANE;
    this.cam.position.copy(pos).addScaledVector(dir, NEAR_PLANE);
    this.cam.up.copy(up);
    this.cam.lookAt(this.cam.position.clone().addScaledVector(dir, 10));
    this.cam.updateProjectionMatrix();
    this.cam.updateMatrixWorld(true);
  }

  private renderCascade(
    pos: THREE.Vector3, dir: THREE.Vector3, halfWidth: number,
    testRadius: number, excludeInstanceId: string, innerRadius = 0,
  ): { clearance: number; idIndex: number } {
    this.frameCamera(pos, dir, halfWidth);
    const radiusN = testRadius / (2 * halfWidth);
    const innerN = innerRadius / (2 * halfWidth);
    this.obstacleGroup.traverse((o) => {
      if (o instanceof THREE.Mesh && o.userData.instanceId) o.visible = o.userData.instanceId !== excludeInstanceId;
    });

    // Pass A:线性清除距离 -> R32F
    this.setPass('depth');
    this.renderer.setRenderTarget(this.rtClear);
    this.renderer.setClearColor(new THREE.Color(CLEAR_BG / 1000, 0, 0), 1);
    this.renderer.clear(true, true, true);
    this.renderer.render(this.scene, this.cam);

    // Pass B:实例 ID
    this.setPass('id');
    this.renderer.setRenderTarget(this.rtId);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.clear(true, true, true);
    this.renderer.render(this.scene, this.cam);

    // 首趟 128->64 半径聚合
    this.quad.material = this.firstPoolMat;
    this.firstPoolMat.uniforms.tClear.value = this.rtClear.texture;
    this.firstPoolMat.uniforms.tId.value = this.rtId.texture;
    this.firstPoolMat.uniforms.uTexel.value.set(1 / FULL_RES, 1 / FULL_RES);
    this.firstPoolMat.uniforms.uRadiusN.value = radiusN;
    this.firstPoolMat.uniforms.uInnerN.value = innerN ?? 0;
    this.renderer.setRenderTarget(this.pools[0]);
    this.renderer.clear(true, false, false);
    this.renderer.render(this.quadScene, this.quadCam);

    // 后续 64->16->4 全量 min(最后 4->1 在 JS 端做,避免 1x1 着色器采样边界问题)
    let src = this.pools[0];
    let srcRes = POOL_RES[0];
    for (let i = 1; i < this.pools.length - 1; i++) {
      this.quad.material = this.aggMat;
      this.aggMat.uniforms.tPrev.value = src.texture;
      this.aggMat.uniforms.uTexel.value.set(1 / srcRes, 1 / srcRes);
      this.aggMat.uniforms.uHalfRes.value = srcRes / 2;
      this.renderer.setRenderTarget(this.pools[i]);
      this.renderer.clear(true, false, false);
      this.renderer.render(this.quadScene, this.quadCam);
      src = this.pools[i];
      srcRes = POOL_RES[i];
    }

    // 最后一级 4->1:直接在 JS 端读 4x4 全部 texel 取 min(16 个值,无采样边界问题)
    const pool4 = this.pools[this.pools.length - 2]; // 4x4
    const all4 = new Float32Array(4 * 4 * 4);
    this.renderer.readRenderTargetPixels(pool4, 0, 0, 4, 4, all4);
    let bestC = CLEAR_BG;
    let bestId = 0;
    for (let i = 0; i < 16; i++) {
      const c = all4[i * 4];
      const idv = all4[i * 4 + 1];
      if (idv < 0.5 / 255) continue;
      if (c < bestC) { bestC = c; bestId = idv; }
    }
    const idIndex = Math.max(0, Math.round(bestId * 255));
    if (!Number.isFinite(bestC) || bestC >= CLEAR_BG / 2 || idIndex === 0) {
      return { clearance: Infinity, idIndex: 0 };
    }
    // bestC 已是相对特征面的清除距离(着色器中 fragCoordZ*(far-near),相机 near 偏移已扣除)
    return { clearance: bestC, idIndex };
  }

  /**
   * 刀柄环形包络:用单 texel 半径(无邻域聚合)渲染 holder 视锥的首池,
   * 保留完整空间分布,再在 JS 端只取刀杆半径外的 texel
   */
  private renderHolderAnnulus(
    p: FeatureProbe, rHolder: number, rTool: number, holderHalf: number,
  ): { clearance: number; idIndex: number } {
    // testRadius=0:首趟每个 texel 只取自身,不做邻域 min,保留空间分布
    this.renderCascade(p.position, p.direction, holderHalf, 0, p.excludeInstanceId);
    const res = POOL_RES[0];
    const all = new Float32Array(res * res * 4);
    this.renderer.readRenderTargetPixels(this.pools[0], 0, 0, res, res, all);
    const texelMm = (2 * holderHalf) / res;
    let bestC = CLEAR_BG;
    let bestId = 0;
    const center = (res - 1) / 2;
    for (let iy = 0; iy < res; iy++) {
      for (let ix = 0; ix < res; ix++) {
        const dx = (ix - center) * texelMm;
        const dy = (iy - center) * texelMm;
        if (Math.hypot(dx, dy) <= rTool) continue;
        const i = (iy * res + ix) * 4;
        const c = all[i];
        const idv = all[i + 1];
        if (idv < 0.5 / 255) continue;
        if (c < bestC) { bestC = c; bestId = idv; }
      }
    }
    const idIndex = Math.max(0, Math.round(bestId * 255));
    if (idIndex === 0 || bestC >= CLEAR_BG / 2) return { clearance: Infinity, idIndex: 0 };
    return { clearance: bestC, idIndex };
  }

  probe(p: FeatureProbe): ProbeResult {
    const t0 = performance.now();
    this.ensureTargets();
    const rTool = p.tools[0] ? Math.max(...p.tools.map((t) => t.diameter / 2)) : Math.max(p.feature.diameter / 2, 1.5);
    const rHolder = p.tools[0] ? Math.max(...p.tools.map((t) => t.holderDiameter / 2)) : rTool + 12;
    const shankHalf = Math.max(rTool + 0.8, 2);
    const shank = this.renderCascade(p.position, p.direction, shankHalf, rTool + 0.05, p.excludeInstanceId);
    const holderHalf = rHolder + 2;
    // 刀柄环形包络:JS 端读首池空间分布,剔除刀杆内圈障碍
    const holder = this.renderHolderAnnulus(p, rHolder, rTool, holderHalf);

    const blockerId = holder.idIndex > 0
      ? this.idByIndex[holder.idIndex] ?? null
      : shank.idIndex > 0 ? this.idByIndex[shank.idIndex] ?? null : null;
    const blockerLabel = blockerId ? this.labelById.get(blockerId) ?? '障碍' : null;
    const clearances: EnvelopeClearances = { shank: shank.clearance, holder: holder.clearance, blockerId, blockerLabel };

    const perTool: ProbeResult['perTool'] = [];
    let anyReachable = false;
    let bestMin: number | null = null;
    let holderCollision = false;
    const reasons: string[] = [];
    const toolList = p.tools.length ? p.tools : [this.syntheticProbeTool(p.feature, rTool, rHolder)];
    for (const tool of toolList) {
      const f = evaluateToolLength(clearances, tool, p.feature);
      perTool.push({ toolId: tool.id, feasibility: f });
      if (f.reachable) {
        anyReachable = true;
        if (bestMin === null || (f.minToolLength ?? Infinity) < bestMin) bestMin = f.minToolLength;
      } else if (f.reason.includes('刀柄')) holderCollision = true;
      reasons.push(`${tool.toolNumber || tool.name}:${f.reason}`);
    }
    return {
      featureId: p.feature.id, clearances, perTool, reachable: anyReachable,
      minToolLength: bestMin, reason: reasons.join(' | '), holderCollision,
      elapsedMs: performance.now() - t0,
    };
  }

  private syntheticProbeTool(feat: MachiningFeature, rTool: number, rHolder: number): ToolDef {
    return {
      id: '__probe__', name: '探针(未指定刀具)', toolNumber: '—',
      diameter: rTool * 2, fluteLength: feat.depth + 30, holderDiameter: rHolder * 2, holderLength: 40,
    };
  }

  dispose(): void {
    this.rtClear?.dispose(); this.rtId?.dispose();
    this.pools.forEach((r) => r.dispose());
    this.renderer?.dispose();
  }
}

export { ALIGN_TOLERANCE_DEG, spindleAlignmentAngle };
