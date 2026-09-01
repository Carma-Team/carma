/**
 * @file vehicleFrame.ts
 * @owner May Hajbi — driving-sdk maintainer
 * @brief Resolves phone-frame IMU readings into the vehicle's frame: horizontal force
 * split into signed longitudinal and lateral components, and angular rate about gravity.
 *
 * @description
 * A phone reports forces on *itself*, in whatever orientation it happens to be sitting.
 * Everything downstream — event severity, and any claim about cornering or heading —
 * describes forces on *the vehicle*. Without this stage a phone lying at an arbitrary
 * rotation on a passenger seat reports a car's cornering force as longitudinal and its
 * braking as lateral, which is exactly how a car trip gets classified as rail travel.
 *
 * Four steps, from docs/fraud-detection.md §3.2. Steps 1 and 2 — isolate gravity, project
 * it out — already live in SensorManager and are its inputs here. This file is 3 and 4:
 *
 * 3. Split the horizontal force into longitudinal and lateral, using the vehicle's
 *    forward direction as the reference.
 * 4. Resolve angular rate about the gravity vector. That, and only that, is yaw —
 *    the device's own Z axis is yaw only for a phone lying perfectly flat.
 *
 * **Finding forward is the whole problem**, because nothing tells the phone which way the
 * car points. The method is CMT's US9228836B2 and needs no staged calibration drive: when
 * GPS says the vehicle sped up or slowed down, whatever horizontal force the IMU felt over
 * that same stretch was aligned with the forward axis — forward when speeding up, backward
 * when slowing. Sum those observations, each signed by the GPS change, and the direction
 * they agree on is forward. A phone that moves mid-trip invalidates the estimate, which is
 * why a shift in the gravity direction restarts it rather than quietly reporting a stale
 * frame. Where the frame cannot be resolved the answer is `null`, never zero (§3.1).
 *
 * @remarks Pure functions and one estimator holding no sensor subscriptions, so the
 * geometry is testable without mocking a device.
 */

export interface Vec3 { x: number; y: number; z: number }

/** A horizontal force in the plane perpendicular to gravity, in the basis below. */
export interface Horizontal2D { a: number; b: number }

/** Signed vehicle-frame components. Positive longitudinal is forward. */
export interface VehicleFrameForce {
  longitudinal: number;
  lateral: number;
}

// Two orthonormal axes spanning the horizontal plane. Which two does not matter — they
// are an internal coordinate system, and the forward estimate is expressed in them — but
// they must be *stable* while an estimate accumulates, which is why they are derived
// deterministically from gravity rather than from whatever the last sample looked like.
export interface HorizontalBasis { e1: Vec3; e2: Vec3; gravityUnit: Vec3 }

// Below this the gravity vector is not trustworthy enough to define a plane — the EMA has
// not converged, or the device is in free fall. Both are "no frame", not "frame at zero".
const MIN_GRAVITY_MAGNITUDE = 0.3; // g

// GPS longitudinal acceleration weaker than this is not evidence of anything: at a steady
// cruise the residual is speed noise, and letting it vote drags the estimate toward
// whichever direction the road vibrates in. ~0.5 m/s² is a deliberate, gentle change.
const FORWARD_LEARN_MIN_MS2 = 0.5;

// Observations that must agree before the frame is usable. Each one is a whole GPS
// evaluation window (≥1.5 s), so this is a handful of real speed changes, not seconds.
const MIN_OBSERVATIONS = 4;

// How aligned those observations have to be: the length of their vector sum over the sum
// of their lengths. 1.0 is perfect agreement; a value near 0 means they cancelled out and
// no direction was found. 0.6 accepts a noisy but consistent estimate and rejects a wash.
const MIN_COHERENCE = 0.6;

// A gravity direction this far from the one the estimate was built under means the phone
// has been picked up, re-mounted or slid — the forward axis no longer points where it did.
// cos 20° ≈ 0.94. Re-segmenting is the property that survives a phone that moves mid-trip.
const GRAVITY_SHIFT_COS = 0.94;

function magnitude(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function scaled(v: Vec3, k: number): Vec3 {
  return { x: v.x * k, y: v.y * k, z: v.z * k };
}

/**
 * An orthonormal basis for the plane perpendicular to `gravity`, or `null` when gravity
 * is too weak to define one.
 */
export function horizontalBasis(gravity: Vec3): HorizontalBasis | null {
  const gMag = magnitude(gravity);
  if (gMag < MIN_GRAVITY_MAGNITUDE) return null;
  const gravityUnit = scaled(gravity, 1 / gMag);

  // Seed the cross product with whichever axis gravity is least aligned with, so the two
  // vectors are never near-parallel and e1 never collapses to noise.
  const ax = Math.abs(gravityUnit.x);
  const ay = Math.abs(gravityUnit.y);
  const az = Math.abs(gravityUnit.z);
  const seed: Vec3 = az <= ax && az <= ay ? { x: 0, y: 0, z: 1 }
    : ay <= ax ? { x: 0, y: 1, z: 0 }
    : { x: 1, y: 0, z: 0 };

  const e1raw = cross(gravityUnit, seed);
  const e1 = scaled(e1raw, 1 / magnitude(e1raw));
  const e2 = cross(gravityUnit, e1); // already unit: two orthogonal unit vectors
  return { e1, e2, gravityUnit };
}

/** Coordinates of `v`'s horizontal part in the basis. The vertical part is dropped. */
export function projectHorizontal(v: Vec3, basis: HorizontalBasis): Horizontal2D {
  return { a: dot(v, basis.e1), b: dot(v, basis.e2) };
}

/**
 * Angular rate about the gravity vector (rad/s) — the vehicle's yaw, signed. `null` when
 * gravity has not converged. Reading the device's Z gyro instead is correct only for a
 * phone lying perfectly flat, which is the assumption CAR-167 was filed against.
 */
export function yawRateAboutGravity(gyro: Vec3, gravity: Vec3): number | null {
  const gMag = magnitude(gravity);
  if (gMag < MIN_GRAVITY_MAGNITUDE) return null;
  return dot(gyro, scaled(gravity, 1 / gMag));
}

/**
 * Learns the vehicle's forward direction from agreement between GPS speed changes and the
 * horizontal force felt over the same stretch, and resolves horizontal forces against it.
 *
 * Opportunistic: it learns from ordinary driving and needs no staged calibration.
 */
export class VehicleFrameEstimator {
  // Vector sum of signed observations, in the horizontal basis. Its direction is the
  // forward estimate; its length against `totalWeight` is how much they agreed.
  private sum: Horizontal2D = { a: 0, b: 0 };
  private totalWeight = 0;
  private observations = 0;
  // Gravity direction the accumulated observations were taken under — the reference a
  // later sample is compared against to notice the phone has moved.
  private anchorGravityUnit: Vec3 | null = null;

  /**
   * Offers one evidence pair: the mean horizontal force over a GPS evaluation window, and
   * the longitudinal acceleration GPS measured across it. Weak GPS changes are ignored —
   * they carry no direction.
   */
  public observe(force: Horizontal2D, gpsLongitudinalMs2: number, basis: HorizontalBasis): void {
    if (Math.abs(gpsLongitudinalMs2) < FORWARD_LEARN_MIN_MS2) return;

    if (this.anchorGravityUnit === null) {
      this.anchorGravityUnit = basis.gravityUnit;
    } else if (dot(this.anchorGravityUnit, basis.gravityUnit) < GRAVITY_SHIFT_COS) {
      // The phone moved. Everything learned describes an orientation it no longer has.
      this.reset();
      this.anchorGravityUnit = basis.gravityUnit;
    }

    // Sign, not magnitude: deceleration means the force pointed backward along forward.
    // The observation's own weight is the force it carried, so a firm brake counts for
    // more than a gentle one without any explicit weighting term.
    const sign = gpsLongitudinalMs2 > 0 ? 1 : -1;
    this.sum = { a: this.sum.a + sign * force.a, b: this.sum.b + sign * force.b };
    this.totalWeight += Math.hypot(force.a, force.b);
    this.observations++;
  }

  /** How much the observations agree, 0–1. See MIN_COHERENCE. */
  public get coherence(): number {
    if (this.totalWeight === 0) return 0;
    return Math.hypot(this.sum.a, this.sum.b) / this.totalWeight;
  }

  public get isResolved(): boolean {
    return this.observations >= MIN_OBSERVATIONS && this.coherence >= MIN_COHERENCE;
  }

  /**
   * Splits a horizontal force into signed longitudinal and lateral components, or `null`
   * while the forward direction is still unknown. Positive longitudinal is forward, so a
   * brake is negative; positive lateral is to the left of travel.
   */
  public resolve(force: Horizontal2D): VehicleFrameForce | null {
    if (!this.isResolved) return null;
    const norm = Math.hypot(this.sum.a, this.sum.b);
    const fa = this.sum.a / norm;
    const fb = this.sum.b / norm;
    return {
      longitudinal: force.a * fa + force.b * fb,
      // Left is forward rotated a quarter turn within the plane.
      lateral: -force.a * fb + force.b * fa,
    };
  }

  public reset(): void {
    this.sum = { a: 0, b: 0 };
    this.totalWeight = 0;
    this.observations = 0;
    this.anchorGravityUnit = null;
  }
}
