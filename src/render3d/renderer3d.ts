/**
 * The 3D view.
 *
 * Cars are rebuilt as meshes whenever a new generation starts, then only their
 * transforms change per frame. The geometry of a car never varies once it is
 * born, so there is nothing else to update.
 */

import {
  ACESFilmicToneMapping,
  AmbientLight,
  BackSide,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { CAMERA_SMOOTHING, PHYSICS_HZ } from '../config';
import { detectQuality } from '../core/device';
import { chassisHullPoints, wheelMounts, type Car3DDef } from '../ga/genome3d';
import { lineageHex, lineageHue } from '../ga/lineage';
import { wheelHalfTread } from '../sim3d/car3d';
import type { World3DSnapshot } from '../sim3d/simulation3d';
import type { Track3D } from '../sim3d/track3d';
import { Graveyard, type Death } from './graveyard';
import { buildDistanceMarkers, buildRoadGeometry } from './road';
import { Trails } from './trails';

const ELITE_COLOR = 0x60a5fa;
const NORMAL_COLOR = 0xf87171;
const LEADER_COLOR = 0xfde047;

interface CarMeshes {
  group: Group;
  chassis: Mesh;
  wheels: Mesh[];
  material: MeshStandardMaterial;
}

export class Renderer3D {
  private renderer: WebGLRenderer;
  private scene: Scene;
  private camera: PerspectiveCamera;
  private canvas: HTMLCanvasElement;

  private road: Mesh | null = null;
  private roadSeed = '';
  private cars: CarMeshes[] = [];
  private carGeneration = -1;

  /** Where the camera is looking, eased toward the leader. */
  private focus = new Vector3(0, 2, 0);
  private observer: ResizeObserver | null = null;
  private sun: DirectionalLight;

  // Identical for every car and every generation, so built once and shared
  // rather than recreated each time a generation is born.
  /** Colour cars by the family they descend from rather than by status. */
  colourByLineage = false;

  private readonly wheelMaterial = new MeshStandardMaterial({
    color: 0x11161f,
    roughness: 0.85,
    metalness: 0.05,
  });
  private readonly hubMaterial = new MeshBasicMaterial({ color: 0xcbd5e1 });

  private controls: OrbitControls;
  /**
   * Set when the browser takes the WebGL context away, which iOS does when it
   * decides the tab is using too much memory. three.js keeps being told to
   * draw and quietly does nothing, so the canvas freezes with no error
   * anywhere. Someone has to notice, and it may as well be us.
   */
  contextLost = false;
  /** Called when the context is lost or comes back, so the app can say so. */
  onContextChange: ((lost: boolean) => void) | null = null;
  readonly graveyard = new Graveyard();
  readonly trails = new Trails();

  /** Whether the camera keeps following the leader as it drives. */
  followLeader = true;
  showGraveyard = true;
  showTrails = true;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const quality = detectQuality();
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: quality.antialias,
      // A phone that cannot keep a context alive should get a slow scene
      // rather than a dead one.
      powerPreference: quality.lowPower ? 'default' : 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.maxPixelRatio));
    // Shadows are what make the cars sit *on* the road rather than float above
    // it; without them the scene reads flat however good the geometry is. So
    // they stay on everywhere, and a phone gets a smaller map instead of none.
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    // Filmic tone mapping instead of clipping raw values: the bright sunlit
    // road no longer washes out to flat white and the shadowed sides keep
    // their colour, which is most of the difference between "3D shapes" and
    // "a scene".
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene = new Scene();
    this.scene.fog = new Fog(0x0b1120, 55, 200);
    this.scene.add(this.buildSky());

    this.camera = new PerspectiveCamera(55, 1, 0.1, 600);

    this.scene.add(new AmbientLight(0xffffff, 0.25));
    this.scene.add(new HemisphereLight(0x9ec9ff, 0x101a2e, 0.55));

    this.sun = new DirectionalLight(0xfff2d5, 2.4);
    this.sun.position.set(-24, 40, 22);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    // A tight ortho frustum that travels with the action keeps the shadow map's
    // texels small enough to resolve individual wheels.
    const shadow = this.sun.shadow.camera;
    shadow.near = 1;
    shadow.far = 120;
    shadow.left = -22;
    shadow.right = 22;
    shadow.top = 22;
    shadow.bottom = -22;
    this.sun.shadow.bias = -0.0012;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.scene.add(this.graveyard.mesh);
    this.scene.add(this.trails.group);

    // Orbiting is the point of the 3D view: the graveyard is worth flying
    // around and looking along. The target keeps tracking the action, so
    // dragging changes your angle on the race rather than losing it.
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 120;
    // Stay above ground; looking up from underneath the road is disorienting.
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.camera.position.set(-8, 4.6, 9.5);

    canvas.addEventListener('webglcontextlost', (event) => {
      // Preventing the default is what makes the loss recoverable at all;
      // without it the browser never offers the context back.
      event.preventDefault();
      this.contextLost = true;
      this.onContextChange?.(true);
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.onContextChange?.(false);
    });

    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(canvas);
    }
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.clearCars();
    this.wheelMaterial.dispose();
    this.hubMaterial.dispose();
    this.road?.geometry.dispose();
    this.graveyard.dispose();
    this.trails.dispose();
    this.controls.dispose();
    this.renderer.dispose();
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** A vertical gradient standing in for a sky, so the horizon is not a void. */
  private buildSky(): Mesh {
    const material = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new Color(0x0a1122) },
        bottom: { value: new Color(0x24466e) },
      },
      vertexShader: `
        varying vec3 vWorld;
        void main() {
          vWorld = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 top;
        uniform vec3 bottom;
        varying vec3 vWorld;
        void main() {
          float h = clamp(normalize(vWorld).y * 0.5 + 0.5, 0.0, 1.0);
          gl_FragColor = vec4(mix(bottom, top, pow(h, 0.7)), 1.0);
        }
      `,
    });
    const sky = new Mesh(new SphereGeometry(400, 24, 16), material);
    sky.frustumCulled = false;
    return sky;
  }

  /** Build the road once per track, as a single stitched ribbon. */
  private buildRoad(track: Track3D): void {
    if (this.road) {
      this.scene.remove(this.road);
      this.road.geometry.dispose();
      (this.road.material as MeshStandardMaterial).dispose();
      this.road = null;
    }

    const material = new MeshStandardMaterial({
      color: 0x62809c,
      roughness: 0.95,
      metalness: 0.02,
      // Tilt is clamped only just under a quarter turn, so two neighbouring
      // tiles can differ by most of a half turn and the quad joining them
      // genuinely folds. No winding is correct there, so draw both sides.
      side: DoubleSide,
    });
    const mesh = new Mesh(buildRoadGeometry(track), material);
    mesh.receiveShadow = true;

    // Bars every ten metres, so speed and distance are legible.
    const markers = new Mesh(
      buildDistanceMarkers(track),
      new MeshBasicMaterial({ color: 0xe8f1ff, transparent: true, opacity: 0.55 }),
    );
    markers.frustumCulled = false;
    mesh.add(markers);

    this.scene.add(mesh);
    this.road = mesh;
    this.roadSeed = track.seed;
  }

  /**
   * Release a generation's meshes.
   *
   * Traverses rather than touching the top-level meshes only: each wheel also
   * carries a hub and a marker as children, and disposing just the wheel left
   * eight geometries per car behind on the GPU every generation.
   */
  private clearCars(): void {
    for (const car of this.cars) {
      this.scene.remove(car.group);
      car.group.traverse((object) => {
        const mesh = object as Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
      });
      // Only the body material is per-car; the wheel and hub materials are
      // shared for the renderer's lifetime and disposed with it.
      car.material.dispose();
    }
    this.cars = [];
  }

  private buildCars(defs: (Car3DDef | null)[]): void {
    this.clearCars();

    const { wheelMaterial, hubMaterial } = this;

    for (const def of defs) {
      const group = new Group();
      const material = new MeshStandardMaterial({
        color: NORMAL_COLOR,
        roughness: 0.45,
        metalness: 0.2,
        // Opaque: a translucent body hid the wheels behind it and made the
        // whole car read as a smudge rather than a machine.
        flatShading: true,
      });

      if (!def) {
        this.cars.push({ group, chassis: new Mesh(), wheels: [], material });
        continue;
      }

      const points = chassisHullPoints(def).map((p) => new Vector3(p.x, p.y, p.z));
      const chassis = new Mesh(new ConvexGeometry(points), material);
      chassis.castShadow = true;
      group.add(chassis);

      const wheels: Mesh[] = [];
      for (const mount of wheelMounts(def)) {
        const radius = def.base.wheels[mount.wheel]!.radius;
        const width = wheelHalfTread(radius) * 2;
        // A cylinder matching the physics hull exactly. Three builds cylinders
        // along y, so it is turned to lie along the axle.
        const geometry = new CylinderGeometry(radius, radius, width, 16);
        geometry.rotateX(Math.PI / 2);
        const wheel = new Mesh(geometry, wheelMaterial);
        wheel.castShadow = true;

        // A pale hub disc on the outer face, so the wheel visibly spins.
        const hub = new Mesh(new CylinderGeometry(radius * 0.42, radius * 0.42, width * 1.04, 12), hubMaterial);
        hub.rotateX(Math.PI / 2);
        // Offset marker breaks the disc's symmetry so rotation is unmistakable.
        const spoke = new Mesh(new CylinderGeometry(radius * 0.1, radius * 0.1, width * 1.06, 6), hubMaterial);
        spoke.rotateX(Math.PI / 2);
        spoke.position.y = radius * 0.62;
        wheel.add(hub, spoke);

        wheels.push(wheel);
        group.add(wheel);
      }

      this.scene.add(group);
      this.cars.push({ group, chassis, wheels, material });
    }
  }

  draw(track: Track3D, snapshot: World3DSnapshot, dt: number): void {
    if (!this.road || this.roadSeed !== track.seed) this.buildRoad(track);

    // Geometry only changes when a new generation is born.
    if (this.carGeneration !== snapshot.generation || this.cars.length !== snapshot.cars.length) {
      this.buildCars(snapshot.cars.map((c) => c.def));
      this.carGeneration = snapshot.generation;
    }

    for (let i = 0; i < snapshot.cars.length; i++) {
      const car = snapshot.cars[i]!;
      const meshes = this.cars[i];
      if (!meshes) continue;

      meshes.group.visible = car.alive;
      if (!car.alive) continue;

      const p = car.chassis.position;
      const q = car.chassis.rotation;
      meshes.chassis.position.set(p.x, p.y, p.z);
      meshes.chassis.quaternion.set(q.x, q.y, q.z, q.w);

      for (let w = 0; w < meshes.wheels.length && w < car.wheels.length; w++) {
        const wheel = car.wheels[w]!;
        meshes.wheels[w]!.position.set(wheel.position.x, wheel.position.y, wheel.position.z);
        meshes.wheels[w]!.quaternion.set(
          wheel.rotation.x,
          wheel.rotation.y,
          wheel.rotation.z,
          wheel.rotation.w,
        );
      }

      // Every ordinary car got the same red, so a pack read as one mass. The
      // leader and the elites keep their fixed colours; the rest are spread
      // around the base hue so individuals can be followed by eye.
      if (i === snapshot.leaderIndex) {
        // The leader keeps its own colour even with families on: losing track
        // of who is winning costs more than the extra hue tells you.
        meshes.material.color.setHex(LEADER_COLOR);
      } else if (this.colourByLineage) {
        meshes.material.color.setHSL(lineageHue(car.lineage), 0.66, 0.56);
      } else if (car.isElite) {
        meshes.material.color.setHex(ELITE_COLOR);
      } else {
        meshes.material.color.setHex(NORMAL_COLOR);
        const spread = snapshot.cars.length > 1 ? i / (snapshot.cars.length - 1) : 0;
        meshes.material.color.offsetHSL((spread - 0.5) * 0.18, 0, (spread - 0.5) * 0.12);
      }
    }

    this.graveyard.mesh.visible = this.showGraveyard;
    this.graveyard.update();

    this.trails.group.visible = this.showTrails;
    if (this.showTrails) {
      this.trails.update(
        snapshot.cars.map((car, i) => ({
          alive: car.alive,
          position: car.chassis.position,
          color:
            i === snapshot.leaderIndex
              ? LEADER_COLOR
              : this.colourByLineage
                ? lineageHex(car.lineage)
                : car.isElite
                  ? ELITE_COLOR
                  : NORMAL_COLOR,
        })),
      );
    }

    this.updateCamera(snapshot, dt);

    // Carry the sun with the action so the shadow frustum stays tight around
    // whatever is on screen rather than spanning the whole 300 metre course.
    this.sun.target.position.copy(this.focus);
    this.sun.position.set(this.focus.x - 24, this.focus.y + 40, this.focus.z + 22);
    this.sun.target.updateMatrixWorld();

    this.renderer.render(this.scene, this.camera);
  }

  /** Record where a car came to rest. */
  addDeath(death: Death): void {
    this.graveyard.add(death);
  }

  /** Start a fresh set of trails, at the top of a generation. */
  resetTrails(): void {
    this.trails.reset();
  }

  clearHistory(): void {
    this.graveyard.clear();
    this.trails.reset();
  }

  private updateCamera(snapshot: World3DSnapshot, dt: number): void {
    if (this.followLeader) {
      const target = snapshot.leaderIndex >= 0 ? snapshot.leader : { x: 0, y: 2, z: 0 };
      // Same easing curve as the flat mode's camera, frame-rate independent.
      const factor = 1 - Math.pow(1 - CAMERA_SMOOTHING, Math.max(dt, 0) * PHYSICS_HZ);
      const previous = this.focus.clone();
      this.focus.x += (target.x - this.focus.x) * factor;
      this.focus.y += (target.y - this.focus.y) * factor;
      this.focus.z += (target.z - this.focus.z) * factor;

      // Carry the camera along with its target so the user's chosen orbit
      // angle and distance survive; OrbitControls only owns the offset.
      this.camera.position.add(this.focus.clone().sub(previous));
      this.controls.target.copy(this.focus);
    }
    this.controls.update();
  }

  /** Point the camera at a place, keeping the current viewing angle. */
  snapTo(x: number, y: number, z: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    this.focus.set(x, y, z);
    this.controls.target.copy(this.focus);
    this.camera.position.copy(this.focus).add(offset);
    this.controls.update();
  }

  /** Frame the whole graveyard, to see where the population keeps dying. */
  viewGraveyard(): void {
    this.followLeader = false;
    this.controls.target.copy(this.focus);
    this.camera.position.set(this.focus.x - 26, this.focus.y + 20, this.focus.z + 30);
    this.controls.update();
  }
}
