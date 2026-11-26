export interface Point2 {
  x: number;
  y: number;
}

export interface Point3 extends Point2 {
  z: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface OrthographicCamera {
  position: Point3;
  /** World-space Unity rotation in quaternion form. */
  rotation: Point3 & { w: number };
  /** Half the vertical coverage in world units. */
  orthographicSize: number;
}

export interface ScreenPoint extends Point2 {
  /** Distance along the camera's forward axis, in world units. */
  depth: number;
}

export type OrthographicProjection = (worldPosition: Point3) => ScreenPoint;

export interface SpriteGeometry {
  /** Untrimmed sprite size in image pixels. */
  rect: Size;
  /** Normalized pivot, measured from the bottom-left of the untrimmed rect. */
  pivot: Point2;
  /** Cropped image size and its bottom-left offset within the original rect, in pixels. */
  trim?: Size & { offset: Point2 };
  pixelsPerUnit: number;
}

export interface SpriteFlip {
  flipX?: boolean;
  flipY?: boolean;
}

/** Corners are named by their locations in the source image, including after a flip. */
export interface SpriteQuad<Coordinate> {
  topLeft: Coordinate;
  topRight: Coordinate;
  bottomRight: Coordinate;
  bottomLeft: Coordinate;
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/** Projects onto the viewport in pixels with the origin at its top-left. */
export function createOrthographicProjection(
  { position, rotation, orthographicSize }: OrthographicCamera,
  { width, height }: Size,
): OrthographicProjection {
  if (![orthographicSize, width, height].every(positiveFinite)) {
    throw new RangeError('Orthographic size and viewport dimensions must be positive and finite.');
  }
  const length = Math.hypot(rotation.x, rotation.y, rotation.z, rotation.w);
  if (!positiveFinite(length)) {
    throw new RangeError('Camera rotation must be a finite nonzero quaternion.');
  }

  const x = rotation.x / length;
  const y = rotation.y / length;
  const z = rotation.z / length;
  const w = rotation.w / length;

  // The columns of the quaternion rotation matrix give the camera's world-space axes.
  const right = { x: 1 - 2 * (y * y + z * z), y: 2 * (x * y + z * w), z: 2 * (x * z - y * w) };
  const up = { x: 2 * (x * y - z * w), y: 1 - 2 * (x * x + z * z), z: 2 * (y * z + x * w) };
  const forward = { x: 2 * (x * z + y * w), y: 2 * (y * z - x * w), z: 1 - 2 * (x * x + y * y) };

  const { x: cameraX, y: cameraY, z: cameraZ } = position;
  const pixelsPerUnit = (height / 2) / orthographicSize;
  const centerX = width / 2;
  const centerY = height / 2;

  return (worldPosition) => {
    const dx = worldPosition.x - cameraX;
    const dy = worldPosition.y - cameraY;
    const dz = worldPosition.z - cameraZ;
    return {
      x: centerX + (dx * right.x + dy * right.y + dz * right.z) * pixelsPerUnit,
      y: centerY - (dx * up.x + dy * up.y + dz * up.z) * pixelsPerUnit,
      depth: dx * forward.x + dy * forward.y + dz * forward.z,
    };
  };
}

/** Gives the cropped image's corners in sprite-local world units around the pivot. */
export function spriteLocalQuad(
  { rect, pivot, trim, pixelsPerUnit }: SpriteGeometry,
  { flipX = false, flipY = false }: SpriteFlip = {},
): SpriteQuad<Point2> {
  const { width, height } = trim ?? rect;
  if (![rect.width, rect.height, width, height, pixelsPerUnit].every(positiveFinite)) {
    throw new RangeError('Sprite dimensions and pixels per unit must be positive and finite.');
  }
  const leftPx = (trim?.offset.x ?? 0) - rect.width * pivot.x;
  const bottomPx = (trim?.offset.y ?? 0) - rect.height * pivot.y;
  const scaleX = (flipX ? -1 : 1) / pixelsPerUnit;
  const scaleY = (flipY ? -1 : 1) / pixelsPerUnit;

  const left = leftPx * scaleX;
  const right = (leftPx + width) * scaleX;
  const bottom = bottomPx * scaleY;
  const top = (bottomPx + height) * scaleY;
  return {
    topLeft: { x: left, y: top },
    topRight: { x: right, y: top },
    bottomRight: { x: right, y: bottom },
    bottomLeft: { x: left, y: bottom },
  };
}

/** Projects an XY-plane sprite whose pivot is at the given world position. */
export function projectSpriteQuad(
  project: OrthographicProjection,
  worldPosition: Point3,
  sprite: SpriteGeometry,
  flip?: SpriteFlip,
): SpriteQuad<ScreenPoint> {
  const { topLeft, topRight, bottomRight, bottomLeft } = spriteLocalQuad(sprite, flip);
  const projectCorner = ({ x, y }: Point2) => project({
    x: worldPosition.x + x,
    y: worldPosition.y + y,
    z: worldPosition.z,
  });
  return {
    topLeft: projectCorner(topLeft),
    topRight: projectCorner(topRight),
    bottomRight: projectCorner(bottomRight),
    bottomLeft: projectCorner(bottomLeft),
  };
}
