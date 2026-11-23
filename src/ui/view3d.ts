// 主三维视图:装夹渲染、主轴方向阴影、刀具包络、拾取与 B 角旋转
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildInstanceMeshes, InstanceMesh } from '../core/layout';
import { buildFeatureMarker } from '../core/geometry';
import type { FixtureComponentDef, FixtureSetup, MachiningFeature, ToolDef, WorkpieceDef } from '../types';

export interface ViewPick {
  kind: 'component' | 'workpiece' | 'column' | 'feature';
  instanceId: string;
  featureId?: string;
}

const COLORS = {
  column: 0x6b7a90,
  clamp: 0xd9822b,
  pin: 0x4a90d9,
  support: 0x7bc47f,
  hydro: 0xb06bd9,
  workpiece: 0x8fa3b8,
  table: 0x3d4757,
};

export class View3D {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  private towerGroup = new THREE.Group();
  private markerGroup = new THREE.Group();
  private envelopeGroup = new THREE.Group();
  private table: THREE.Mesh;
  private keyLight: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private meshes: InstanceMesh[] = [];
  private featureMarkerById = new Map<string, THREE.Group>();
  private clickHandler: ((pick: ViewPick) => void) | null = null;
  private raf = 0;
  private container: HTMLElement;
  private resizeObs: ResizeObserver;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x141a24);
    this.scene.fog = new THREE.Fog(0x141a24, 1400, 2600);
    this.camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 5, 4000);
    this.camera.position.set(620, 520, 780);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 380, 0);

    // 转台
    this.table = new THREE.Mesh(
      new THREE.CylinderGeometry(420, 420, 40, 48),
      new THREE.MeshStandardMaterial({ color: COLORS.table, roughness: 0.8, metalness: 0.3 }),
    );
    this.table.position.y = 80;
    this.table.receiveShadow = true;
    this.scene.add(this.table);
    this.scene.add(new THREE.AxesHelper(120));

    // 主轴方向光(固定沿 -Z,阴影即"可达性"可视化)
    this.keyLight = new THREE.DirectionalLight(0xfff2d8, 2.4);
    this.keyLight.position.set(0, 300, 900);
    this.keyLight.target.position.set(0, 380, 0);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.camera.left = -700;
    this.keyLight.shadow.camera.right = 700;
    this.keyLight.shadow.camera.top = 900;
    this.keyLight.shadow.camera.bottom = -100;
    this.keyLight.shadow.camera.near = 10;
    this.keyLight.shadow.camera.far = 2200;
    this.keyLight.shadow.bias = -0.0006;
    this.scene.add(this.keyLight, this.keyLight.target);

    this.hemi = new THREE.HemisphereLight(0xbcd4ff, 0x2a2f3a, 0.55);
    this.scene.add(this.hemi);

    this.scene.add(this.towerGroup, this.markerGroup, this.envelopeGroup);

    this.renderer.domElement.addEventListener('click', this.onClick);
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.loop();
  }

  onPick(fn: (pick: ViewPick) => void): void {
    this.clickHandler = fn;
  }

  setShadow(on: boolean): void {
    this.keyLight.castShadow = on;
    this.keyLight.intensity = on ? 2.4 : 1.1;
  }

  /** B 角:塔柱整体绕世界 Y 旋转,光源固定 → 阴影随 B 角变化;约定与 reachService 一致 */
  setBAngle(deg: number): void {
    this.towerGroup.rotation.y = THREE.MathUtils.degToRad(deg);
    this.markerGroup.rotation.y = this.towerGroup.rotation.y;
    this.envelopeGroup.rotation.y = this.towerGroup.rotation.y;
  }

  rebuild(
    setup: FixtureSetup,
    compDefs: FixtureComponentDef[],
    wpDefs: WorkpieceDef[],
    features: MachiningFeature[],
    featureStatus?: Map<string, 'reachable' | 'blocked' | 'unknown'>,
  ): void {
    this.towerGroup.clear();
    this.markerGroup.clear();
    this.envelopeGroup.clear();
    this.featureMarkerById.clear();
    const meshes = buildInstanceMeshes(setup, compDefs, wpDefs);
    this.meshes = meshes;
    const compMap = new Map(compDefs.map((d) => [d.id, d]));

    for (const im of meshes) {
      let color = COLORS.workpiece;
      if (im.kind === 'column') color = COLORS.column;
      else if (im.kind === 'component') {
        const t = compMap.get(im.defId)?.type;
        color = t === 'clamp' ? COLORS.clamp : t === 'locatingPin' ? COLORS.pin : t === 'supportPin' ? COLORS.support : COLORS.hydro;
      }
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.35 });
      im.mesh.material = mat;
      im.mesh.castShadow = true;
      im.mesh.receiveShadow = true;
      im.mesh.userData.pickKind = im.kind;
      this.towerGroup.add(im.mesh);
    }

    // 特征标记
    for (const f of features) {
      if (!setup.featureIds.includes(f.id)) continue;
      const wpInst = setup.workpieces.find((w) => w.id === f.workpieceId);
      const wpDef = wpDefs.find((d) => d.id === wpInst?.defId);
      if (!wpInst || !wpDef) continue;
      const marker = buildFeatureMarker(f);
      const wpMesh = meshes.find((m) => m.instanceId === wpInst.id);
      if (wpMesh) marker.applyMatrix4(wpMesh.mesh.matrix);
      const status = featureStatus?.get(f.id);
      if (status === 'blocked') this.paintMarker(marker, 0xff5a5a);
      else if (status === 'reachable') this.paintMarker(marker, 0x37e6b5);
      marker.userData.pickKind = 'feature';
      marker.userData.featureId = f.id;
      this.markerGroup.add(marker);
      this.featureMarkerById.set(f.id, marker);
    }
    this.setBAngle(0);
  }

  private paintMarker(marker: THREE.Group, color: number): void {
    marker.traverse((o) => {
      if (o instanceof THREE.Mesh) (o.material as THREE.MeshBasicMaterial).color.setHex(color);
      if (o instanceof THREE.ArrowHelper) {
        (o.line.material as THREE.LineBasicMaterial).color.setHex(color);
        (o.cone.material as THREE.MeshBasicMaterial).color.setHex(color);
      }
    });
  }

  setFeatureStatus(status: Map<string, 'reachable' | 'blocked' | 'unknown'>): void {
    for (const [id, marker] of this.featureMarkerById) {
      const s = status.get(id) ?? 'unknown';
      this.paintMarker(marker, s === 'blocked' ? 0xff5a5a : s === 'reachable' ? 0x37e6b5 : 0x37e6b5);
    }
  }

  highlightInstance(instanceId: string | null): void {
    for (const im of this.meshes) {
      const mat = im.mesh.material as THREE.MeshStandardMaterial;
      if (!mat.emissive) continue;
      mat.emissive.setHex(im.instanceId === instanceId ? 0x553300 : 0x000000);
    }
  }

  /** 显示某特征在当前 B 角下的刀具+刀柄回转包络(半透明圆柱) */
  showEnvelope(
    feature: MachiningFeature,
    tool: ToolDef | undefined,
    worldPos: THREE.Vector3,
    worldDir: THREE.Vector3,
  ): void {
    this.envelopeGroup.clear();
    const rTool = (tool?.diameter ?? feature.diameter) / 2;
    const rHolder = (tool?.holderDiameter ?? rTool * 4) / 2;
    const totalLen = (tool?.fluteLength ?? 40) + (tool?.holderLength ?? 40);
    const holderLen = tool?.holderLength ?? 40;

    const makeCyl = (r: number, len: number, depth0: number, color: number, opacity: number) => {
      const geo = new THREE.CylinderGeometry(r, r, len, 28, 1, true);
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false });
      const m = new THREE.Mesh(geo, mat);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), worldDir.clone().negate());
      m.quaternion.copy(q);
      m.position.copy(worldPos).addScaledVector(worldDir, -(depth0 + len / 2));
      this.envelopeGroup.add(m);
    };
    makeCyl(rTool, totalLen, 0, 0x37e6b5, 0.18);
    makeCyl(rHolder, holderLen, totalLen - holderLen, 0xffb347, 0.22);
  }

  clearEnvelope(): void {
    this.envelopeGroup.clear();
  }

  screenshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  private onClick = (e: MouseEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([...this.towerGroup.children, ...this.markerGroup.children], true);
    for (const h of hits) {
      let obj: THREE.Object3D | null = h.object;
      while (obj) {
        if (obj.userData.pickKind === 'feature') {
          this.clickHandler?.({ kind: 'feature', instanceId: '', featureId: obj.userData.featureId });
          return;
        }
        if (obj.userData.pickKind) {
          this.clickHandler?.({
            kind: obj.userData.pickKind as ViewPick['kind'],
            instanceId: (obj as THREE.Mesh).userData.instanceId ?? '',
          });
          return;
        }
        obj = obj.parent;
      }
    }
  };

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.renderer.domElement.removeEventListener('click', this.onClick);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
