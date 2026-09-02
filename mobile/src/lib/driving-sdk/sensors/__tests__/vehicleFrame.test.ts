/**
 * @fileoverview The geometry behind the phone→vehicle rotation, tested without a device.
 *
 * The property that matters is not any single number: it is that the *same physical
 * force on the car* resolves to the same vehicle-frame components no matter how the
 * phone is sitting. That is what CAR-167 found missing — a phone upright in a vent clip
 * turned a car's cornering force off its X axis and its yaw off its Z at the same time,
 * so a car trip read as rail travel.
 */
import {
  VehicleFrameEstimator,
  Vec3,
  horizontalBasis,
  projectHorizontal,
  yawRateAboutGravity,
} from '@/lib/driving-sdk/sensors/vehicleFrame';

const FLAT: Vec3 = { x: 0, y: 0, z: 1 };          // phone lying face-up on a seat
const VENT_CLIP: Vec3 = { x: 0, y: 1, z: 0 };     // upright in a vent clip — CAR-167
const TILTED: Vec3 = { x: 0.5774, y: 0.5774, z: 0.5774 };

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * Teaches an estimator that `forward` is the vehicle's forward direction, by replaying
 * the evidence a real drive gives it: speed changes, and the force felt over them.
 */
function teachForward(estimator: VehicleFrameEstimator, gravity: Vec3, forward: Vec3) {
  const basis = horizontalBasis(gravity)!;
  const forward2d = projectHorizontal(forward, basis);
  for (let i = 0; i < 5; i++) {
    // Alternate acceleration and braking. Braking flips both the GPS sign and the force,
    // so the two agree on the same axis — which is the whole mechanism.
    const sign = i % 2 === 0 ? 1 : -1;
    estimator.observe(
      { a: forward2d.a * 0.3 * sign, b: forward2d.b * 0.3 * sign },
      2.0 * sign,
      basis,
    );
  }
  return basis;
}

describe('horizontalBasis', () => {
  test.each([
    ['flat', FLAT],
    ['vent clip', VENT_CLIP],
    ['tilted', TILTED],
  ])('returns axes orthogonal to gravity and to each other — %s', (_name, gravity) => {
    const basis = horizontalBasis(gravity)!;

    expect(basis).not.toBeNull();
    expect(dot(basis.e1, basis.gravityUnit)).toBeCloseTo(0, 6);
    expect(dot(basis.e2, basis.gravityUnit)).toBeCloseTo(0, 6);
    expect(dot(basis.e1, basis.e2)).toBeCloseTo(0, 6);
    expect(dot(basis.e1, basis.e1)).toBeCloseTo(1, 6);
    expect(dot(basis.e2, basis.e2)).toBeCloseTo(1, 6);
  });

  // Gravity this weak is an EMA that has not converged or a device in free fall. Neither
  // defines a horizontal plane, and inventing one would put every later value in a frame
  // that means nothing.
  test('returns null when gravity has not converged', () => {
    expect(horizontalBasis({ x: 0.05, y: 0, z: 0.05 })).toBeNull();
  });
});

describe('projectHorizontal', () => {
  test('drops the component along gravity and keeps the rest', () => {
    const basis = horizontalBasis(FLAT)!;

    // Straight down the gravity axis: nothing horizontal survives.
    expect(Math.hypot(...Object.values(projectHorizontal({ x: 0, y: 0, z: 0.5 }, basis))))
      .toBeCloseTo(0, 6);
    // Entirely horizontal: the magnitude survives intact.
    expect(Math.hypot(...Object.values(projectHorizontal({ x: 0.3, y: 0.4, z: 0 }, basis))))
      .toBeCloseTo(0.5, 6);
  });
});

describe('yawRateAboutGravity', () => {
  // For a phone lying flat the device's Z gyro *is* yaw, which is why reading Z directly
  // ever looked correct. Every other orientation is where it breaks.
  test('agrees with the device Z axis only when the phone lies flat', () => {
    expect(yawRateAboutGravity({ x: 0, y: 0, z: 0.4 }, FLAT)).toBeCloseTo(0.4, 6);
  });

  test('reads yaw off the correct axis for a vent-clipped phone', () => {
    // The car yaws about the phone's Y axis in this mounting. Reading Z would report
    // 0.4 rad/s of real turning as 0 — CAR-167's failure, exactly.
    const gyro = { x: 0, y: 0.4, z: 0 };

    expect(yawRateAboutGravity(gyro, VENT_CLIP)).toBeCloseTo(0.4, 6);
    expect(gyro.z).toBe(0);
  });

  test('returns null rather than 0 when gravity has not converged', () => {
    expect(yawRateAboutGravity({ x: 0, y: 0, z: 0.4 }, { x: 0, y: 0, z: 0.05 })).toBeNull();
  });
});

describe('VehicleFrameEstimator', () => {
  test('reports nothing until enough evidence agrees', () => {
    const estimator = new VehicleFrameEstimator();
    const basis = horizontalBasis(FLAT)!;

    expect(estimator.isResolved).toBe(false);
    expect(estimator.resolve({ a: 0.2, b: 0 })).toBeNull();

    // Three observations is one short of the minimum.
    for (let i = 0; i < 3; i++) estimator.observe({ a: 0.3, b: 0 }, 2.0, basis);
    expect(estimator.isResolved).toBe(false);
  });

  test('ignores speed changes too gentle to carry a direction', () => {
    const estimator = new VehicleFrameEstimator();
    const basis = horizontalBasis(FLAT)!;

    for (let i = 0; i < 10; i++) estimator.observe({ a: 0.3, b: 0 }, 0.1, basis);

    expect(estimator.isResolved).toBe(false);
  });

  test('finds no direction in observations that cancel out', () => {
    const estimator = new VehicleFrameEstimator();
    const basis = horizontalBasis(FLAT)!;

    // Same GPS sign, opposite forces — road vibration rather than a forward axis.
    for (let i = 0; i < 10; i++) {
      estimator.observe({ a: i % 2 ? 0.3 : -0.3, b: 0 }, 2.0, basis);
    }

    expect(estimator.coherence).toBeLessThan(0.6);
    expect(estimator.isResolved).toBe(false);
  });

  test('splits a force into forward and left once the frame is known', () => {
    const estimator = new VehicleFrameEstimator();
    const forward: Vec3 = { x: 1, y: 0, z: 0 };
    const basis = teachForward(estimator, FLAT, forward);

    expect(estimator.isResolved).toBe(true);

    // A pure braking force: backward along forward, nothing lateral.
    const braking = estimator.resolve(projectHorizontal({ x: -0.4, y: 0, z: 0 }, basis))!;
    expect(braking.longitudinal).toBeCloseTo(-0.4, 5);
    expect(braking.lateral).toBeCloseTo(0, 5);

    // A pure cornering force, perpendicular to forward. Lying face-up the phone's up axis
    // is +Z and forward is +X, so left — up × forward — is +Y: this force is to the left,
    // and the sign is asserted, not just the magnitude. peakLateralG's sign is on the wire.
    const cornering = estimator.resolve(projectHorizontal({ x: 0, y: 0.3, z: 0 }, basis))!;
    expect(cornering.lateral).toBeCloseTo(0.3, 5);
    expect(cornering.longitudinal).toBeCloseTo(0, 5);
  });

  // The CAR-167 case stated as a property: the same force on the car has to resolve to
  // the same vehicle-frame components in a vent clip as flat on a seat.
  test('resolves the same physical force identically in two mountings', () => {
    const flatEstimator = new VehicleFrameEstimator();
    const clipEstimator = new VehicleFrameEstimator();

    // The car drives the same way in both. Only the phone's orientation differs, so the
    // forward direction lands on a different device axis in each.
    const flatBasis = teachForward(flatEstimator, FLAT, { x: 1, y: 0, z: 0 });
    const clipBasis = teachForward(clipEstimator, VENT_CLIP, { x: 1, y: 0, z: 0 });

    // One cornering force on the car — the same one — expressed in each phone's own axes.
    // Left is up × forward, and the two mountings put "up" on different device axes: flat
    // it is +Z, so left is +Y; in the clip it is +Y, so left is −Z. Feeding +Z there would
    // be the car cornering the *other* way, which is why the signs are asserted directly
    // rather than through Math.abs — that comparison passed on opposite forces.
    const flat = flatEstimator.resolve(projectHorizontal({ x: 0, y: 0.25, z: 0 }, flatBasis))!;
    const clip = clipEstimator.resolve(projectHorizontal({ x: 0, y: 0, z: -0.25 }, clipBasis))!;

    expect(flat.lateral).toBeCloseTo(0.25, 5);
    expect(clip.lateral).toBeCloseTo(flat.lateral, 5);
    expect(flat.longitudinal).toBeCloseTo(0, 5);
    expect(clip.longitudinal).toBeCloseTo(0, 5);
  });

  // A phone that is picked up or slides is the case a one-off calibration cannot survive,
  // and the reason the estimator watches gravity rather than trusting what it learned.
  test('restarts when the phone moves enough to invalidate the frame', () => {
    const estimator = new VehicleFrameEstimator();
    teachForward(estimator, FLAT, { x: 1, y: 0, z: 0 });
    expect(estimator.isResolved).toBe(true);

    const movedBasis = horizontalBasis(VENT_CLIP)!;
    estimator.observe({ a: 0.3, b: 0 }, 2.0, movedBasis);

    expect(estimator.isResolved).toBe(false);
  });

  test('tolerates a small tilt without throwing the estimate away', () => {
    const estimator = new VehicleFrameEstimator();
    teachForward(estimator, FLAT, { x: 1, y: 0, z: 0 });

    // ~5.7° — a mount flexing over a bump, not a phone being moved.
    estimator.observe({ a: 0.3, b: 0 }, 2.0, horizontalBasis({ x: 0.1, y: 0, z: 1 })!);

    expect(estimator.isResolved).toBe(true);
  });
});
