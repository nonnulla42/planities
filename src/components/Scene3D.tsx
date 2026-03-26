import React, { useRef, useState, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, ContactShadows, Environment, PerspectiveCamera } from '@react-three/drei';
import { ChevronLeft, ChevronRight, Move, Triangle } from 'lucide-react';
import * as THREE from 'three';
import { FloorPlanData, WallSegment, Opening } from '../services/geminiService';

interface Scene3DProps {
  data: FloorPlanData;
  mode: 'orbit' | 'first-person' | 'third-person';
  onReady?: () => void;
}

interface ThirdPersonControlState {
  moveForward: boolean;
  moveBackward: boolean;
  rotateLeft: boolean;
  rotateRight: boolean;
}

interface FirstPersonControlState {
  moveForward: boolean;
  moveLeft: boolean;
  moveRight: boolean;
}

const DEFAULT_WALL_HEIGHT = 2.7;
const CAMERA_WALL_REFERENCE_HEIGHT = 3;
const SCALE_FACTOR = 0.01; // 1 unit = 1 cm = 0.01m
const SCENE_PALETTE = {
  wall: '#F2EEE7',
  wallEdge: '#E8DED0',
  corner: '#F2EEE7',
  floorBase: '#E6DED2',
  skyTop: '#1E293B',
  skyBottom: '#425268',
  windowGlass: '#A9C4DE',
  windowFrame: '#ECE6DA',
  figure: '#F5F3EE',
  figureShade: '#DED7CC',
  figureGlow: '#FFF9F1',
};

const EYE_HEIGHT = 1.7;
const FIRST_PERSON_VERTICAL_LIMIT = Math.PI / 2 - 0.14;
const FIRST_PERSON_TOUCH_LOOK_SENSITIVITY = 0.0032;
const THIRD_PERSON_HEIGHT = 1.7;
const THIRD_PERSON_CAMERA_HEIGHT = 1.06;
const THIRD_PERSON_TARGET_HEIGHT = 1.02;
const THIRD_PERSON_CAMERA_DISTANCE = 1.8;
const THIRD_PERSON_CAMERA_MIN_DISTANCE = 0.95;
const THIRD_PERSON_CAMERA_SHOULDER_OFFSET = 0.18;
const THIRD_PERSON_ROTATION_SPEED = 1.45;
const THIRD_PERSON_ROTATION_DAMPING = 8;
const THIRD_PERSON_MOVE_SPEED = 2.45;
const THIRD_PERSON_ACCELERATION_DAMPING = 7.5;
const THIRD_PERSON_DECELERATION_DAMPING = 5.6;
const THIRD_PERSON_CAMERA_POSITION_DAMPING = 6.4;
const THIRD_PERSON_CAMERA_TARGET_DAMPING = 5.2;
const THIRD_PERSON_BOB_AMPLITUDE = 0.014;
const THIRD_PERSON_BOB_SPEED = 2.2;
const THIRD_PERSON_COLLISION_RADIUS = 0.12;
const WALL_COLLISION_BUFFER = 0.03;
const DOOR_COLLISION_CLEARANCE = 0.16;
const DOOR_PASSAGE_DEPTH = 0.24;
const THIRD_PERSON_TOUCH_DEAD_ZONE = 24;
const THIRD_PERSON_IDLE_CONTROLS: ThirdPersonControlState = {
  moveForward: false,
  moveBackward: false,
  rotateLeft: false,
  rotateRight: false,
};
const FIRST_PERSON_IDLE_CONTROLS: FirstPersonControlState = {
  moveForward: false,
  moveLeft: false,
  moveRight: false,
};

const planToWorldX = (x: number) => x * SCALE_FACTOR;
const planToWorldZ = (y: number) => -y * SCALE_FACTOR;
const planPointToWorld = (point: { x: number; y: number }) => ({
  x: planToWorldX(point.x),
  z: planToWorldZ(point.y),
});

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const damp = (current: number, target: number, smoothing: number, delta: number) =>
  THREE.MathUtils.lerp(current, target, 1 - Math.exp(-smoothing * delta));

const angleLerp = (current: number, target: number, smoothing: number, delta: number) =>
  THREE.MathUtils.lerp(
    current,
    current + THREE.MathUtils.euclideanModulo(target - current + Math.PI, Math.PI * 2) - Math.PI,
    1 - Math.exp(-smoothing * delta),
  );

const resolveThirdPersonTouchControls = (
  deltaX: number,
  deltaY: number,
  deadZone: number,
): ThirdPersonControlState => {
  if (Math.abs(deltaX) < deadZone && Math.abs(deltaY) < deadZone) {
    return THIRD_PERSON_IDLE_CONTROLS;
  }

  if (Math.abs(deltaY) >= Math.abs(deltaX)) {
    return deltaY < 0
      ? { ...THIRD_PERSON_IDLE_CONTROLS, moveForward: true }
      : { ...THIRD_PERSON_IDLE_CONTROLS, moveBackward: true };
  }

  return deltaX < 0
    ? { ...THIRD_PERSON_IDLE_CONTROLS, rotateLeft: true }
    : { ...THIRD_PERSON_IDLE_CONTROLS, rotateRight: true };
};

const distanceToSegment2D = (
  point: THREE.Vector2,
  start: THREE.Vector2,
  end: THREE.Vector2,
) => {
  const segment = new THREE.Vector2().subVectors(end, start);
  const lengthSq = segment.lengthSq();

  if (lengthSq === 0) {
    return {
      distance: point.distanceTo(start),
      closestPoint: start.clone(),
    };
  }

  const t = clamp(new THREE.Vector2().subVectors(point, start).dot(segment) / lengthSq, 0, 1);
  const closestPoint = start.clone().add(segment.multiplyScalar(t));
  return {
    distance: point.distanceTo(closestPoint),
    closestPoint,
  };
};

const resolveWallCollision = (
  nextPosition: THREE.Vector3,
  wallSegments: Array<{ start: THREE.Vector2; end: THREE.Vector2; radius: number }>,
  doorPassages: Array<{
    center: THREE.Vector2;
    tangent: THREE.Vector2;
    normal: THREE.Vector2;
    halfWidth: number;
    halfDepth: number;
  }>,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
) => {
  const corrected = nextPosition.clone();
  const point2D = new THREE.Vector2(corrected.x, corrected.z);
  const isInsideDoorPassage = doorPassages.some((passage) => {
    const local = point2D.clone().sub(passage.center);
    const tangentDistance = Math.abs(local.dot(passage.tangent));
    const normalDistance = Math.abs(local.dot(passage.normal));
    return tangentDistance <= passage.halfWidth && normalDistance <= passage.halfDepth;
  });

  if (isInsideDoorPassage) {
    corrected.x = clamp(corrected.x, bounds.minX + 0.3, bounds.maxX - 0.3);
    corrected.z = clamp(corrected.z, bounds.minZ + 0.3, bounds.maxZ - 0.3);
    return corrected;
  }

  wallSegments.forEach((wall) => {
    const { distance, closestPoint } = distanceToSegment2D(point2D, wall.start, wall.end);
    const minDistance = wall.radius + THIRD_PERSON_COLLISION_RADIUS + WALL_COLLISION_BUFFER;

    if (distance > 0 && distance < minDistance) {
      const push = point2D.clone().sub(closestPoint).normalize().multiplyScalar(minDistance - distance);
      corrected.x += push.x;
      corrected.z += push.y;
      point2D.set(corrected.x, corrected.z);
    }
  });

  corrected.x = clamp(corrected.x, bounds.minX + 0.3, bounds.maxX - 0.3);
  corrected.z = clamp(corrected.z, bounds.minZ + 0.3, bounds.maxZ - 0.3);
  return corrected;
};

const createVerticalToneTexture = (topColor: string, bottomColor: string) => {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, topColor);
    gradient.addColorStop(1, bottomColor);
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
};

const createWallToneTexture = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    const horizontalGradient = context.createLinearGradient(0, 0, canvas.width, 0);
    horizontalGradient.addColorStop(0, '#ede4d8');
    horizontalGradient.addColorStop(0.5, '#f4eee6');
    horizontalGradient.addColorStop(1, '#fbf8f2');
    context.fillStyle = horizontalGradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const verticalGradient = context.createLinearGradient(0, 0, 0, canvas.height);
    verticalGradient.addColorStop(0, 'rgba(255, 255, 255, 0.14)');
    verticalGradient.addColorStop(0.55, 'rgba(255, 255, 255, 0.03)');
    verticalGradient.addColorStop(1, 'rgba(133, 113, 86, 0.08)');
    context.fillStyle = verticalGradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
};

const WALL_TOP_FACE_COLOR = '#655E55';

const createFloorNoiseTexture = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(
      canvas.width / 2,
      canvas.height / 2,
      canvas.width * 0.12,
      canvas.width / 2,
      canvas.height / 2,
      canvas.width * 0.65,
    );
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(1, '#f1ece3');
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < imageData.data.length; i += 4) {
      const value = 248 + Math.round((Math.random() - 0.5) * 4);
      imageData.data[i] = Math.min(255, Math.max(0, imageData.data[i] + value - 248));
      imageData.data[i + 1] = Math.min(255, Math.max(0, imageData.data[i + 1] + value - 248));
      imageData.data[i + 2] = Math.min(255, Math.max(0, imageData.data[i + 2] + value - 248));
      imageData.data[i + 3] = 255;
    }
    context.putImageData(imageData, 0, 0);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(16, 16);
  texture.needsUpdate = true;
  return texture;
};

const getWallOpeningsWithT = (segment: WallSegment, openings: Opening[]) => {
  const { start, end, thickness } = segment;
  const wallThickness = thickness * SCALE_FACTOR;
  const wallStart = planPointToWorld(start);
  const wallEnd = planPointToWorld(end);
  const dx = wallEnd.x - wallStart.x;
  const dz = wallEnd.z - wallStart.z;
  const wallLength = Math.sqrt(dx * dx + dz * dz);

  if (wallLength === 0) {
    return [] as Array<Opening & { t: number }>;
  }

  return openings
    .filter((op) => {
      if (op.wallId && segment.id) {
        return op.wallId === segment.id;
      }

      const opX = op.position.x * SCALE_FACTOR;
      const opZ = planToWorldZ(op.position.y);
      const l2 = dx * dx + dz * dz;
      if (l2 === 0) return false;

      let t = ((opX - wallStart.x) * dx + (opZ - wallStart.z) * dz) / l2;
      t = Math.max(0, Math.min(1, t));
      const dist = Math.sqrt(
        Math.pow(opX - (wallStart.x + t * dx), 2) +
        Math.pow(opZ - (wallStart.z + t * dz), 2),
      );
      return dist < wallThickness * 2;
    })
    .map((op) => {
      if (op.wallId && segment.id && op.offsetAlongWall !== undefined) {
        return { ...op, t: Math.max(0, Math.min(1, op.offsetAlongWall)) };
      }

      const opX = op.position.x * SCALE_FACTOR;
      const opZ = planToWorldZ(op.position.y);
      const t = ((opX - wallStart.x) * dx + (opZ - wallStart.z) * dz) / (dx * dx + dz * dz);
      return { ...op, t: Math.max(0, Math.min(1, t)) };
    })
    .sort((a, b) => a.t - b.t);
};

const getWallCollisionSegments = (segment: WallSegment, openings: Opening[]) => {
  const wallStart = planPointToWorld(segment.start);
  const wallEnd = planPointToWorld(segment.end);
  const wallLength = Math.hypot(wallEnd.x - wallStart.x, wallEnd.z - wallStart.z);

  if (wallLength === 0) {
    return [] as Array<{ start: THREE.Vector2; end: THREE.Vector2; radius: number }>;
  }

  const doorOpenings = getWallOpeningsWithT(segment, openings).filter((opening) => opening.type === 'door');
  const collisionSegments: Array<{ start: THREE.Vector2; end: THREE.Vector2; radius: number }> = [];
  let lastT = 0;

  doorOpenings.forEach((opening) => {
    const openingWidth = opening.width * SCALE_FACTOR;
    const clearanceT = DOOR_COLLISION_CLEARANCE / wallLength;
    const tHalfWidth = openingWidth / wallLength / 2;
    const startT = clamp(opening.t - tHalfWidth - clearanceT, 0, 1);
    const endT = clamp(opening.t + tHalfWidth + clearanceT, 0, 1);

    if (startT > lastT) {
      collisionSegments.push({
        start: new THREE.Vector2(
          THREE.MathUtils.lerp(wallStart.x, wallEnd.x, lastT),
          THREE.MathUtils.lerp(wallStart.z, wallEnd.z, lastT),
        ),
        end: new THREE.Vector2(
          THREE.MathUtils.lerp(wallStart.x, wallEnd.x, startT),
          THREE.MathUtils.lerp(wallStart.z, wallEnd.z, startT),
        ),
        radius: Math.max(segment.thickness * SCALE_FACTOR * 0.5, 0.08),
      });
    }

    lastT = Math.max(lastT, endT);
  });

  if (lastT < 1) {
    collisionSegments.push({
      start: new THREE.Vector2(
        THREE.MathUtils.lerp(wallStart.x, wallEnd.x, lastT),
        THREE.MathUtils.lerp(wallStart.z, wallEnd.z, lastT),
      ),
      end: new THREE.Vector2(wallEnd.x, wallEnd.z),
      radius: Math.max(segment.thickness * SCALE_FACTOR * 0.5, 0.08),
    });
  }

  return collisionSegments.filter((part) => part.start.distanceTo(part.end) > 0.02);
};

const getDoorPassages = (segment: WallSegment, openings: Opening[]) => {
  const wallStart = planPointToWorld(segment.start);
  const wallEnd = planPointToWorld(segment.end);
  const wallVector = new THREE.Vector2(wallEnd.x - wallStart.x, wallEnd.z - wallStart.z);
  const wallLength = wallVector.length();

  if (wallLength === 0) {
    return [] as Array<{
      center: THREE.Vector2;
      tangent: THREE.Vector2;
      normal: THREE.Vector2;
      halfWidth: number;
      halfDepth: number;
    }>;
  }

  const tangent = wallVector.clone().normalize();
  const normal = new THREE.Vector2(-tangent.y, tangent.x);

  return getWallOpeningsWithT(segment, openings)
    .filter((opening) => opening.type === 'door')
    .map((opening) => ({
      center: new THREE.Vector2(
        THREE.MathUtils.lerp(wallStart.x, wallEnd.x, opening.t),
        THREE.MathUtils.lerp(wallStart.z, wallEnd.z, opening.t),
      ),
      tangent: tangent.clone(),
      normal: normal.clone(),
      halfWidth: opening.width * SCALE_FACTOR * 0.5 + THIRD_PERSON_COLLISION_RADIUS + 0.04,
      halfDepth: Math.max(segment.thickness * SCALE_FACTOR * 0.5 + DOOR_PASSAGE_DEPTH, 0.22),
    }));
};

const WallBlock = ({
  position,
  args,
  color = SCENE_PALETTE.wall,
  topColor,
  map,
}: {
  position: [number, number, number];
  args: [number, number, number];
  color?: string;
  topColor: string;
  map?: THREE.Texture;
}) => (
  <mesh position={position} castShadow receiveShadow>
    <boxGeometry args={args} />
    <meshStandardMaterial attach="material-0" color={color} map={map} roughness={0.95} metalness={0} />
    <meshStandardMaterial attach="material-1" color={color} map={map} roughness={0.95} metalness={0} />
    <meshStandardMaterial attach="material-2" color={topColor} map={map} roughness={0.95} metalness={0} />
    <meshStandardMaterial attach="material-3" color={color} map={map} roughness={0.95} metalness={0} />
    <meshStandardMaterial attach="material-4" color={color} map={map} roughness={0.95} metalness={0} />
    <meshStandardMaterial attach="material-5" color={color} map={map} roughness={0.95} metalness={0} />
  </mesh>
);

const Wall = ({
  segment,
  openings,
  wallColor,
}: {
  segment: WallSegment;
  openings: Opening[];
  wallColor: string;
}) => {
  const { start, end, thickness } = segment;
  const wallThickness = thickness * SCALE_FACTOR;
  const wallStart = planPointToWorld(start);
  const wallEnd = planPointToWorld(end);
  
  // Calculate wall vector and length
  const dx = wallEnd.x - wallStart.x;
  const dz = wallEnd.z - wallStart.z;
  const wallLength = Math.sqrt(dx * dx + dz * dz);
  const angle = Math.atan2(dz, dx);
  const wallToneMap = React.useMemo(() => createWallToneTexture(), []);
  const wallTopColor = WALL_TOP_FACE_COLOR;
  
  // Find openings that belong to this wall
  // We check if the opening position is close to the wall line segment
  const wallOpenings = getWallOpeningsWithT(segment, openings);

  const segments: React.ReactNode[] = [];
  let lastT = 0;

  wallOpenings.forEach((op, i) => {
    const opWidth = op.width * SCALE_FACTOR;
    const opTWidth = opWidth / wallLength;
    const startT = Math.max(0, op.t - opTWidth / 2);
    const endT = Math.min(1, op.t + opTWidth / 2);

    // 1. Wall segment before opening
    if (startT > lastT) {
      const segLen = (startT - lastT) * wallLength;
      const segCenterX = (lastT + startT) / 2;
      segments.push(
        <WallBlock
          key={`seg-before-${i}`}
          position={[segCenterX * wallLength, DEFAULT_WALL_HEIGHT / 2, 0]}
          args={[segLen, DEFAULT_WALL_HEIGHT, wallThickness]}
          color={wallColor}
          topColor={wallTopColor}
          map={wallToneMap}
        />
      );
    }

    // 2. Segments around opening
    const opLen = (endT - startT) * wallLength;
    const opCenterX = (startT + endT) / 2;
    
    if (op.type === 'door') {
      // Top part above door (usually 2.1m high door)
      const doorHeight = 2.1;
      const topPartHeight = DEFAULT_WALL_HEIGHT - doorHeight;
      segments.push(
        <WallBlock
          key={`door-top-${i}`}
          position={[opCenterX * wallLength, doorHeight + topPartHeight / 2, 0]}
          args={[opLen, topPartHeight, wallThickness]}
          color={wallColor}
          topColor={wallTopColor}
          map={wallToneMap}
        />
      );
    } else {
      const isFloorWindow = op.type === 'window-floor';
      const winBottom = isFloorWindow ? 0 : 0.9;
      const winHeight = isFloorWindow ? 2.1 : 1.2;
      const winTop = winBottom + winHeight;
      const frameThickness = wallThickness * 0.3;

      if (!isFloorWindow) {
        segments.push(
          <WallBlock
            key={`win-bottom-${i}`}
            position={[opCenterX * wallLength, winBottom / 2, 0]}
            args={[opLen, winBottom, wallThickness]}
            color={wallColor}
            topColor={wallTopColor}
            map={wallToneMap}
          />
        );
      }

      const topPartHeight = DEFAULT_WALL_HEIGHT - winTop;
      if (topPartHeight > 0.01) {
        segments.push(
          <WallBlock
            key={`win-top-${i}`}
            position={[opCenterX * wallLength, winTop + topPartHeight / 2, 0]}
            args={[opLen, topPartHeight, wallThickness]}
            color={wallColor}
            topColor={wallTopColor}
            map={wallToneMap}
          />
        );
      }

      segments.push(
        <group key={`win-visual-${i}`} position={[opCenterX * wallLength, winBottom + winHeight / 2, 0]}>
          <mesh>
            <boxGeometry args={[opLen, winHeight, wallThickness * 0.2]} />
            <meshStandardMaterial color={SCENE_PALETTE.windowGlass} transparent opacity={0.38} />
          </mesh>
          <mesh>
            <boxGeometry args={[opLen, 0.05, frameThickness]} />
            <meshStandardMaterial color={SCENE_PALETTE.windowFrame} />
          </mesh>
          <mesh>
            <boxGeometry args={[0.05, winHeight, frameThickness]} />
            <meshStandardMaterial color={SCENE_PALETTE.windowFrame} />
          </mesh>
          {isFloorWindow && (
            <mesh position={[0, -winHeight / 2 + 0.035, 0]}>
              <boxGeometry args={[opLen, 0.05, frameThickness]} />
              <meshStandardMaterial color={SCENE_PALETTE.windowFrame} />
            </mesh>
          )}
        </group>
      );
    }

    lastT = endT;
  });

  // Final wall segment
  if (lastT < 1) {
    const segLen = (1 - lastT) * wallLength;
    const segCenterX = (lastT + 1) / 2;
    segments.push(
      <WallBlock
        key="seg-final"
        position={[segCenterX * wallLength, DEFAULT_WALL_HEIGHT / 2, 0]}
        args={[segLen, DEFAULT_WALL_HEIGHT, wallThickness]}
        color={wallColor}
        topColor={wallTopColor}
        map={wallToneMap}
      />
    );
  }

  return (
    <group position={[wallStart.x, 0, wallStart.z]} rotation={[0, -angle, 0]}>
      {segments}
    </group>
  );
};

const Corner3D = ({ position, thickness }: { position: { x: number, y: number }, thickness: number }) => {
  const radius = (thickness / 2) * SCALE_FACTOR;
  const worldPosition = planPointToWorld(position);
  const topColor = WALL_TOP_FACE_COLOR;
  return (
    <mesh position={[worldPosition.x, DEFAULT_WALL_HEIGHT / 2, worldPosition.z]} castShadow receiveShadow>
      <cylinderGeometry args={[radius, radius, DEFAULT_WALL_HEIGHT, 16]} />
      <meshStandardMaterial attach="material-0" color={SCENE_PALETTE.corner} roughness={0.98} metalness={0} />
      <meshStandardMaterial attach="material-1" color={topColor} roughness={0.98} metalness={0} />
      <meshStandardMaterial attach="material-2" color={SCENE_PALETTE.corner} roughness={0.98} metalness={0} />
    </mesh>
  );
};

const Opening3D = ({ opening: _opening }: { opening: Opening }) => {
  // We don't need to render anything here anymore as Wall handles its own openings
  // unless we want to add specific door models later
  return null;
};

const CameraSetup = ({
  mode,
  sceneSpan,
  setIsLocked,
}: {
  mode: 'orbit' | 'first-person' | 'third-person';
  sceneSpan: number;
  setIsLocked: (value: boolean) => void;
}) => {
  const { camera, size, invalidate } = useThree();

  useEffect(() => {
    if (size.width === 0 || size.height === 0) {
      return;
    }

    const focusPoint = new THREE.Vector3(0, CAMERA_WALL_REFERENCE_HEIGHT * 0.4, 0);
    const orbitDistance = Math.max(sceneSpan * 1.15, 10);

    camera.up.set(0, 1, 0);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.aspect = size.width / size.height;
    }

    if (mode === 'orbit') {
      camera.position.set(0, Math.max(sceneSpan * 0.75, 7), orbitDistance);
      camera.lookAt(focusPoint);
      setIsLocked(false);
      if (document.pointerLockElement) {
        document.exitPointerLock();
      }
    } else if (mode === 'first-person') {
      camera.position.set(0, EYE_HEIGHT, Math.max(sceneSpan * 0.6, 4));
      camera.lookAt(new THREE.Vector3(0, EYE_HEIGHT, 0));
    } else {
      camera.position.set(0, THIRD_PERSON_CAMERA_HEIGHT, Math.max(sceneSpan * 0.5, 3.2));
      camera.lookAt(new THREE.Vector3(0, THIRD_PERSON_TARGET_HEIGHT, 0));
      setIsLocked(false);
      if (document.pointerLockElement) {
        document.exitPointerLock();
      }
    }

    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, invalidate, mode, sceneSpan, setIsLocked, size.height, size.width]);

  return null;
};

const Player = ({
  isLocked,
  mobileControls,
  mobileLookDeltaRef,
}: {
  isLocked: boolean;
  mobileControls: FirstPersonControlState;
  mobileLookDeltaRef: React.MutableRefObject<{ deltaX: number; deltaY: number }>;
}) => {
  const { camera } = useThree();
  const velocity = useRef(new THREE.Vector3());
  const direction = useRef(new THREE.Vector3());
  const moveForward = useRef(false);
  const moveBackward = useRef(false);
  const moveLeft = useRef(false);
  const moveRight = useRef(false);
  const euler = useRef(new THREE.Euler(0, 0, 0, 'YXZ'));

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isLocked) return;
      switch (e.code) {
        case 'ArrowUp':
        case 'KeyW': moveForward.current = true; break;
        case 'ArrowLeft':
        case 'KeyA': moveLeft.current = true; break;
        case 'ArrowDown':
        case 'KeyS': moveBackward.current = true; break;
        case 'ArrowRight':
        case 'KeyD': moveRight.current = true; break;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      switch (e.code) {
        case 'ArrowUp':
        case 'KeyW': moveForward.current = false; break;
        case 'ArrowLeft':
        case 'KeyA': moveLeft.current = false; break;
        case 'ArrowDown':
        case 'KeyS': moveBackward.current = false; break;
        case 'ArrowRight':
        case 'KeyD': moveRight.current = false; break;
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isLocked) return;

      const movementX = e.movementX || 0;
      const movementY = e.movementY || 0;

      euler.current.setFromQuaternion(camera.quaternion);

      euler.current.y -= movementX * 0.002;
      // Standard Y: movementY > 0 means mouse down, we want to look DOWN (euler.x decreases)
      euler.current.x -= movementY * 0.002; 

      euler.current.x = Math.max(-FIRST_PERSON_VERTICAL_LIMIT, Math.min(FIRST_PERSON_VERTICAL_LIMIT, euler.current.x));

      camera.quaternion.setFromEuler(euler.current);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousemove', onMouseMove);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, [isLocked, camera]);

  useEffect(() => {
    euler.current.setFromQuaternion(camera.quaternion);
  }, [camera, isLocked]);

  useFrame((_state, delta) => {
    if (!isLocked) return;

    const { deltaX, deltaY } = mobileLookDeltaRef.current;
    if (deltaX !== 0 || deltaY !== 0) {
      euler.current.setFromQuaternion(camera.quaternion);
      euler.current.y -= deltaX * FIRST_PERSON_TOUCH_LOOK_SENSITIVITY;
      euler.current.x -= deltaY * FIRST_PERSON_TOUCH_LOOK_SENSITIVITY;
      euler.current.x = Math.max(-FIRST_PERSON_VERTICAL_LIMIT, Math.min(FIRST_PERSON_VERTICAL_LIMIT, euler.current.x));
      camera.quaternion.setFromEuler(euler.current);
      mobileLookDeltaRef.current.deltaX = 0;
      mobileLookDeltaRef.current.deltaY = 0;
    }
    
    // Reset velocity if no keys pressed
    const forwardActive = moveForward.current || mobileControls.moveForward;
    const backwardActive = moveBackward.current;
    const leftActive = moveLeft.current || mobileControls.moveLeft;
    const rightActive = moveRight.current || mobileControls.moveRight;

    if (!forwardActive && !backwardActive && !leftActive && !rightActive) {
      velocity.current.set(0, 0, 0);
    } else {
      // W is forward, S is backward. In Three.js, -Z is forward.
      direction.current.z = Number(backwardActive) - Number(forwardActive);
      direction.current.x = Number(rightActive) - Number(leftActive);
      direction.current.normalize();

      const speed = 5;
      velocity.current.z = direction.current.z * speed * delta;
      velocity.current.x = direction.current.x * speed * delta;

      camera.translateX(velocity.current.x);
      camera.translateZ(velocity.current.z);
    }

    camera.position.y = EYE_HEIGHT;
  });

  return null;
};

const ControlsHandler = ({ setIsLocked }: { setIsLocked: (v: boolean) => void }) => {
  const { gl } = useThree();

  useEffect(() => {
    const handleLockChange = () => {
      setIsLocked(document.pointerLockElement === gl.domElement);
    };
    document.addEventListener('pointerlockchange', handleLockChange);
    return () => document.removeEventListener('pointerlockchange', handleLockChange);
  }, [gl, setIsLocked]);

  return null;
};

const SceneReadyNotifier = ({ onReady }: { onReady?: () => void }) => {
  const { gl, size, invalidate, scene, camera } = useThree();
  const hasNotified = useRef(false);

  useEffect(() => {
    if (!onReady || hasNotified.current || size.width === 0 || size.height === 0) {
      return;
    }

    let frameA = 0;
    let frameB = 0;

    frameA = window.requestAnimationFrame(() => {
      invalidate();
      frameB = window.requestAnimationFrame(() => {
        if (
          !gl.domElement ||
          gl.domElement.width === 0 ||
          gl.domElement.height === 0 ||
          scene.children.length === 0
        ) {
          return;
        }

        gl.render(scene, camera);
        hasNotified.current = true;
        onReady();
      });
    });

    return () => {
      window.cancelAnimationFrame(frameA);
      window.cancelAnimationFrame(frameB);
    };
  }, [camera, gl, invalidate, onReady, scene, size.height, size.width]);

  return null;
};

const ThirdPersonWalker = ({
  active,
  mobileControls,
  wallSegments,
  doorPassages,
  bounds,
}: {
  active: boolean;
  mobileControls: ThirdPersonControlState;
  wallSegments: Array<{ start: THREE.Vector2; end: THREE.Vector2; radius: number }>;
  doorPassages: Array<{
    center: THREE.Vector2;
    tangent: THREE.Vector2;
    normal: THREE.Vector2;
    halfWidth: number;
    halfDepth: number;
  }>;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}) => {
  const { camera, scene } = useThree();
  const root = useRef<THREE.Group>(null);
  const bodyMaterial = useRef<THREE.MeshStandardMaterial>(null);
  const shoulderMaterial = useRef<THREE.MeshStandardMaterial>(null);
  const torsoMaterial = useRef<THREE.MeshStandardMaterial>(null);
  const tailMaterial = useRef<THREE.MeshStandardMaterial>(null);
  const shadowMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const position = useRef(new THREE.Vector3(0, 0, 0));
  const yaw = useRef(0);
  const visualYaw = useRef(0);
  const currentSpeed = useRef(0);
  const moveForward = useRef(false);
  const moveBackward = useRef(false);
  const rotateLeft = useRef(false);
  const rotateRight = useRef(false);
  const desiredCamera = useRef(new THREE.Vector3(0, THIRD_PERSON_CAMERA_HEIGHT, THIRD_PERSON_CAMERA_DISTANCE));
  const smoothedCamera = useRef(new THREE.Vector3(0, THIRD_PERSON_CAMERA_HEIGHT, THIRD_PERSON_CAMERA_DISTANCE));
  const cameraTarget = useRef(new THREE.Vector3());
  const smoothedCameraTarget = useRef(new THREE.Vector3(0, THIRD_PERSON_TARGET_HEIGHT, 0));
  const bobWeight = useRef(0);
  const raycaster = useRef(new THREE.Raycaster());
  const cameraDirection = useRef(new THREE.Vector3());
  const desiredOpacity = useRef(0.88);
  const resolvedCameraDistance = useRef(THIRD_PERSON_CAMERA_DISTANCE);

  useEffect(() => {
    if (!active) {
      moveForward.current = false;
      moveBackward.current = false;
      rotateLeft.current = false;
      rotateRight.current = false;
      desiredOpacity.current = 0.88;
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      switch (event.code) {
        case 'ArrowUp':
        case 'KeyW':
          moveForward.current = true;
          break;
        case 'ArrowDown':
        case 'KeyS':
          moveBackward.current = true;
          break;
        case 'ArrowLeft':
        case 'KeyA':
          rotateLeft.current = true;
          break;
        case 'ArrowRight':
        case 'KeyD':
          rotateRight.current = true;
          break;
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      switch (event.code) {
        case 'ArrowUp':
        case 'KeyW':
          moveForward.current = false;
          break;
        case 'ArrowDown':
        case 'KeyS':
          moveBackward.current = false;
          break;
        case 'ArrowLeft':
        case 'KeyA':
          rotateLeft.current = false;
          break;
        case 'ArrowRight':
        case 'KeyD':
          rotateRight.current = false;
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [active]);

  useEffect(() => {
    if (!active) {
      return;
    }

    position.current.set(0, 0, 0);
    yaw.current = 0;
    visualYaw.current = 0;
    currentSpeed.current = 0;
    resolvedCameraDistance.current = THIRD_PERSON_CAMERA_DISTANCE;
    smoothedCameraTarget.current.set(0, THIRD_PERSON_TARGET_HEIGHT, 0);
    smoothedCamera.current.set(0, THIRD_PERSON_CAMERA_HEIGHT, THIRD_PERSON_CAMERA_DISTANCE);
    camera.position.set(0, THIRD_PERSON_CAMERA_HEIGHT, THIRD_PERSON_CAMERA_DISTANCE);
    camera.lookAt(0, THIRD_PERSON_TARGET_HEIGHT, 0);
  }, [active, camera]);

  useFrame((state, delta) => {
    if (!active || !root.current) {
      return;
    }

    const rotationInput =
      Number(rotateLeft.current || mobileControls.rotateLeft) -
      Number(rotateRight.current || mobileControls.rotateRight);
    yaw.current += rotationInput * THIRD_PERSON_ROTATION_SPEED * delta;
    visualYaw.current = angleLerp(visualYaw.current, yaw.current, THIRD_PERSON_ROTATION_DAMPING, delta);

    const moveInput =
      Number(moveForward.current || mobileControls.moveForward) -
      Number(moveBackward.current || mobileControls.moveBackward);
    const targetSpeed = moveInput * THIRD_PERSON_MOVE_SPEED;
    const speedDamping =
      moveInput === 0 ? THIRD_PERSON_DECELERATION_DAMPING : THIRD_PERSON_ACCELERATION_DAMPING;
    currentSpeed.current = damp(currentSpeed.current, targetSpeed, speedDamping, delta);

    const forward = new THREE.Vector3(-Math.sin(visualYaw.current), 0, -Math.cos(visualYaw.current));
    const candidate = position.current.clone().addScaledVector(forward, currentSpeed.current * delta);
    position.current.copy(resolveWallCollision(candidate, wallSegments, doorPassages, bounds));

    bobWeight.current = damp(bobWeight.current, Math.abs(currentSpeed.current) < 0.05 ? 0.08 : 0.72, 4.2, delta);
    const bob = Math.sin(state.clock.elapsedTime * THIRD_PERSON_BOB_SPEED) * THIRD_PERSON_BOB_AMPLITUDE * bobWeight.current;

    root.current.position.set(position.current.x, bob, position.current.z);
    root.current.rotation.y = angleLerp(root.current.rotation.y, visualYaw.current, THIRD_PERSON_ROTATION_DAMPING, delta);

    cameraTarget.current.set(position.current.x, THIRD_PERSON_TARGET_HEIGHT + bob * 0.35, position.current.z);
    smoothedCameraTarget.current.x = damp(
      smoothedCameraTarget.current.x,
      cameraTarget.current.x,
      THIRD_PERSON_CAMERA_TARGET_DAMPING,
      delta,
    );
    smoothedCameraTarget.current.y = damp(
      smoothedCameraTarget.current.y,
      cameraTarget.current.y,
      THIRD_PERSON_CAMERA_TARGET_DAMPING,
      delta,
    );
    smoothedCameraTarget.current.z = damp(
      smoothedCameraTarget.current.z,
      cameraTarget.current.z,
      THIRD_PERSON_CAMERA_TARGET_DAMPING,
      delta,
    );

    const offset = new THREE.Vector3(THIRD_PERSON_CAMERA_SHOULDER_OFFSET, THIRD_PERSON_CAMERA_HEIGHT, THIRD_PERSON_CAMERA_DISTANCE)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), visualYaw.current);
    const intendedCamera = cameraTarget.current.clone().add(offset);
    cameraDirection.current.copy(intendedCamera).sub(cameraTarget.current);
    const fullDistance = cameraDirection.current.length();

    if (fullDistance > 0.001) {
      cameraDirection.current.normalize();
    }

    let resolvedDistance = fullDistance;
    if (fullDistance > 0.001) {
      raycaster.current.set(cameraTarget.current, cameraDirection.current);
      const intersections = raycaster.current.intersectObjects(scene.children, true);
      const blocker = intersections.find((hit) => {
        let current: THREE.Object3D | null = hit.object;
        while (current) {
          if (current === root.current) {
            return false;
          }
          current = current.parent;
        }
        return hit.distance > 0.12;
      });

      if (blocker) {
        resolvedDistance = clamp(blocker.distance - 0.18, THIRD_PERSON_CAMERA_MIN_DISTANCE, fullDistance);
      }
    }

    resolvedCameraDistance.current = damp(resolvedCameraDistance.current, resolvedDistance, 8.5, delta);
    desiredCamera.current.copy(smoothedCameraTarget.current).addScaledVector(cameraDirection.current, resolvedCameraDistance.current);
    smoothedCamera.current.x = damp(
      smoothedCamera.current.x,
      desiredCamera.current.x,
      THIRD_PERSON_CAMERA_POSITION_DAMPING,
      delta,
    );
    smoothedCamera.current.y = damp(
      smoothedCamera.current.y,
      desiredCamera.current.y,
      THIRD_PERSON_CAMERA_POSITION_DAMPING,
      delta,
    );
    smoothedCamera.current.z = damp(
      smoothedCamera.current.z,
      desiredCamera.current.z,
      THIRD_PERSON_CAMERA_POSITION_DAMPING,
      delta,
    );
    camera.position.copy(smoothedCamera.current);
    camera.lookAt(smoothedCameraTarget.current);

    desiredOpacity.current = resolvedDistance < 1.15 ? 0.38 : 0.88;
    if (bodyMaterial.current) {
      bodyMaterial.current.opacity = damp(bodyMaterial.current.opacity, desiredOpacity.current, 10, delta);
    }
    if (shoulderMaterial.current) {
      shoulderMaterial.current.opacity = damp(shoulderMaterial.current.opacity, desiredOpacity.current, 10, delta);
    }
    if (torsoMaterial.current) {
      torsoMaterial.current.opacity = damp(torsoMaterial.current.opacity, desiredOpacity.current, 10, delta);
    }
    if (tailMaterial.current) {
      tailMaterial.current.opacity = damp(tailMaterial.current.opacity, desiredOpacity.current * 0.9, 10, delta);
    }
    if (shadowMaterial.current) {
      shadowMaterial.current.opacity = damp(
        shadowMaterial.current.opacity,
        Math.abs(currentSpeed.current) < 0.05 ? 0.055 : 0.085,
        6,
        delta,
      );
    }
  });

  return (
    <group ref={root} visible={active}>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
        <circleGeometry args={[0.2, 40]} />
        <meshBasicMaterial
          ref={shadowMaterial}
          color="#20160B"
          transparent
          opacity={0.06}
          depthWrite={false}
        />
      </mesh>

      <group position={[0, 0.06, 0]}>
        <mesh position={[0, 1.44, 0]} scale={[0.82, 1.04, 0.82]} castShadow>
          <sphereGeometry args={[0.125, 30, 30]} />
          <meshStandardMaterial
            ref={bodyMaterial}
            color={SCENE_PALETTE.figure}
            emissive={SCENE_PALETTE.figureGlow}
            emissiveIntensity={0.05}
            roughness={1}
            metalness={0}
            transparent
            opacity={0.88}
          />
        </mesh>

        <mesh position={[0, 1.235, 0]} castShadow>
          <cylinderGeometry args={[0.038, 0.045, 0.06, 18]} />
          <meshStandardMaterial
            color={SCENE_PALETTE.figureShade}
            roughness={1}
            metalness={0}
            transparent
            opacity={0.56}
          />
        </mesh>

        <mesh position={[0, 1.02, 0]} scale={[1.02, 0.86, 0.9]} castShadow>
          <capsuleGeometry args={[0.155, 0.36, 8, 18]} />
          <meshStandardMaterial
            ref={shoulderMaterial}
            color={SCENE_PALETTE.figure}
            emissive={SCENE_PALETTE.figureGlow}
            emissiveIntensity={0.04}
            roughness={0.99}
            metalness={0}
            transparent
            opacity={0.88}
          />
        </mesh>

        <mesh position={[0, 0.72, 0]} scale={[0.86, 1.12, 0.88]} castShadow>
          <capsuleGeometry args={[0.19, 0.42, 8, 18]} />
          <meshStandardMaterial
            ref={torsoMaterial}
            color={SCENE_PALETTE.figure}
            emissive={SCENE_PALETTE.figureGlow}
            emissiveIntensity={0.04}
            roughness={0.99}
            metalness={0}
            transparent
            opacity={0.88}
          />
        </mesh>

        <mesh position={[0, 0.38, 0]} scale={[0.8, 1, 0.8]} castShadow>
          <cylinderGeometry args={[0.12, 0.08, 0.26, 24]} />
          <meshStandardMaterial
            ref={tailMaterial}
            color={SCENE_PALETTE.figureShade}
            roughness={1}
            metalness={0}
            transparent
            opacity={0.48}
          />
        </mesh>
      </group>
    </group>
  );
};

export const Scene3D: React.FC<Scene3DProps> = ({ data, mode, onReady }) => {
  const [isLocked, setIsLocked] = useState(false);
  const [isCanvasMounted, setIsCanvasMounted] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [firstPersonTouchControls, setFirstPersonTouchControls] = useState<FirstPersonControlState>(FIRST_PERSON_IDLE_CONTROLS);
  const [thirdPersonTouchControls, setThirdPersonTouchControls] = useState<ThirdPersonControlState>(THIRD_PERSON_IDLE_CONTROLS);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasElementRef = useRef<HTMLCanvasElement | null>(null);
  const firstPersonLookDeltaRef = useRef({ deltaX: 0, deltaY: 0 });
  const firstPersonLookTouchRef = useRef<{ identifier: number; lastX: number; lastY: number } | null>(null);
  const thirdPersonTouchRef = useRef<{ identifier: number; startX: number; startY: number } | null>(null);
  const floorNoiseMap = React.useMemo(() => createFloorNoiseTexture(), []);

  // Gradient background texture
  const backgroundTexture = React.useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    if (context) {
      const gradient = context.createLinearGradient(0, 0, 0, 512);
      gradient.addColorStop(0, SCENE_PALETTE.skyTop);
      gradient.addColorStop(1, SCENE_PALETTE.skyBottom);
      context.fillStyle = gradient;
      context.fillRect(0, 0, 2, 512);
    }
    const texture = new THREE.CanvasTexture(canvas);
    return texture;
  }, []);
  
  const sceneMetrics = React.useMemo(() => {
    if (data.walls.length === 0) {
      return { avgX: 0, avgZ: 0, span: 10, minX: -5, maxX: 5, minZ: -5, maxZ: 5 };
    }

    const avgPlanX = data.walls.reduce((acc, w) => acc + (w.start.x + w.end.x) / 2, 0) / data.walls.length;
    const avgPlanY = data.walls.reduce((acc, w) => acc + (w.start.y + w.end.y) / 2, 0) / data.walls.length;

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;

    data.walls.forEach((wall) => {
      const startWorld = planPointToWorld(wall.start);
      const endWorld = planPointToWorld(wall.end);
      minX = Math.min(minX, startWorld.x, endWorld.x);
      maxX = Math.max(maxX, startWorld.x, endWorld.x);
      minZ = Math.min(minZ, startWorld.z, endWorld.z);
      maxZ = Math.max(maxZ, startWorld.z, endWorld.z);
    });

    return {
      avgX: planToWorldX(avgPlanX),
      avgZ: planToWorldZ(avgPlanY),
      span: Math.max(maxX - minX, maxZ - minZ, 4),
      minX,
      maxX,
      minZ,
      maxZ,
    };
  }, [data.walls]);

  const centeredWallSegments = React.useMemo(
    () =>
      data.walls.flatMap((wall) =>
        getWallCollisionSegments(wall, data.openings).map((part) => ({
          start: new THREE.Vector2(part.start.x - sceneMetrics.avgX, part.start.y - sceneMetrics.avgZ),
          end: new THREE.Vector2(part.end.x - sceneMetrics.avgX, part.end.y - sceneMetrics.avgZ),
          radius: part.radius,
        })),
      ),
    [data.openings, data.walls, sceneMetrics.avgX, sceneMetrics.avgZ],
  );

  const centeredDoorPassages = React.useMemo(
    () =>
      data.walls.flatMap((wall) =>
        getDoorPassages(wall, data.openings).map((passage) => ({
          center: new THREE.Vector2(passage.center.x - sceneMetrics.avgX, passage.center.y - sceneMetrics.avgZ),
          tangent: passage.tangent.clone(),
          normal: passage.normal.clone(),
          halfWidth: passage.halfWidth,
          halfDepth: passage.halfDepth,
        })),
      ),
    [data.openings, data.walls, sceneMetrics.avgX, sceneMetrics.avgZ],
  );

  const centeredBounds = React.useMemo(
    () => ({
      minX: sceneMetrics.minX - sceneMetrics.avgX,
      maxX: sceneMetrics.maxX - sceneMetrics.avgX,
      minZ: sceneMetrics.minZ - sceneMetrics.avgZ,
      maxZ: sceneMetrics.maxZ - sceneMetrics.avgZ,
    }),
    [sceneMetrics.avgX, sceneMetrics.avgZ, sceneMetrics.maxX, sceneMetrics.maxZ, sceneMetrics.minX, sceneMetrics.minZ],
  );

  const requestLock = () => {
    canvasElementRef.current?.requestPointerLock();
  };

  useEffect(() => {
    const updateTouchCapability = () => {
      setIsTouchDevice(window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0);
    };

    updateTouchCapability();
    window.addEventListener('resize', updateTouchCapability);
    return () => window.removeEventListener('resize', updateTouchCapability);
  }, []);

  useEffect(() => {
    if (mode !== 'first-person') {
      firstPersonLookTouchRef.current = null;
      firstPersonLookDeltaRef.current.deltaX = 0;
      firstPersonLookDeltaRef.current.deltaY = 0;
      setFirstPersonTouchControls(FIRST_PERSON_IDLE_CONTROLS);
    }
  }, [mode]);

  useEffect(() => {
    if (mode === 'third-person') {
      return;
    }

    thirdPersonTouchRef.current = null;
    setThirdPersonTouchControls(THIRD_PERSON_IDLE_CONTROLS);
  }, [mode]);

  const stopThirdPersonTouchControls = React.useCallback(() => {
    thirdPersonTouchRef.current = null;
    setThirdPersonTouchControls(THIRD_PERSON_IDLE_CONTROLS);
  }, []);

  const setFirstPersonTouchControl = React.useCallback(
    (control: keyof FirstPersonControlState, active: boolean) => {
      setFirstPersonTouchControls((current) => {
        if (current[control] === active) {
          return current;
        }

        return { ...current, [control]: active };
      });
    },
    [],
  );

  const stopFirstPersonLook = React.useCallback(() => {
    firstPersonLookTouchRef.current = null;
    firstPersonLookDeltaRef.current.deltaX = 0;
    firstPersonLookDeltaRef.current.deltaY = 0;
  }, []);

  const handleFirstPersonLookStart = React.useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (!isTouchDevice || mode !== 'first-person' || firstPersonLookTouchRef.current) {
      return;
    }

    const touch = event.changedTouches[0];
    if (!touch) {
      return;
    }

    firstPersonLookTouchRef.current = {
      identifier: touch.identifier,
      lastX: touch.clientX,
      lastY: touch.clientY,
    };
    firstPersonLookDeltaRef.current.deltaX = 0;
    firstPersonLookDeltaRef.current.deltaY = 0;
    event.preventDefault();
  }, [isTouchDevice, mode]);

  const handleFirstPersonLookMove = React.useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    const activeTouch = firstPersonLookTouchRef.current;
    if (!activeTouch || !isTouchDevice || mode !== 'first-person') {
      return;
    }

    const touch = Array.from(event.changedTouches).find(({ identifier }) => identifier === activeTouch.identifier);
    if (!touch) {
      return;
    }

    firstPersonLookDeltaRef.current.deltaX += touch.clientX - activeTouch.lastX;
    firstPersonLookDeltaRef.current.deltaY += touch.clientY - activeTouch.lastY;
    activeTouch.lastX = touch.clientX;
    activeTouch.lastY = touch.clientY;
    event.preventDefault();
  }, [isTouchDevice, mode]);

  const handleFirstPersonLookEnd = React.useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    const activeTouch = firstPersonLookTouchRef.current;
    if (!activeTouch) {
      return;
    }

    const hasTrackedTouchEnded = Array.from(event.changedTouches).some(
      ({ identifier }) => identifier === activeTouch.identifier,
    );

    if (hasTrackedTouchEnded) {
      stopFirstPersonLook();
      event.preventDefault();
    }
  }, [stopFirstPersonLook]);

  const handleThirdPersonTouchStart = React.useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (!isTouchDevice || mode !== 'third-person' || thirdPersonTouchRef.current) {
      return;
    }

    const touch = event.changedTouches[0];
    if (!touch) {
      return;
    }

    thirdPersonTouchRef.current = {
      identifier: touch.identifier,
      startX: touch.clientX,
      startY: touch.clientY,
    };
    setThirdPersonTouchControls(THIRD_PERSON_IDLE_CONTROLS);
    event.preventDefault();
  }, [isTouchDevice, mode]);

  const handleThirdPersonTouchMove = React.useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    const activeTouch = thirdPersonTouchRef.current;
    if (!activeTouch || !isTouchDevice || mode !== 'third-person') {
      return;
    }

    const touch = Array.from(event.changedTouches).find(({ identifier }) => identifier === activeTouch.identifier);
    if (!touch) {
      return;
    }

    setThirdPersonTouchControls(
      resolveThirdPersonTouchControls(
        touch.clientX - activeTouch.startX,
        touch.clientY - activeTouch.startY,
        THIRD_PERSON_TOUCH_DEAD_ZONE,
      ),
    );
    event.preventDefault();
  }, [isTouchDevice, mode]);

  const handleThirdPersonTouchEnd = React.useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    const activeTouch = thirdPersonTouchRef.current;
    if (!activeTouch) {
      return;
    }

    const hasTrackedTouchEnded = Array.from(event.changedTouches).some(
      ({ identifier }) => identifier === activeTouch.identifier,
    );

    if (hasTrackedTouchEnded) {
      stopThirdPersonTouchControls();
      event.preventDefault();
    }
  }, [stopThirdPersonTouchControls]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let frameA = 0;
    let frameB = 0;
    let cancelled = false;

    const commitMount = () => {
      if (cancelled) {
        return;
      }

      const { width, height } = container.getBoundingClientRect();
      if (width > 0 && height > 0) {
        setIsCanvasMounted(true);
      }
    };

    const scheduleMount = () => {
      window.cancelAnimationFrame(frameA);
      window.cancelAnimationFrame(frameB);

      const { width, height } = container.getBoundingClientRect();
      if (width === 0 || height === 0) {
        setIsCanvasMounted(false);
        return;
      }

      frameA = window.requestAnimationFrame(() => {
        frameB = window.requestAnimationFrame(commitMount);
      });
    };

    scheduleMount();

    const observer = new ResizeObserver(() => {
      scheduleMount();
    });
    observer.observe(container);

    return () => {
      cancelled = true;
      observer.disconnect();
      window.cancelAnimationFrame(frameA);
      window.cancelAnimationFrame(frameB);
    };
  }, [data, mode]);

  return (
    <div ref={containerRef} className="w-full h-full bg-[#1e293b] relative">
      {isCanvasMounted && (
        <Canvas
          frameloop="always"
          shadows
          dpr={[1, 2]}
          onCreated={({ gl }) => {
            canvasElementRef.current = gl.domElement;
          }}
        >
          <color attach="background" args={[SCENE_PALETTE.skyTop]} />
          <primitive attach="background" object={backgroundTexture} />
          <PerspectiveCamera makeDefault position={[0, 20, 20]} fov={75} />
          <SceneReadyNotifier onReady={onReady} />
          <CameraSetup mode={mode} sceneSpan={sceneMetrics.span} setIsLocked={setIsLocked} />
          
          <ControlsHandler setIsLocked={setIsLocked} />
          
          {mode === 'orbit' && (
            <OrbitControls
              makeDefault
              target={[0, CAMERA_WALL_REFERENCE_HEIGHT * 0.4, 0]}
              maxPolarAngle={Math.PI / 2 - 0.05}
            />
          )}

          <Environment preset="city" />
          <hemisphereLight args={['#f7f4ed', '#c4b29a', 0.55]} />
          <ambientLight intensity={0.1} />
          <directionalLight 
            position={[10, 11, 6]} 
            intensity={1.05} 
            castShadow 
            shadow-mapSize={[2048, 2048]}
            shadow-bias={-0.0001}
          />
          <directionalLight position={[-6, 4, -8]} intensity={0.2} color="#f8f1e6" />

          <group position={[-sceneMetrics.avgX, 0, -sceneMetrics.avgZ]}>
            {/* Floor */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[sceneMetrics.avgX, -0.01, sceneMetrics.avgZ]} receiveShadow>
              <planeGeometry args={[200, 200]} />
              <meshStandardMaterial 
                color={SCENE_PALETTE.floorBase}
                map={floorNoiseMap}
                roughness={0.96}
                metalness={0} 
              />
            </mesh>
            
            <ContactShadows 
              position={[sceneMetrics.avgX, 0, sceneMetrics.avgZ]} 
              opacity={0.31}
              scale={60}
              blur={2.35}
              far={12}
            />

            {/* Walls */}
            {data.walls.map((wall, i) => (
              <Wall
                key={`wall-${i}`}
                segment={wall}
                openings={data.openings}
                wallColor={SCENE_PALETTE.wall}
              />
            ))}

            {/* Corner Fills */}
            {(() => {
              const pointsMap = new Map<string, { point: { x: number, y: number }, thickness: number, count: number }>();
              data.walls.forEach(w => {
                const sKey = `${Math.round(w.start.x * 10) / 10},${Math.round(w.start.y * 10) / 10}`;
                const eKey = `${Math.round(w.end.x * 10) / 10},${Math.round(w.end.y * 10) / 10}`;
                
                if (!pointsMap.has(sKey)) pointsMap.set(sKey, { point: w.start, thickness: w.thickness, count: 0 });
                const sData = pointsMap.get(sKey)!;
                sData.thickness = Math.max(sData.thickness, w.thickness);
                sData.count++;

                if (!pointsMap.has(eKey)) pointsMap.set(eKey, { point: w.end, thickness: w.thickness, count: 0 });
                const eData = pointsMap.get(eKey)!;
                eData.thickness = Math.max(eData.thickness, w.thickness);
                eData.count++;
              });

              return Array.from(pointsMap.entries()).map(([key, data]) => {
                if (data.count < 2) return null;
                return (
                  <React.Fragment key={`corner-${key}`}>
                    <Corner3D position={data.point} thickness={data.thickness} />
                  </React.Fragment>
                );
              });
            })()}

            {/* Openings */}
            {data.openings.map((opening, i) => (
              <Opening3D key={`opening-${i}`} opening={opening} />
            ))}
          </group>

          {mode === 'first-person' && (
            <Player
              isLocked={isTouchDevice || isLocked}
              mobileControls={firstPersonTouchControls}
              mobileLookDeltaRef={firstPersonLookDeltaRef}
            />
          )}
          <ThirdPersonWalker
            active={mode === 'third-person'}
            mobileControls={thirdPersonTouchControls}
            wallSegments={centeredWallSegments}
            doorPassages={centeredDoorPassages}
            bounds={centeredBounds}
          />
        </Canvas>
      )}

      {isTouchDevice && mode === 'first-person' && (
        <div
          className="absolute inset-0 z-10"
          onTouchStart={handleFirstPersonLookStart}
          onTouchMove={handleFirstPersonLookMove}
          onTouchEnd={handleFirstPersonLookEnd}
          onTouchCancel={stopFirstPersonLook}
          style={{ touchAction: 'none' }}
        />
      )}

      {isTouchDevice && mode === 'third-person' && (
        <div
          className="absolute inset-0 z-10"
          onTouchStart={handleThirdPersonTouchStart}
          onTouchMove={handleThirdPersonTouchMove}
          onTouchEnd={handleThirdPersonTouchEnd}
          onTouchCancel={stopThirdPersonTouchControls}
          style={{ touchAction: 'none' }}
        />
      )}

      {mode === 'first-person' && !isTouchDevice && !isLocked && (
        <div 
          onClick={requestLock}
          className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm z-10 cursor-pointer"
        >
          <div className="text-white text-center space-y-4">
            <div className="w-16 h-16 rounded-full border-2 border-white/20 flex items-center justify-center mx-auto animate-pulse">
              <Move className="w-8 h-8" />
            </div>
            <p className="text-xl font-medium tracking-tight">Click to start walking</p>
            <p className="text-sm opacity-50 font-mono uppercase tracking-widest">WASD to move • Mouse to look around</p>
          </div>
        </div>
      )}

      {mode === 'first-person' && !isTouchDevice && isLocked && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-20">
          <div className="w-1 h-1 bg-white rounded-full opacity-50" />
        </div>
      )}

      {isTouchDevice && mode === 'first-person' && (
        <div className="absolute bottom-22 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-white/10 bg-black/18 px-3 py-2 backdrop-blur-md">
          <button
            type="button"
            className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/12 bg-white/12 text-white active:bg-white/22"
            onTouchStart={(event) => {
              setFirstPersonTouchControl('moveLeft', true);
              event.preventDefault();
            }}
            onTouchEnd={(event) => {
              setFirstPersonTouchControl('moveLeft', false);
              event.preventDefault();
            }}
            onTouchCancel={() => setFirstPersonTouchControl('moveLeft', false)}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            className="flex h-12 min-w-14 items-center justify-center rounded-xl border border-white/12 bg-white/14 px-3 text-white active:bg-white/24"
            onTouchStart={(event) => {
              setFirstPersonTouchControl('moveForward', true);
              event.preventDefault();
            }}
            onTouchEnd={(event) => {
              setFirstPersonTouchControl('moveForward', false);
              event.preventDefault();
            }}
            onTouchCancel={() => setFirstPersonTouchControl('moveForward', false)}
          >
            <Triangle className="h-4 w-4 fill-current" />
          </button>
          <button
            type="button"
            className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/12 bg-white/12 text-white active:bg-white/22"
            onTouchStart={(event) => {
              setFirstPersonTouchControl('moveRight', true);
              event.preventDefault();
            }}
            onTouchEnd={(event) => {
              setFirstPersonTouchControl('moveRight', false);
              event.preventDefault();
            }}
            onTouchCancel={() => setFirstPersonTouchControl('moveRight', false)}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      )}

      {mode === 'first-person' && (
        <div className="absolute bottom-4 left-4 text-white/50 text-[10px] font-mono bg-black/20 p-2 rounded backdrop-blur-sm z-20">
          {isTouchDevice ? 'Drag to look • Buttons to move' : 'WASD to move • CLICK to look • ESC to exit'}
        </div>
      )}

      {mode === 'third-person' && (
        <div className="absolute bottom-4 left-4 text-white/60 text-[10px] font-mono bg-black/20 p-2 rounded backdrop-blur-sm z-20">
          W/S to move • A/D to rotate
        </div>
      )}
    </div>
  );
};
