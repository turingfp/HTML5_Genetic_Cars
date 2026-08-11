/**
 * The graveyard: a marker wherever a car died, kept across generations.
 *
 * This is the search made visible. Individual runs are forgettable, but the
 * accumulated deaths show the shape of the problem. Dense clusters pile up at
 * the obstacles the population cannot yet pass, and the frontier of bright,
 * recent markers creeps to the right as evolution finds a way through.
 *
 * All markers are one InstancedMesh, so ten thousand of them cost a single
 * draw call.
 */

import {
  Color,
  ConeGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from 'three';

export interface Death {
  x: number;
  y: number;
  z: number;
  generation: number;
  /** Fell off the road, rather than simply running out of health. */
  fellOff: boolean;
}

const MAX_MARKERS = 8000;

/**
 * The newest generation burns amber; older ones sink toward a dead grey that
 * recedes into the asphalt. Old markers were previously as vivid as new ones,
 * so a long run turned into an undifferentiated field of colour instead of
 * showing where the search has actually reached.
 */
const OLD = new Color(0x2c2c30);
const MID = new Color(0x8a5a10);
const NEW = new Color(0xffb000);

export class Graveyard {
  readonly mesh: InstancedMesh;
  private deaths: Death[] = [];
  private latestGeneration = 0;
  private dummy = new Object3D();
  private color = new Color();
  private needsRecolor = false;

  constructor() {
    // A dropped pin: cheap, reads clearly at any angle, points at the ground.
    //
    // Deliberately small. At full size a hundred generations of markers buried
    // the road and the cars entirely; the field has to read as a texture of
    // where the population keeps failing, not as scenery in its own right.
    const geometry = new ConeGeometry(0.075, 0.26, 5);
    geometry.rotateX(Math.PI);
    const material = new MeshBasicMaterial({ transparent: true, opacity: 0.6 });

    this.mesh = new InstancedMesh(geometry, material, MAX_MARKERS);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  get count(): number {
    return this.deaths.length;
  }

  add(death: Death): void {
    if (this.deaths.length >= MAX_MARKERS) {
      // Drop the oldest and rebuild; only happens after thousands of cars.
      this.deaths.shift();
      this.rebuild();
    }

    const index = this.deaths.length;
    this.deaths.push(death);

    this.dummy.position.set(death.x, death.y + 0.2, death.z);
    // Cars that fell off the road get a tilted marker, so a glance separates
    // "ground to a halt" from "went over the edge".
    this.dummy.rotation.set(death.fellOff ? 0.9 : 0, index * 0.7, 0);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(index, this.dummy.matrix);

    this.mesh.count = this.deaths.length;
    this.mesh.instanceMatrix.needsUpdate = true;

    if (death.generation > this.latestGeneration) {
      this.latestGeneration = death.generation;
      // Every marker's colour is relative to the newest generation, so the
      // whole field ages as evolution moves on.
      this.needsRecolor = true;
    }
    this.applyColor(index, death);
    this.mesh.instanceColor!.needsUpdate = true;
  }

  /** Recolour everything once per generation rather than once per frame. */
  update(): void {
    if (!this.needsRecolor) return;
    this.needsRecolor = false;
    for (let i = 0; i < this.deaths.length; i++) this.applyColor(i, this.deaths[i]!);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private applyColor(index: number, death: Death): void {
    // Age is measured in generations behind the current one, so a long run
    // still shows a readable gradient rather than saturating.
    const span = Math.max(this.latestGeneration, 6);
    const age = Math.min(1, (this.latestGeneration - death.generation) / span);
    if (age < 0.5) this.color.copy(NEW).lerp(MID, age * 2);
    else this.color.copy(MID).lerp(OLD, (age - 0.5) * 2);
    this.mesh.setColorAt(index, this.color);
  }

  private rebuild(): void {
    const matrix = new Matrix4();
    const position = new Vector3();
    const quaternion = new Quaternion();
    const scale = new Vector3(1, 1, 1);
    this.deaths.forEach((death, i) => {
      position.set(death.x, death.y + 0.2, death.z);
      quaternion.setFromEuler(this.dummy.rotation.set(death.fellOff ? 0.9 : 0, i * 0.7, 0));
      matrix.compose(position, quaternion, scale);
      this.mesh.setMatrixAt(i, matrix);
    });
    this.mesh.count = this.deaths.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.needsRecolor = true;
  }

  clear(): void {
    this.deaths = [];
    this.latestGeneration = 0;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
  }
}
