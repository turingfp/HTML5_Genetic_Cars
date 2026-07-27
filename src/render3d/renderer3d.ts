/**
 * The 3D view.
 *
 * Cars are rebuilt as meshes whenever a new generation starts, then only their
 * transforms change per frame — the geometry of a car never varies once it is
 * born, so there is nothing else to update.
 */

import {
  AmbientLight,
  BoxGeometry,
  CapsuleGeometry,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';

import { CAMERA_SMOOTHING, PHYSICS_HZ, TILE_HEIGHT, TILE_WIDTH } from '../config';
import { chassisHullPoints, wheelMounts, type Car3DDef } from '../ga/genome3d';
import type { World3DSnapshot } from '../sim3d/simulation3d';
import { segmentRotation, type Track3D } from '../sim3d/track3d';

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

  private road: InstancedMesh | null = null;
  private roadSeed = '';
  private cars: CarMeshes[] = [];
  private carGeneration = -1;

  /** Where the camera is looking, eased toward the leader. */
  private focus = new Vector3(0, 2, 0);
  private observer: ResizeObserver | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    this.scene = new Scene();
    this.scene.background = new Color(0x0b1120);
    this.scene.fog = new Fog(0x0b1120, 40, 130);

    this.camera = new PerspectiveCamera(55, 1, 0.1, 400);

    this.scene.add(new AmbientLight(0xffffff, 0.35));
    this.scene.add(new HemisphereLight(0x9ec9ff, 0x0b1120, 0.7));

    const sun = new DirectionalLight(0xfff2d5, 2.1);
    sun.position.set(-30, 60, 35);
    this.scene.add(sun);

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
    this.road?.geometry.dispose();
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

  /** Build the road once per track: 200 identical boxes, one draw call. */
  private buildRoad(track: Track3D): void {
    if (this.road) {
      this.scene.remove(this.road);
      this.road.geometry.dispose();
      this.road = null;
    }

    const geometry = new BoxGeometry(TILE_WIDTH, TILE_HEIGHT, track.halfWidth * 2);
    const material = new MeshLambertMaterial({ color: 0x51708f });
    const mesh = new InstancedMesh(geometry, material, track.segments.length);

    const matrix = new Matrix4();
    const position = new Vector3();
    const quaternion = new Quaternion();
    const scale = new Vector3(1, 1, 1);

    track.segments.forEach((segment, i) => {
      const r = segmentRotation(segment);
      position.set(segment.center.x, segment.center.y, segment.center.z);
      quaternion.set(r.x, r.y, r.z, r.w);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;

    this.scene.add(mesh);
    this.road = mesh;
    this.roadSeed = track.seed;
  }

  private clearCars(): void {
    for (const car of this.cars) {
      this.scene.remove(car.group);
      car.chassis.geometry.dispose();
      car.material.dispose();
      for (const wheel of car.wheels) wheel.geometry.dispose();
    }
    this.cars = [];
  }

  private buildCars(defs: (Car3DDef | null)[]): void {
    this.clearCars();

    const wheelMaterial = new MeshStandardMaterial({
      color: 0x2f3d52,
      roughness: 0.7,
      metalness: 0.2,
    });

    for (const def of defs) {
      const group = new Group();
      const material = new MeshStandardMaterial({
        color: NORMAL_COLOR,
        roughness: 0.5,
        metalness: 0.15,
        transparent: true,
        opacity: 0.85,
      });

      if (!def) {
        this.cars.push({ group, chassis: new Mesh(), wheels: [], material });
        continue;
      }

      const points = chassisHullPoints(def).map((p) => new Vector3(p.x, p.y, p.z));
      const chassis = new Mesh(new ConvexGeometry(points), material);
      group.add(chassis);

      const wheels: Mesh[] = [];
      for (const mount of wheelMounts(def)) {
        const radius = def.base.wheelRadius[mount.wheel]!;
        // A capsule matches the physics shape; three builds it along y, so it
        // is turned to lie along the axle.
        const geometry = new CapsuleGeometry(radius, 0.24, 4, 16);
        geometry.rotateX(Math.PI / 2);
        const wheel = new Mesh(geometry, wheelMaterial);
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

      const color = i === snapshot.leaderIndex ? LEADER_COLOR : car.isElite ? ELITE_COLOR : NORMAL_COLOR;
      meshes.material.color.setHex(color);
    }

    this.updateCamera(snapshot, dt);
    this.renderer.render(this.scene, this.camera);
  }

  private updateCamera(snapshot: World3DSnapshot, dt: number): void {
    const target = snapshot.leaderIndex >= 0 ? snapshot.leader : { x: 0, y: 2, z: 0 };
    // Same easing curve as the flat mode's camera, frame-rate independent.
    const factor = 1 - Math.pow(1 - CAMERA_SMOOTHING, Math.max(dt, 0) * PHYSICS_HZ);
    this.focus.x += (target.x - this.focus.x) * factor;
    this.focus.y += (target.y - this.focus.y) * factor;
    this.focus.z += (target.z - this.focus.z) * factor;

    // Trail behind and above, offset to the side so the road reads in depth.
    this.camera.position.set(this.focus.x - 5.5, this.focus.y + 3.4, this.focus.z + 7);
    this.camera.lookAt(this.focus.x + 2.5, this.focus.y - 0.2, this.focus.z);
  }

  /** Nudge the camera straight to the action, e.g. after a reset. */
  snapTo(x: number, y: number, z: number): void {
    this.focus.set(x, y, z);
  }
}
