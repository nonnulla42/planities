import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { Point, WallSegment, FloorPlanData, Opening } from '../services/geminiService';
import { MousePointer2, Plus, Check, Undo2, Redo2, Trash2, ZoomIn, ZoomOut, Move as MoveIcon, Hand, FileText, Box, RotateCcw, RotateCw, Crosshair, Printer, Menu, SlidersHorizontal, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;
const FIT_PADDING = 48;
const ZOOM_SENSITIVITY = 0.0015;
const ZOOM_BUTTON_FACTOR = 1.2;
const TRACE_CANVAS_WIDTH = 10000;
const TRACE_CANVAS_HEIGHT = 10000;
const TRACE_IMAGE_BASE_HEIGHT = 1000;
const SCALE_CANVAS_WIDTH = 10000;
const SCALE_CANVAS_HEIGHT = 10000;
const DEFAULT_WALL_THICKNESS = 10;
const OPENING_MIN_HIT_SIZE_PX = 14;
const OPENING_HIT_PADDING_PX = 8;
const POINT_SNAP_RADIUS_PX = 14;
const ALIGNMENT_SNAP_RADIUS_PX = 12;
const WALL_SEGMENT_MOUSE_HIT_PADDING_PX = 10;
const WALL_SEGMENT_TOUCH_HIT_PADDING_PX = 18;
const WALL_NODE_MOUSE_HIT_RADIUS_PX = 16;
const WALL_NODE_TOUCH_HIT_RADIUS_PX = 36;
const BACKGROUND_ROTATION_STEP = 1;
const GUIDE_PANEL_TOP_MARGIN = 96;
const GUIDE_PANEL_EDGE_MARGIN = 16;
const GUIDE_PANEL_WIDTH = 288;
const OPENING_SELECTION_COLOR = '#C65A46';
const MULTI_WALL_ROTATION_STEP_DEGREES = 15;
const TOUCH_LONG_PRESS_MS = 280;
const TOUCH_MOVE_CANCEL_PX = 10;
const UI_OVERLAY_EVENT_BLOCK_MS = 450;
const ENDPOINT_VISUAL_RADIUS_PX = 4;
const ENDPOINT_SELECTED_VISUAL_RADIUS_PX = 6;
const MULTI_SELECTION_CENTROID_VISUAL_RADIUS_PX = 18;
const MULTI_SELECTION_CENTROID_INNER_VISUAL_RADIUS_PX = 5;
const MULTI_SELECTION_PIVOT_MOUSE_HIT_RADIUS_PX = 18;
const MULTI_SELECTION_PIVOT_TOUCH_HIT_RADIUS_PX = 42;
const MULTI_WALL_TOGGLE_CANCEL_THRESHOLD_PX = 5;
const NODE_DRAG_START_MOUSE_THRESHOLD_PX = 6;
const NODE_DRAG_START_TOUCH_THRESHOLD_PX = 6;
const A4_PORTRAIT_CM = { width: 21, height: 29.7 };
const PDF_PAGE_POINTS = { width: 595.28, height: 841.89 };
let wallIdCounter = 0;

const WallIcon = () => (
  <svg width="24" height="12" viewBox="0 0 24 12" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="24" height="12" rx="1" fill="currentColor" fillOpacity="0.1" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M6 0V12M12 0V12M18 0V12M0 6H24" stroke="currentColor" strokeWidth="0.5" strokeOpacity="0.4"/>
  </svg>
);

const DoorIcon = () => (
  <svg width="12" height="24" viewBox="0 0 12 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="12" height="24" rx="1" fill="currentColor" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
);

const WindowIcon = () => (
  <svg width="24" height="12" viewBox="0 0 24 12" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="24" height="12" rx="1" fill="currentColor" fillOpacity="0.1" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M12 0V12M0 6H24" stroke="currentColor" strokeWidth="1" strokeOpacity="0.6"/>
  </svg>
);

const FloorWindowIcon = () => (
  <svg width="24" height="14" viewBox="0 0 24 14" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="22" height="12" rx="1" fill="currentColor" fillOpacity="0.1" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M12 1V13" stroke="currentColor" strokeWidth="1" strokeOpacity="0.65"/>
    <path d="M1 3.5H23" stroke="currentColor" strokeWidth="1" strokeOpacity="0.45"/>
  </svg>
);

const GuideTip = ({ children }: { children: React.ReactNode }) => (
  <p className="rounded-2xl bg-[#F1ECE3] px-3 py-2 text-[10px] font-medium leading-relaxed text-[#6C5A46]">
    {children}
  </p>
);

interface ManualTracerProps {
  imageUrl?: string | null;
  workflowStep: 'trace' | 'scale';
  isScaleCalibrated: boolean;
  initialSuggestedScale?: number;
  initialWalls?: WallSegment[];
  initialOpenings?: Opening[];
  onScaleCalibrated: () => void;
  onProjectChange?: (data: FloorPlanData) => void;
  onComplete: (data: FloorPlanData) => void;
  onCancel: () => void;
}

interface DrawingSnapshot {
  walls: WallSegment[];
  openings: Opening[];
  currentThickness: number;
  currentOpeningWidth: number;
}

interface SelectionState {
  selectedWallIndex: number | null;
  selectedOpeningIndex: number | null;
  selectedWallIndices: number[];
}

interface ResolvedOpening extends Opening {
  position: Point;
  rotation: number;
  thickness: number;
}

interface OpeningRenderMetrics {
  bodyHeight: number;
  hitWidth: number;
  hitHeight: number;
  lineInset: number;
  windowLineOffset: number;
}

interface BackgroundTransform {
  x: number;
  y: number;
  rotation: number;
}

interface CalibrationSegment {
  start: Point;
  end: Point;
}

interface AlignmentGuide {
  axis: 'x' | 'y';
  value: number;
}

type SnapNodeKind = 'endpoint' | 'midpoint';

interface SnapNode {
  point: Point;
  kind: SnapNodeKind;
}

interface SnapResult {
  point: Point;
  guides: AlignmentGuide[];
  snappedNode: SnapNode | null;
}

interface LockedWallDirection {
  x: number;
  y: number;
}

interface MultiWallDragState {
  wallIndices: number[];
  startPointer: Point;
  baseWalls: WallSegment[];
}

interface MarqueeSelectionState {
  origin: Point;
  current: Point;
}

interface PendingMultiWallToggle {
  wallIndex: number;
  startClientX: number;
  startClientY: number;
}

interface PendingPointDragState {
  point: { wallIndex: number; type: 'start' | 'end' };
  startClientX: number;
  startClientY: number;
}

interface TouchPointerInfo {
  clientX: number;
  clientY: number;
}

interface TouchPressState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startWorld: Point;
  target:
    | { type: 'draw' }
    | { type: 'point'; point: { wallIndex: number; type: 'start' | 'end' } }
    | { type: 'opening'; openingIndex: number }
    | { type: 'wall'; wallIndex: number }
    | { type: 'pivot' }
    | { type: 'empty' };
  dragActivated: boolean;
}

interface TouchGestureState {
  type: 'pinch-pan' | 'group-rotate';
  pointerIds: [number, number];
  startDistance: number;
  startMidpoint: { x: number; y: number };
  startZoom: number;
  startOffset: { x: number; y: number };
  startAngle?: number;
  pivot?: Point;
  baseWalls?: WallSegment[];
}

type GuideGroup = 'drawing' | 'interaction' | 'environment';
type MarqueeMode = 'multi-select' | 'delete';

interface GuidePanelContent {
  title: string;
  sections: Array<{
    label: string;
    description: string[];
  }>;
  tip?: string;
}

interface RoomMeasurementResult {
  perimeterCm: number;
  areaCm2: number;
  polygon: Point[];
}

type PrintScaleOption = 50 | 100 | 200;
type PrintOrientation = 'portrait' | 'landscape';

interface PrintFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: PrintScaleOption;
  orientation: PrintOrientation;
}

interface SnapResolverOptions {
  anchor?: Point | null;
  excludeWallIndex?: number;
  excludeWallIndices?: number[];
  allowAlignment?: boolean;
  continuationDirections?: LockedWallDirection[] | null;
}

type DisplayUnit = 'cm' | 'm';
type HandleTarget = 'wall-node' | 'multi-selection-pivot';
type InputPrecision = 'mouse' | 'touch';

const createWallId = () => `wall-${++wallIdCounter}`;

const getHandleHitRadiusPx = (target: HandleTarget, input: InputPrecision): number => {
  if (target === 'multi-selection-pivot') {
    return input === 'touch'
      ? MULTI_SELECTION_PIVOT_TOUCH_HIT_RADIUS_PX
      : MULTI_SELECTION_PIVOT_MOUSE_HIT_RADIUS_PX;
  }

  return input === 'touch'
    ? WALL_NODE_TOUCH_HIT_RADIUS_PX
    : WALL_NODE_MOUSE_HIT_RADIUS_PX;
};

const getWallSegmentHitPaddingPx = (input: InputPrecision): number => (
  input === 'touch'
    ? WALL_SEGMENT_TOUCH_HIT_PADDING_PX
    : WALL_SEGMENT_MOUSE_HIT_PADDING_PX
);

const clonePoint = (point: Point): Point => ({ x: point.x, y: point.y });

const normalizeDirection = (start: Point, end: Point): LockedWallDirection | null => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  return {
    x: dx / length,
    y: dy / length,
  };
};

const normalizeVector = (vector: LockedWallDirection): LockedWallDirection | null => {
  const length = Math.hypot(vector.x, vector.y);
  if (length === 0) return null;
  return {
    x: vector.x / length,
    y: vector.y / length,
  };
};

const rotateDirection = (direction: LockedWallDirection, angle: number): LockedWallDirection => ({
  x: direction.x * Math.cos(angle) - direction.y * Math.sin(angle),
  y: direction.x * Math.sin(angle) + direction.y * Math.cos(angle),
});

const isSamePoint = (a: Point, b: Point, epsilon = 0.001) =>
  Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;

const dedupeDirections = (directions: LockedWallDirection[]): LockedWallDirection[] => {
  const unique: LockedWallDirection[] = [];

  directions.forEach((direction) => {
    const normalized = normalizeVector(direction);
    if (!normalized) return;

    const alreadyPresent = unique.some((candidate) =>
      Math.abs(candidate.x - normalized.x) < 0.001 && Math.abs(candidate.y - normalized.y) < 0.001
    );

    if (!alreadyPresent) {
      unique.push(normalized);
    }
  });

  return unique;
};

const constrainPointToDirections = (
  anchor: Point,
  target: Point,
  directionPool?: LockedWallDirection[] | null,
): Point => {
  const dx = target.x - anchor.x;
  const dy = target.y - anchor.y;
  const distance = Math.hypot(dx, dy);

  if (distance === 0) {
    return { ...target };
  }

  if (directionPool && directionPool.length > 0) {
    let bestDirection = directionPool[0];
    let bestDot = Number.NEGATIVE_INFINITY;

    directionPool.forEach((direction) => {
      const normalized = normalizeVector(direction);
      if (!normalized) return;
      const dot = (dx / distance) * normalized.x + (dy / distance) * normalized.y;
      if (dot > bestDot) {
        bestDot = dot;
        bestDirection = normalized;
      }
    });

    const normalizedBestDirection = normalizeVector(bestDirection) ?? { x: 1, y: 0 };
    return {
      x: anchor.x + normalizedBestDirection.x * distance,
      y: anchor.y + normalizedBestDirection.y * distance,
    };
  }

  const angle = Math.atan2(dy, dx);
  const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  return {
    x: anchor.x + Math.cos(snappedAngle) * distance,
    y: anchor.y + Math.sin(snappedAngle) * distance,
  };
};

const isPointInsideRect = (point: Point, rect: { minX: number; minY: number; maxX: number; maxY: number }) => (
  point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY
);

const lineSegmentsIntersect = (a1: Point, a2: Point, b1: Point, b2: Point) => {
  const cross = (p1: Point, p2: Point, p3: Point) => (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);
  const onSegment = (p1: Point, p2: Point, p: Point) => (
    Math.min(p1.x, p2.x) - 0.001 <= p.x &&
    p.x <= Math.max(p1.x, p2.x) + 0.001 &&
    Math.min(p1.y, p2.y) - 0.001 <= p.y &&
    p.y <= Math.max(p1.y, p2.y) + 0.001
  );

  const d1 = cross(a1, a2, b1);
  const d2 = cross(a1, a2, b2);
  const d3 = cross(b1, b2, a1);
  const d4 = cross(b1, b2, a2);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  if (Math.abs(d1) < 0.001 && onSegment(a1, a2, b1)) return true;
  if (Math.abs(d2) < 0.001 && onSegment(a1, a2, b2)) return true;
  if (Math.abs(d3) < 0.001 && onSegment(b1, b2, a1)) return true;
  if (Math.abs(d4) < 0.001 && onSegment(b1, b2, a2)) return true;

  return false;
};

const wallIntersectsRect = (wall: WallSegment, rect: { minX: number; minY: number; maxX: number; maxY: number }) => {
  if (isPointInsideRect(wall.start, rect) || isPointInsideRect(wall.end, rect)) {
    return true;
  }

  const topLeft = { x: rect.minX, y: rect.maxY };
  const topRight = { x: rect.maxX, y: rect.maxY };
  const bottomLeft = { x: rect.minX, y: rect.minY };
  const bottomRight = { x: rect.maxX, y: rect.minY };

  return (
    lineSegmentsIntersect(wall.start, wall.end, topLeft, topRight) ||
    lineSegmentsIntersect(wall.start, wall.end, topRight, bottomRight) ||
    lineSegmentsIntersect(wall.start, wall.end, bottomRight, bottomLeft) ||
    lineSegmentsIntersect(wall.start, wall.end, bottomLeft, topLeft)
  );
};

const GUIDE_PANEL_CONTENT: Record<'trace' | 'scale', Record<GuideGroup, GuidePanelContent>> = {
  trace: {
    drawing: {
      title: 'Trace the plan',
      sections: [
        {
          label: 'Wall',
          description: [
            'Click to start a wall.',
            'Click again to place the endpoint and trace the full layout at real scale.',
            'Hold SHIFT to constrain drawing to horizontal, vertical, 45° diagonals, and the perpendicular direction relative to the previously drawn wall.',
          ],
        },
        {
          label: 'Door',
          description: [
            'Insert openings in walls to represent entrances.',
          ],
        },
        {
          label: 'Window',
          description: [
            'Add windows to better define rooms and facades.',
          ],
        },
      ],
      tip: 'Tip: snapping helps align new walls with existing geometry.',
    },
    interaction: {
      title: 'Edit and organize',
      sections: [
        {
          label: 'Select',
          description: [
            'Select an element to edit it or move its endpoints.',
          ],
        },
        {
          label: 'Pan',
          description: [
            'Move the view by dragging the workspace.',
            'You can also hold the mouse wheel to pan without changing tools.',
          ],
        },
        {
          label: 'Multi',
          description: [
            'Select multiple walls to move them together or change thickness in batch.',
            'Hold CTRL and left click to rotate the selected group 15 degrees clockwise.',
          ],
        },
        {
          label: 'Undo / Redo',
          description: [
            'Revert or restore the last action.',
          ],
        },
        {
          label: 'Delete',
          description: [
            'Remove selected elements.',
            'Hold SHIFT and drag a rectangle to delete multiple elements at once.',
          ],
        },
      ],
      tip: 'Tip: snapping remains active during movement to help alignment.',
    },
    environment: {
      title: 'Reference and workflow',
      sections: [
        {
          label: 'Recal',
          description: [
            'Use RECAL to draw a new reference segment and manually correct the scale after tracing has started.',
            'This does not replace your walls with a new reference line.',
          ],
        },
        {
          label: 'Reference on/off',
          description: [
            'Use REFERENCE ON/OFF to show or hide the background file.',
          ],
        },
        {
          label: 'Reference adjust',
          description: [
            'Move the background file to align it with your drawing.',
            'This does not affect walls or openings.',
          ],
        },
        {
          label: 'Rotate',
          description: [
            'Rotate the background to correct orientation.',
          ],
        },
        {
          label: 'Reset rotation',
          description: [
            'Restore the original background rotation.',
            'This does not reset its position.',
          ],
        },
      ],
    },
  },
  scale: {
    drawing: {
      title: 'Set the scale',
      sections: [
        {
          label: 'Reference',
          description: [
            'Trace one simple reference segment over a wall or span with a known real measurement.',
            'Click again to place the endpoint, or type the reference length while drawing.',
            'Hold SHIFT to constrain drawing to horizontal, vertical, 45° diagonals, and the perpendicular direction relative to the previously drawn wall.',
          ],
        },
        {
          label: 'Confirm',
          description: [
            'Select the reference segment and enter its real internal span to lock the project scale.',
          ],
        },
        {
          label: 'Window',
          description: [
            'After scale is set, continue in TRACE mode to draw the final wall layout.',
          ],
        },
      ],
      tip: 'Tip: after scale is locked, continue in TRACE mode to draw the full plan.',
    },
    interaction: {
      title: 'Edit and organize',
      sections: [
        {
          label: 'Select',
          description: [
            'Select an element to edit it or move its endpoints.',
          ],
        },
        {
          label: 'Pan',
          description: [
            'Move the view by dragging the workspace.',
            'You can also hold the mouse wheel to pan without changing tools.',
          ],
        },
        {
          label: 'Multi',
          description: [
            'Select multiple walls to move them together or change thickness in batch.',
            'Hold CTRL and left click to rotate the selected group 15 degrees clockwise.',
          ],
        },
        {
          label: 'Undo / Redo',
          description: [
            'Revert or restore the last action.',
          ],
        },
        {
          label: 'Delete',
          description: [
            'Remove selected elements.',
            'Hold SHIFT and drag a rectangle to delete multiple elements at once.',
          ],
        },
      ],
      tip: 'Tip: snapping remains active during movement to help alignment.',
    },
    environment: {
      title: 'Scale and reference',
      sections: [
        {
          label: 'Set Scale',
          description: [
            'Click SET SCALE to enter calibration mode immediately.',
            'Draw a reference segment over a known distance, then enter its real measurement to lock the global scale.',
          ],
        },
        {
          label: 'Reference on/off',
          description: [
            'Use REFERENCE ON/OFF to show or hide the background file.',
          ],
        },
        {
          label: 'Reference adjust',
          description: [
            'Move the background independently from the drawing.',
          ],
        },
        {
          label: 'Rotate',
          description: [
            'Rotate the background for better alignment.',
          ],
        },
        {
          label: 'Reset rotation',
          description: [
            'Restore the background’s original rotation only.',
          ],
        },
      ],
    },
  },
};

const ROOM_GRAPH_EPSILON = 1e-6;
const CALIBRATION_SPAN_EPSILON = 1e-3;
const UI_OVERLAY_SELECTOR = '[data-ui-overlay="true"]';

const getPointKey = (point: Point) => `${point.x.toFixed(4)},${point.y.toFixed(4)}`;

const pointsEqual = (a: Point, b: Point) =>
  Math.abs(a.x - b.x) <= ROOM_GRAPH_EPSILON && Math.abs(a.y - b.y) <= ROOM_GRAPH_EPSILON;

const cross2D = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

const isPointOnSegment = (point: Point, start: Point, end: Point) => {
  if (Math.abs(cross2D(start, end, point)) > ROOM_GRAPH_EPSILON) {
    return false;
  }

  const minX = Math.min(start.x, end.x) - ROOM_GRAPH_EPSILON;
  const maxX = Math.max(start.x, end.x) + ROOM_GRAPH_EPSILON;
  const minY = Math.min(start.y, end.y) - ROOM_GRAPH_EPSILON;
  const maxY = Math.max(start.y, end.y) + ROOM_GRAPH_EPSILON;

  return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
};

const getSegmentInterpolation = (start: Point, end: Point, point: Point) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= ROOM_GRAPH_EPSILON) {
    return 0;
  }

  return ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq;
};

const getSegmentIntersections = (aStart: Point, aEnd: Point, bStart: Point, bEnd: Point) => {
  const intersections: Point[] = [];
  const denominator =
    (aEnd.x - aStart.x) * (bEnd.y - bStart.y) - (aEnd.y - aStart.y) * (bEnd.x - bStart.x);

  if (Math.abs(denominator) <= ROOM_GRAPH_EPSILON) {
    const candidates = [aStart, aEnd, bStart, bEnd];
    candidates.forEach((candidate) => {
      if (
        isPointOnSegment(candidate, aStart, aEnd) &&
        isPointOnSegment(candidate, bStart, bEnd) &&
        !intersections.some((existing) => pointsEqual(existing, candidate))
      ) {
        intersections.push(candidate);
      }
    });

    return intersections;
  }

  const ua =
    ((bEnd.x - bStart.x) * (aStart.y - bStart.y) - (bEnd.y - bStart.y) * (aStart.x - bStart.x)) /
    denominator;
  const ub =
    ((aEnd.x - aStart.x) * (aStart.y - bStart.y) - (aEnd.y - aStart.y) * (aStart.x - bStart.x)) /
    denominator;

  if (
    ua >= -ROOM_GRAPH_EPSILON &&
    ua <= 1 + ROOM_GRAPH_EPSILON &&
    ub >= -ROOM_GRAPH_EPSILON &&
    ub <= 1 + ROOM_GRAPH_EPSILON
  ) {
    intersections.push({
      x: aStart.x + ua * (aEnd.x - aStart.x),
      y: aStart.y + ua * (aEnd.y - aStart.y),
    });
  }

  return intersections;
};

const getDistanceToSegment = (point: Point, start: Point, end: Point) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq <= ROOM_GRAPH_EPSILON) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq));
  const closestX = start.x + dx * t;
  const closestY = start.y + dy * t;
  return Math.hypot(point.x - closestX, point.y - closestY);
};

const getWallLengthCm = (wall: WallSegment) => Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);

const getWallOutline = (wall: WallSegment) => {
  const direction = normalizeDirection(wall.start, wall.end);
  if (!direction) {
    return null;
  }

  const halfThickness = wall.thickness / 2;
  const normal = { x: -direction.y, y: direction.x };

  return [
    {
      x: wall.start.x + normal.x * halfThickness,
      y: wall.start.y + normal.y * halfThickness,
    },
    {
      x: wall.end.x + normal.x * halfThickness,
      y: wall.end.y + normal.y * halfThickness,
    },
    {
      x: wall.end.x - normal.x * halfThickness,
      y: wall.end.y - normal.y * halfThickness,
    },
    {
      x: wall.start.x - normal.x * halfThickness,
      y: wall.start.y - normal.y * halfThickness,
    },
  ] as const;
};

const getReferenceLineWallIntersections = (referenceStart: Point, referenceEnd: Point, wall: WallSegment) => {
  const outline = getWallOutline(wall);
  if (!outline) {
    return [] as Point[];
  }

  const edges: Array<[Point, Point]> = [
    [outline[0], outline[1]],
    [outline[1], outline[2]],
    [outline[2], outline[3]],
    [outline[3], outline[0]],
  ];

  const intersections: Point[] = [];
  edges.forEach(([edgeStart, edgeEnd]) => {
    getSegmentIntersections(referenceStart, referenceEnd, edgeStart, edgeEnd).forEach((point) => {
      if (!intersections.some((existing) => pointsEqual(existing, point))) {
        intersections.push(point);
      }
    });
  });

  return intersections;
};

const getInteriorCalibrationSpanLength = (selectedWall: WallSegment, allWalls: WallSegment[]) => {
  const wallLength = getWallLengthCm(selectedWall);
  const direction = normalizeDirection(selectedWall.start, selectedWall.end);
  if (!direction || wallLength <= CALIBRATION_SPAN_EPSILON) {
    return wallLength;
  }

  const endpointTolerance = Math.max(selectedWall.thickness * 0.75, 2);
  const connectedStartWalls = allWalls.filter((wall) =>
    wall !== selectedWall &&
    getDistanceToSegment(selectedWall.start, wall.start, wall.end) <= wall.thickness / 2 + endpointTolerance,
  );
  const connectedEndWalls = allWalls.filter((wall) =>
    wall !== selectedWall &&
    getDistanceToSegment(selectedWall.end, wall.start, wall.end) <= wall.thickness / 2 + endpointTolerance,
  );

  if (connectedStartWalls.length === 0 || connectedEndWalls.length === 0) {
    return wallLength;
  }

  const normal = { x: -direction.y, y: direction.x };
  const halfThickness = selectedWall.thickness / 2;
  const referenceLines = [
    {
      start: {
        x: selectedWall.start.x + normal.x * halfThickness,
        y: selectedWall.start.y + normal.y * halfThickness,
      },
      end: {
        x: selectedWall.end.x + normal.x * halfThickness,
        y: selectedWall.end.y + normal.y * halfThickness,
      },
    },
    {
      start: {
        x: selectedWall.start.x - normal.x * halfThickness,
        y: selectedWall.start.y - normal.y * halfThickness,
      },
      end: {
        x: selectedWall.end.x - normal.x * halfThickness,
        y: selectedWall.end.y - normal.y * halfThickness,
      },
    },
  ];

  const resolveBoundary = (
    referenceStart: Point,
    referenceEnd: Point,
    candidates: WallSegment[],
    side: 'start' | 'end',
  ) => {
    const projectedIntersections = candidates.flatMap((wall) =>
      getReferenceLineWallIntersections(referenceStart, referenceEnd, wall)
        .map((point) => ({
          point,
          t: getSegmentInterpolation(referenceStart, referenceEnd, point),
        }))
        .filter(({ t }) => t >= -0.2 && t <= 1.2),
    );

    if (projectedIntersections.length === 0) {
      return null;
    }

    if (side === 'start') {
      const interiorCandidates = projectedIntersections.filter(({ t }) => t <= 0.75 + CALIBRATION_SPAN_EPSILON);
      const targetPool = interiorCandidates.length > 0 ? interiorCandidates : projectedIntersections;
      return targetPool.reduce((best, current) => (current.t > best.t ? current : best));
    }

    const interiorCandidates = projectedIntersections.filter(({ t }) => t >= 0.25 - CALIBRATION_SPAN_EPSILON);
    const targetPool = interiorCandidates.length > 0 ? interiorCandidates : projectedIntersections;
    return targetPool.reduce((best, current) => (current.t < best.t ? current : best));
  };

  const validSpans = referenceLines
    .map(({ start, end }) => {
      const startBoundary = resolveBoundary(start, end, connectedStartWalls, 'start');
      const endBoundary = resolveBoundary(start, end, connectedEndWalls, 'end');

      if (!startBoundary || !endBoundary || endBoundary.t <= startBoundary.t) {
        return null;
      }

      return Math.hypot(endBoundary.point.x - startBoundary.point.x, endBoundary.point.y - startBoundary.point.y);
    })
    .filter((span): span is number => typeof span === 'number' && span > CALIBRATION_SPAN_EPSILON);

  if (validSpans.length === 0) {
    return wallLength;
  }

  return Math.min(...validSpans);
};

const getPolygonArea = (polygon: Point[]) => {
  let area = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const current = polygon[i];
    const next = polygon[(i + 1) % polygon.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
};

const rotatePointAroundPivot = (point: Point, pivot: Point, angleRad: number): Point => {
  const translatedX = point.x - pivot.x;
  const translatedY = point.y - pivot.y;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);

  return {
    x: pivot.x + translatedX * cos - translatedY * sin,
    y: pivot.y + translatedX * sin + translatedY * cos,
  };
};

const getPrintFrameDimensions = (scale: PrintScaleOption, orientation: PrintOrientation) => {
  const widthCm = A4_PORTRAIT_CM.width * scale;
  const heightCm = A4_PORTRAIT_CM.height * scale;

  return orientation === 'portrait'
    ? { width: widthCm, height: heightCm }
    : { width: heightCm, height: widthCm };
};

const dataUrlToUint8Array = (dataUrl: string) => {
  const base64 = dataUrl.split(',')[1] ?? '';
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
};

const buildSinglePagePdfFromJpeg = (
  jpegBytes: Uint8Array,
  imageWidth: number,
  imageHeight: number,
  orientation: PrintOrientation,
) => {
  const encoder = new TextEncoder();
  const pageWidth = orientation === 'portrait' ? PDF_PAGE_POINTS.width : PDF_PAGE_POINTS.height;
  const pageHeight = orientation === 'portrait' ? PDF_PAGE_POINTS.height : PDF_PAGE_POINTS.width;
  const contentStream = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ`;

  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0];
  let byteLength = 0;

  const pushText = (text: string) => {
    const bytes = encoder.encode(text);
    chunks.push(bytes);
    byteLength += bytes.length;
  };

  const pushBinary = (bytes: Uint8Array) => {
    chunks.push(bytes);
    byteLength += bytes.length;
  };

  pushText('%PDF-1.3\n');

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`,
  ];

  objects.forEach((objectText, index) => {
    offsets.push(byteLength);
    pushText(objectText);
    if (index === 3) {
      pushBinary(jpegBytes);
      pushText('\nendstream\nendobj\n');
    }
  });

  const contentBytes = encoder.encode(contentStream);
  offsets.push(byteLength);
  pushText(`5 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n${contentStream}\nendstream\nendobj\n`);

  const xrefOffset = byteLength;
  pushText(`xref\n0 ${offsets.length}\n`);
  pushText('0000000000 65535 f \n');
  offsets.slice(1).forEach((offset) => {
    pushText(`${offset.toString().padStart(10, '0')} 00000 n \n`);
  });
  pushText(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  const pdfBytes = new Uint8Array(byteLength);
  let cursor = 0;
  chunks.forEach((chunk) => {
    pdfBytes.set(chunk, cursor);
    cursor += chunk.length;
  });

  return new Blob([pdfBytes], { type: 'application/pdf' });
};

const isPointInsidePolygon = (point: Point, polygon: Point[]) => {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];

    if (isPointOnSegment(point, a, b)) {
      return false;
    }

    const intersects =
      (a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
};

const buildClosedRoomFaces = (walls: WallSegment[]) => {
  if (walls.length < 3) {
    return [];
  }

  const splitWalls = walls.map((wall, index) => {
    const points = [wall.start, wall.end];

    walls.forEach((otherWall, otherIndex) => {
      if (index === otherIndex) {
        return;
      }

      getSegmentIntersections(wall.start, wall.end, otherWall.start, otherWall.end).forEach((point) => {
        if (!points.some((candidate) => pointsEqual(candidate, point))) {
          points.push(point);
        }
      });
    });

    return points
      .map((point) => ({
        point,
        t: getSegmentInterpolation(wall.start, wall.end, point),
      }))
      .sort((a, b) => a.t - b.t);
  });

  const vertices = new Map<string, Point>();
  const adjacency = new Map<string, Set<string>>();

  splitWalls.forEach((splitPoints) => {
    for (let i = 0; i < splitPoints.length - 1; i += 1) {
      const start = splitPoints[i].point;
      const end = splitPoints[i + 1].point;
      if (pointsEqual(start, end)) {
        continue;
      }

      const startKey = getPointKey(start);
      const endKey = getPointKey(end);

      vertices.set(startKey, start);
      vertices.set(endKey, end);

      if (!adjacency.has(startKey)) {
        adjacency.set(startKey, new Set());
      }
      if (!adjacency.has(endKey)) {
        adjacency.set(endKey, new Set());
      }

      adjacency.get(startKey)!.add(endKey);
      adjacency.get(endKey)!.add(startKey);
    }
  });

  const outgoing = new Map<string, string[]>();
  adjacency.forEach((neighbors, key) => {
    const origin = vertices.get(key)!;
    outgoing.set(
      key,
      Array.from(neighbors).sort((a, b) => {
        const pointA = vertices.get(a)!;
        const pointB = vertices.get(b)!;
        const angleA = Math.atan2(pointA.y - origin.y, pointA.x - origin.x);
        const angleB = Math.atan2(pointB.y - origin.y, pointB.x - origin.x);
        return angleA - angleB;
      }),
    );
  });

  const visited = new Set<string>();
  const faces: Point[][] = [];

  outgoing.forEach((neighbors, startKey) => {
    neighbors.forEach((nextKey) => {
      const edgeKey = `${startKey}->${nextKey}`;
      if (visited.has(edgeKey)) {
        return;
      }

      const face: Point[] = [];
      let currentKey = startKey;
      let targetKey = nextKey;
      let safety = 0;

      while (safety < 2000) {
        safety += 1;
        const directedKey = `${currentKey}->${targetKey}`;
        if (visited.has(directedKey)) {
          break;
        }

        visited.add(directedKey);
        face.push(vertices.get(currentKey)!);

        const targetNeighbors = outgoing.get(targetKey);
        if (!targetNeighbors || targetNeighbors.length < 2) {
          break;
        }

        const incomingIndex = targetNeighbors.indexOf(currentKey);
        if (incomingIndex === -1) {
          break;
        }

        const nextIndex = (incomingIndex - 1 + targetNeighbors.length) % targetNeighbors.length;
        const followingKey = targetNeighbors[nextIndex];

        currentKey = targetKey;
        targetKey = followingKey;

        if (currentKey === startKey && targetKey === nextKey) {
          const area = getPolygonArea(face);
          if (face.length >= 3 && area > ROOM_GRAPH_EPSILON) {
            faces.push(face);
          }
          break;
        }
      }
    });
  });

  const uniqueFaces = new Map<string, Point[]>();
  faces.forEach((face) => {
    const normalized = [...face]
      .map((point) => getPointKey(point))
      .sort()
      .join('|');

    if (!uniqueFaces.has(normalized)) {
      uniqueFaces.set(normalized, face);
    }
  });

  return Array.from(uniqueFaces.values());
};

const cloneWalls = (walls: WallSegment[]): WallSegment[] =>
  walls.map((wall) => ({
    id: wall.id ?? createWallId(),
    start: clonePoint(wall.start),
    end: clonePoint(wall.end),
    thickness: wall.thickness,
  }));

const cloneOpenings = (openings: Opening[]): Opening[] =>
  openings.map((opening) => ({
    position: clonePoint(opening.position),
    width: opening.width,
    type: opening.type,
    rotation: opening.rotation,
    thickness: opening.thickness,
    wallId: opening.wallId,
    offsetAlongWall: opening.offsetAlongWall,
  }));

const getAttachmentForWall = (wall: WallSegment, position: Point) => {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return null;

  const rawT = ((position.x - wall.start.x) * dx + (position.y - wall.start.y) * dy) / lengthSquared;
  const offsetAlongWall = Math.max(0, Math.min(1, rawT));
  const snappedPosition = {
    x: wall.start.x + offsetAlongWall * dx,
    y: wall.start.y + offsetAlongWall * dy,
  };
  const distance = Math.hypot(position.x - snappedPosition.x, position.y - snappedPosition.y);

  return {
    wallId: wall.id,
    offsetAlongWall,
    position: snappedPosition,
    rotation: THREE.MathUtils.radToDeg(Math.atan2(dy, dx)),
    thickness: wall.thickness,
    distance,
  };
};

const attachOpeningsToWalls = (openings: Opening[], walls: WallSegment[]): Opening[] => {
  if (walls.length === 0) return cloneOpenings(openings);

  return cloneOpenings(openings).map((opening) => {
    if (opening.wallId && opening.offsetAlongWall !== undefined) {
      return opening;
    }

    let bestMatch: ReturnType<typeof getAttachmentForWall> = null;
    walls.forEach((wall) => {
      const metrics = getAttachmentForWall(wall, opening.position);
      if (!metrics) return;
      if (!bestMatch || metrics.distance < bestMatch.distance) {
        bestMatch = metrics;
      }
    });

    if (!bestMatch) return opening;

    return {
      ...opening,
      wallId: bestMatch.wallId,
      offsetAlongWall: bestMatch.offsetAlongWall,
      position: bestMatch.position,
      rotation: bestMatch.rotation,
      thickness: bestMatch.thickness,
    };
  });
};

const getBoundsForGeometry = (walls: WallSegment[], openings: Opening[]) => {
  if (walls.length === 0 && openings.length === 0) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  walls.forEach((wall) => {
    const halfThickness = wall.thickness / 2;
    minX = Math.min(minX, wall.start.x - halfThickness, wall.end.x - halfThickness);
    minY = Math.min(minY, wall.start.y - halfThickness, wall.end.y - halfThickness);
    maxX = Math.max(maxX, wall.start.x + halfThickness, wall.end.x + halfThickness);
    maxY = Math.max(maxY, wall.start.y + halfThickness, wall.end.y + halfThickness);
  });

  openings.forEach((opening) => {
    const halfWidth = opening.width / 2;
    const halfThickness = (opening.thickness || 20) / 2;
    minX = Math.min(minX, opening.position.x - halfWidth, opening.position.x - halfThickness);
    minY = Math.min(minY, opening.position.y - halfWidth, opening.position.y - halfThickness);
    maxX = Math.max(maxX, opening.position.x + halfWidth, opening.position.x + halfThickness);
    maxY = Math.max(maxY, opening.position.y + halfWidth, opening.position.y + halfThickness);
  });

  return { minX, minY, maxX, maxY };
};

const scaleGeometry = (walls: WallSegment[], openings: Opening[], factor: number): { walls: WallSegment[]; openings: Opening[] } => ({
  walls: walls.map((wall) => ({
    ...wall,
    start: { x: wall.start.x * factor, y: wall.start.y * factor },
    end: { x: wall.end.x * factor, y: wall.end.y * factor },
    thickness: wall.thickness * factor,
  })),
  openings: openings.map((opening) => ({
    ...opening,
    position: { x: opening.position.x * factor, y: opening.position.y * factor },
    width: opening.width * factor,
    thickness: opening.thickness !== undefined ? opening.thickness * factor : undefined,
  })),
});

const translateGeometry = (walls: WallSegment[], openings: Opening[], dx: number, dy: number): { walls: WallSegment[]; openings: Opening[] } => ({
  walls: walls.map((wall) => ({
    ...wall,
    start: { x: wall.start.x + dx, y: wall.start.y + dy },
    end: { x: wall.end.x + dx, y: wall.end.y + dy },
  })),
  openings: openings.map((opening) => ({
    ...opening,
    position: { x: opening.position.x + dx, y: opening.position.y + dy },
  })),
});

const getRotatedBounds = (width: number, height: number, transform: BackgroundTransform) => {
  const center = {
    x: transform.x + width / 2,
    y: transform.y + height / 2,
  };
  const corners = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: 0, y: height },
    { x: width, y: height },
  ];
  const angle = THREE.MathUtils.degToRad(transform.rotation);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  const rotated = corners.map((corner) => ({
    x: center.x + (corner.x - width / 2) * cos - (corner.y - height / 2) * sin,
    y: center.y + (corner.x - width / 2) * sin + (corner.y - height / 2) * cos,
  }));

  return {
    minX: Math.min(...rotated.map((corner) => corner.x)),
    maxX: Math.max(...rotated.map((corner) => corner.x)),
    minY: Math.min(...rotated.map((corner) => corner.y)),
    maxY: Math.max(...rotated.map((corner) => corner.y)),
  };
};

export const ManualTracer: React.FC<ManualTracerProps> = ({
  imageUrl,
  workflowStep,
  isScaleCalibrated,
  initialSuggestedScale,
  initialWalls,
  initialOpenings,
  onScaleCalibrated,
  onProjectChange,
  onComplete,
  onCancel,
}) => {
  const normalizedInitialWalls = cloneWalls(initialWalls || []);
  const initialSnapshotRef = useRef<DrawingSnapshot>({
    walls: normalizedInitialWalls,
    openings: attachOpeningsToWalls(initialOpenings || [], normalizedInitialWalls),
    currentThickness: DEFAULT_WALL_THICKNESS,
    currentOpeningWidth: 80,
  });

  const [walls, setWalls] = useState<WallSegment[]>(initialSnapshotRef.current.walls);
  const [openings, setOpenings] = useState<Opening[]>(initialSnapshotRef.current.openings);
  const [currentStart, setCurrentStart] = useState<Point | null>(null);
  const [rawMousePos, setRawMousePos] = useState<Point>({ x: 0, y: 0 });
  const [mousePos, setMousePos] = useState<Point>({ x: 0, y: 0 });
  const [previewOpening, setPreviewOpening] = useState<{ position: Point, rotation: number, thickness: number, wallId?: string, offsetAlongWall?: number } | null>(null);
  const [currentThickness, setCurrentThickness] = useState(initialSnapshotRef.current.currentThickness);
  const [activeTool, setActiveTool] = useState<'draw' | 'select' | 'multi-wall' | 'door' | 'window' | 'window-floor' | 'delete'>('draw');
  const [currentOpeningWidth, setCurrentOpeningWidth] = useState(initialSnapshotRef.current.currentOpeningWidth);
  const [showGuide, setShowGuide] = useState(false);
  const [openGuideGroup, setOpenGuideGroup] = useState<GuideGroup | null>(null);
  const [highlightedGuideGroup, setHighlightedGuideGroup] = useState<GuideGroup | null>(null);
  const [sizeInputValue, setSizeInputValue] = useState(() => initialSnapshotRef.current.currentThickness.toFixed(1));
  const [isEditingSizeInput, setIsEditingSizeInput] = useState(false);
  const [displayUnit, setDisplayUnit] = useState<DisplayUnit>('cm');
  const hasBackground = Boolean(imageUrl);
  const [showBackground, setShowBackground] = useState(hasBackground);
  const [backgroundTransform, setBackgroundTransform] = useState<BackgroundTransform>({ x: 0, y: 0, rotation: 0 });
  const [backgroundScale, setBackgroundScale] = useState(hasBackground ? initialSuggestedScale ?? 1 : 1);
  const [isAdjustingBackground, setIsAdjustingBackground] = useState(false);
  const [backgroundDragOrigin, setBackgroundDragOrigin] = useState<{ pointer: Point; transform: BackgroundTransform } | null>(null);
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuide[]>([]);
  const [activeSnapNode, setActiveSnapNode] = useState<SnapNode | null>(null);
  const [isWallLengthInputActive, setIsWallLengthInputActive] = useState(false);
  const [wallLengthInputValue, setWallLengthInputValue] = useState('');
  const [lockedWallDirection, setLockedWallDirection] = useState<LockedWallDirection | null>(null);
  const [continuationDirections, setContinuationDirections] = useState<LockedWallDirection[] | null>(null);
  const [isRoomMeasureMode, setIsRoomMeasureMode] = useState(false);
  const [roomMeasurement, setRoomMeasurement] = useState<RoomMeasurementResult | null>(null);
  const [roomMeasureMessage, setRoomMeasureMessage] = useState<string | null>(null);
  const [isCtrlPressed, setIsCtrlPressed] = useState(false);
  const [isPrintPanelOpen, setIsPrintPanelOpen] = useState(false);
  const [printScale, setPrintScale] = useState<PrintScaleOption>(100);
  const [printOrientation, setPrintOrientation] = useState<PrintOrientation>('portrait');
  const [printFrame, setPrintFrame] = useState<PrintFrame | null>(null);
  const [printStatusMessage, setPrintStatusMessage] = useState<string | null>(null);
  const [draggingPrintFrame, setDraggingPrintFrame] = useState<{ offsetX: number; offsetY: number } | null>(null);
  const [isMobileToolsOpen, setIsMobileToolsOpen] = useState(false);
  const [isMobilePropertiesOpen, setIsMobilePropertiesOpen] = useState(false);
  const [mobileOverlayPanel, setMobileOverlayPanel] = useState<'measure' | 'print' | null>(null);
  
  // Mode & Scaling
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationMode, setCalibrationMode] = useState<'wall' | 'reference'>('wall');
  const [calibrationWallIndex, setCalibrationWallIndex] = useState<number | null>(null);
  const [referenceCalibrationStart, setReferenceCalibrationStart] = useState<Point | null>(null);
  const [referenceCalibrationSegment, setReferenceCalibrationSegment] = useState<CalibrationSegment | null>(null);
  const [realLengthInput, setRealLengthInput] = useState('5');
  
  // Undo/Redo state
  const [history, setHistory] = useState<DrawingSnapshot[]>([initialSnapshotRef.current]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [selectedWallIndex, setSelectedWallIndex] = useState<number | null>(null);
  const [selectedWallIndices, setSelectedWallIndices] = useState<number[]>([]);
  const [selectedOpeningIndex, setSelectedOpeningIndex] = useState<number | null>(null);
  const [draggingPoint, setDraggingPoint] = useState<{ wallIndex: number, type: 'start' | 'end' } | null>(null);
  const [draggingWallGroup, setDraggingWallGroup] = useState<MultiWallDragState | null>(null);
  const [draggingOpening, setDraggingOpening] = useState<number | null>(null);
  const [marqueeSelection, setMarqueeSelection] = useState<MarqueeSelectionState | null>(null);
  const [marqueeMode, setMarqueeMode] = useState<MarqueeMode | null>(null);
  const [pendingMultiWallToggle, setPendingMultiWallToggle] = useState<PendingMultiWallToggle | null>(null);
  
  // View state
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [panMode, setPanMode] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [aspectRatio, setAspectRatio] = useState(1);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const leftToolbarRef = useRef<HTMLDivElement>(null);
  const drawingGuideAnchorRef = useRef<HTMLDivElement>(null);
  const interactionGuideAnchorRef = useRef<HTMLDivElement>(null);
  const environmentGuideAnchorRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const zoomRef = useRef(zoom);
  const offsetRef = useRef(offset);
  const fitFrameRef = useRef<number | null>(null);
  const wallsRef = useRef(walls);
  const openingsRef = useRef(openings);
  const mode: 'trace' | 'scale' = workflowStep === 'trace' ? 'trace' : 'scale';
  const isPrimaryScaleStep = workflowStep === 'scale' && hasBackground && !isScaleCalibrated;
  const isReferenceCalibration = isCalibrating && calibrationMode === 'reference';
  const modeRef = useRef(mode);
  const aspectRatioRef = useRef(aspectRatio);
  const currentThicknessRef = useRef(currentThickness);
  const currentOpeningWidthRef = useRef(currentOpeningWidth);
  const historyIndexRef = useRef(historyIndex);
  const dragSnapshotRef = useRef<DrawingSnapshot | null>(null);
  const selectedWallIndexRef = useRef(selectedWallIndex);
  const selectedWallIndicesRef = useRef(selectedWallIndices);
  const selectedOpeningIndexRef = useRef(selectedOpeningIndex);
  const backgroundTransformRef = useRef(backgroundTransform);
  const backgroundScaleRef = useRef(backgroundScale);
  const guideHighlightTimeoutRef = useRef<number | null>(null);
  const touchPointersRef = useRef<Map<number, TouchPointerInfo>>(new Map());
  const touchPressRef = useRef<TouchPressState | null>(null);
  const touchGestureRef = useRef<TouchGestureState | null>(null);
  const touchLongPressTimeoutRef = useRef<number | null>(null);
  const pendingPointDragRef = useRef<PendingPointDragState | null>(null);
  const [guideViewportTick, setGuideViewportTick] = useState(0);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  useEffect(() => {
    backgroundTransformRef.current = backgroundTransform;
  }, [backgroundTransform]);

  useEffect(() => {
    backgroundScaleRef.current = backgroundScale;
  }, [backgroundScale]);

  useEffect(() => {
    wallsRef.current = walls;
  }, [walls]);

  useEffect(() => {
    openingsRef.current = openings;
  }, [openings]);

  useEffect(() => {
    if (!onProjectChange) {
      return;
    }

    onProjectChange({
      walls: cloneWalls(walls),
      openings: attachOpeningsToWalls(openings, walls),
      suggestedScale: backgroundScale,
      imageAspectRatio: aspectRatio,
    });
  }, [aspectRatio, backgroundScale, onProjectChange, openings, walls]);

  useEffect(() => {
    setRoomMeasurement(null);
    if (!isRoomMeasureMode) {
      setRoomMeasureMessage(null);
    }
  }, [isRoomMeasureMode, openings, walls]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    if (!hasBackground) {
      setShowBackground(false);
      setIsAdjustingBackground(false);
      setBackgroundDragOrigin(null);
      return;
    }

    if (workflowStep === 'trace') {
      setShowBackground(true);
    }
  }, [hasBackground, workflowStep]);

  useEffect(() => {
    aspectRatioRef.current = aspectRatio;
  }, [aspectRatio]);

  useEffect(() => {
    currentThicknessRef.current = currentThickness;
  }, [currentThickness]);

  useEffect(() => {
    currentOpeningWidthRef.current = currentOpeningWidth;
  }, [currentOpeningWidth]);

  useEffect(() => {
    historyIndexRef.current = historyIndex;
  }, [historyIndex]);

  useEffect(() => {
    selectedWallIndexRef.current = selectedWallIndex;
  }, [selectedWallIndex]);

  useEffect(() => {
    selectedWallIndicesRef.current = selectedWallIndices;
  }, [selectedWallIndices]);

  useEffect(() => {
    selectedOpeningIndexRef.current = selectedOpeningIndex;
  }, [selectedOpeningIndex]);

  useEffect(() => {
    return () => {
      if (fitFrameRef.current !== null) {
        cancelAnimationFrame(fitFrameRef.current);
      }
      if (guideHighlightTimeoutRef.current !== null) {
        window.clearTimeout(guideHighlightTimeoutRef.current);
      }
      if (touchLongPressTimeoutRef.current !== null) {
        window.clearTimeout(touchLongPressTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!openGuideGroup) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!leftToolbarRef.current) return;
      if (leftToolbarRef.current.contains(event.target as Node)) return;
      setOpenGuideGroup(null);
    };

    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [openGuideGroup]);

  useEffect(() => {
    const syncCtrlState = (event: KeyboardEvent) => {
      setIsCtrlPressed(event.ctrlKey);
    };

    const resetCtrlState = () => {
      setIsCtrlPressed(false);
    };

    window.addEventListener('keydown', syncCtrlState);
    window.addEventListener('keyup', syncCtrlState);
    window.addEventListener('blur', resetCtrlState);

    return () => {
      window.removeEventListener('keydown', syncCtrlState);
      window.removeEventListener('keyup', syncCtrlState);
      window.removeEventListener('blur', resetCtrlState);
    };
  }, []);

  useEffect(() => {
    if (!openGuideGroup) return;

    const syncGuideViewport = () => setGuideViewportTick((value) => value + 1);

    syncGuideViewport();
    window.addEventListener('resize', syncGuideViewport);
    window.addEventListener('scroll', syncGuideViewport, true);
    return () => {
      window.removeEventListener('resize', syncGuideViewport);
      window.removeEventListener('scroll', syncGuideViewport, true);
    };
  }, [openGuideGroup]);

  const createSnapshot = useCallback((snapshot?: Partial<DrawingSnapshot>): DrawingSnapshot => {
    const nextWalls = cloneWalls(snapshot?.walls ?? wallsRef.current);
    return {
      walls: nextWalls,
      openings: attachOpeningsToWalls(snapshot?.openings ?? openingsRef.current, nextWalls),
      currentThickness: snapshot?.currentThickness ?? currentThicknessRef.current,
      currentOpeningWidth: snapshot?.currentOpeningWidth ?? currentOpeningWidthRef.current,
    };
  }, []);

  const applySelection = useCallback((selection?: SelectionState | null) => {
    if (!selection) {
      setSelectedWallIndex(null);
      setSelectedOpeningIndex(null);
      setSelectedWallIndices([]);
      return;
    }

    setSelectedWallIndex(selection.selectedWallIndex);
    setSelectedOpeningIndex(selection.selectedOpeningIndex);
    setSelectedWallIndices(selection.selectedWallIndices ?? []);
  }, []);

  const applySnapshot = useCallback((snapshot: DrawingSnapshot, selection?: SelectionState | null) => {
    const safeSnapshot = createSnapshot(snapshot);
    setWalls(safeSnapshot.walls);
    setOpenings(safeSnapshot.openings);
    setCurrentThickness(safeSnapshot.currentThickness);
    setCurrentOpeningWidth(safeSnapshot.currentOpeningWidth);
    setCurrentStart(null);
    setContinuationDirections(null);
    setActiveSnapNode(null);
    setAlignmentGuides([]);
    applySelection(selection ?? null);
    setDraggingPoint(null);
    setDraggingWallGroup(null);
    setDraggingOpening(null);
    setMarqueeSelection(null);
    setMarqueeMode(null);
    setPendingMultiWallToggle(null);
  }, [applySelection, createSnapshot]);

  const pushHistorySnapshot = useCallback((snapshot: Partial<DrawingSnapshot>, options?: { selection?: SelectionState | null }) => {
    const committedSnapshot = createSnapshot(snapshot);
    setHistory((prev) => {
      const nextHistory = prev.slice(0, historyIndexRef.current + 1);
      nextHistory.push(committedSnapshot);
      return nextHistory;
    });
    setHistoryIndex((prev) => prev + 1);
    historyIndexRef.current += 1;
    applySnapshot(committedSnapshot, options?.selection ?? null);
  }, [applySnapshot, createSnapshot]);

  const getSelectionState = useCallback((): SelectionState => {
    return {
      selectedWallIndex: selectedWallIndexRef.current,
      selectedOpeningIndex: selectedOpeningIndexRef.current,
      selectedWallIndices: selectedWallIndicesRef.current,
    };
  }, []);

  const getControlContext = useCallback((): 'wall' | 'opening' => {
    if (activeTool === 'multi-wall') return 'wall';
    if (selectedOpeningIndex !== null) return 'opening';
    if (selectedWallIndex !== null) return 'wall';
    if (activeTool === 'door' || activeTool === 'window' || activeTool === 'window-floor') return 'opening';
    return 'wall';
  }, [activeTool, selectedOpeningIndex, selectedWallIndex]);

  const getMultiWallThicknessValue = useCallback(() => {
    if (selectedWallIndices.length === 0) return null;
    const firstWall = walls[selectedWallIndices[0]];
    if (!firstWall) return null;
    const firstThickness = firstWall.thickness;
    const hasMixedThickness = selectedWallIndices.some((wallIndex) => walls[wallIndex]?.thickness !== firstThickness);
    return hasMixedThickness ? null : firstThickness;
  }, [selectedWallIndices, walls]);

  const getControlValue = useCallback(() => {
    if (activeTool === 'multi-wall' && selectedWallIndices.length > 0) {
      return getMultiWallThicknessValue() ?? currentThickness;
    }
    return getControlContext() === 'opening' ? currentOpeningWidth : currentThickness;
  }, [activeTool, currentOpeningWidth, currentThickness, getControlContext, getMultiWallThicknessValue, selectedWallIndices.length]);

  const getControlLabel = useCallback(() => {
    return getControlContext() === 'opening' ? 'WIDTH' : 'THICK';
  }, [getControlContext]);

  const getSelectionCountLabel = useCallback(() => {
    if (activeTool === 'multi-wall' && selectedWallIndices.length > 0) {
      return `${selectedWallIndices.length} wall${selectedWallIndices.length > 1 ? 's' : ''}`;
    }
    return null;
  }, [activeTool, selectedWallIndices.length]);

  const toDisplayUnits = useCallback((valueInCm: number) => {
    return displayUnit === 'm' ? valueInCm / 100 : valueInCm;
  }, [displayUnit]);

  const fromDisplayUnits = useCallback((value: number) => {
    return displayUnit === 'm' ? value * 100 : value;
  }, [displayUnit]);

  const formatDisplayValue = useCallback((valueInCm: number) => {
    const precision = displayUnit === 'm' ? 2 : 1;
    return toDisplayUnits(valueInCm).toFixed(precision);
  }, [displayUnit, toDisplayUnits]);

  const getUnitStep = useCallback((context: 'wall' | 'opening', direction: 'increase' | 'decrease') => {
    const openingDelta = direction === 'increase' ? 10 : -10;
    const wallDelta = direction === 'increase' ? 5 : -5;
    const deltaInCm = context === 'opening' ? openingDelta : wallDelta;
    return displayUnit === 'm' ? deltaInCm / 100 : deltaInCm;
  }, [displayUnit]);

  const getWallLength = useCallback((wall: WallSegment) => {
    return Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
  }, []);

  const getCalibrationReferenceLength = useCallback((wall: WallSegment) => {
    return getInteriorCalibrationSpanLength(wall, walls);
  }, [walls]);

  const getSelectedWallsTotalLength = useCallback(() => {
    return selectedWallIndices.reduce((total, wallIndex) => {
      const wall = walls[wallIndex];
      return wall ? total + getWallLength(wall) : total;
    }, 0);
  }, [getWallLength, selectedWallIndices, walls]);

  const getViewportCenterInWorld = useCallback(() => {
    if (!containerRef.current) {
      return { x: 0, y: 0 };
    }

    const rect = containerRef.current.getBoundingClientRect();
    const currentCanvasHeight = mode === 'trace' ? TRACE_CANVAS_HEIGHT : SCALE_CANVAS_HEIGHT;

    return {
      x: (rect.width / 2 - offsetRef.current.x) / zoomRef.current,
      y: currentCanvasHeight - (rect.height / 2 - offsetRef.current.y) / zoomRef.current,
    };
  }, [mode]);

  const isPrintModeActive = Boolean(printFrame);

  const selectedWallsRotationPivot = React.useMemo(() => {
    if (selectedWallIndices.length < 2) {
      return null;
    }

    const selectedWalls = selectedWallIndices
      .map((wallIndex) => walls[wallIndex])
      .filter((wall): wall is WallSegment => Boolean(wall));

    if (selectedWalls.length < 2) {
      return null;
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    selectedWalls.forEach((wall) => {
      minX = Math.min(minX, wall.start.x, wall.end.x);
      minY = Math.min(minY, wall.start.y, wall.end.y);
      maxX = Math.max(maxX, wall.start.x, wall.end.x);
      maxY = Math.max(maxY, wall.start.y, wall.end.y);
    });

    return {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
    };
  }, [selectedWallIndices, walls]);

  const isMultiWallRotationMode = activeTool === 'multi-wall' && selectedWallIndices.length > 1 && isCtrlPressed;

  const formatMetersValue = useCallback((valueInCm: number) => {
    return (valueInCm / 100).toFixed(2);
  }, []);

  const formatSquareMetersValue = useCallback((valueInCm2: number) => {
    return (valueInCm2 / 10000).toFixed(2);
  }, []);

  const roomFaces = React.useMemo(() => buildClosedRoomFaces(walls), [walls]);

  const measureRoomAtPoint = useCallback((point: Point) => {
    const containingFaces = roomFaces
      .map((face) => {
        const area = getPolygonArea(face);
        return {
          face,
          area: Math.abs(area),
        };
      })
      .filter(({ face, area }) => area > ROOM_GRAPH_EPSILON && isPointInsidePolygon(point, face))
      .sort((a, b) => a.area - b.area);

    const roomFace = containingFaces[0]?.face;
    if (!roomFace) {
      return null;
    }

    const perimeterCm = roomFace.reduce((total, vertex, index) => {
      const next = roomFace[(index + 1) % roomFace.length];
      return total + Math.hypot(next.x - vertex.x, next.y - vertex.y);
    }, 0);

    return {
      perimeterCm,
      areaCm2: Math.abs(getPolygonArea(roomFace)),
      polygon: roomFace,
    };
  }, [roomFaces]);

  const resetWallLengthInput = useCallback(() => {
    setIsWallLengthInputActive(false);
    setWallLengthInputValue('');
    setLockedWallDirection(null);
  }, []);

  const sanitizeWallLengthInput = useCallback((value: string) => {
    const normalized = value.replace(',', '.').replace(/[^0-9.]/g, '');
    const [integerPart = '', ...decimalParts] = normalized.split('.');
    const decimalPart = decimalParts.join('').slice(0, 2);
    if (normalized.includes('.')) {
      return `${integerPart}.${decimalPart}`;
    }
    return integerPart;
  }, []);

  const getWallLengthInputChar = useCallback((event: KeyboardEvent) => {
    if (/^Digit[0-9]$/.test(event.code)) {
      return event.code.replace('Digit', '');
    }

    if (/^Numpad[0-9]$/.test(event.code)) {
      return event.code.replace('Numpad', '');
    }

    if (event.code === 'NumpadDecimal' || event.key === '.' || event.key === ',') {
      return '.';
    }

    return null;
  }, []);

  const parseWallLengthMeters = useCallback((value: string) => {
    const parsed = parseFloat(value);
    if (Number.isNaN(parsed) || parsed <= 0) return null;
    return parsed;
  }, []);

  const getTraceImageBounds = useCallback(() => {
    if (!imageUrl) return null;

    const height = TRACE_IMAGE_BASE_HEIGHT * backgroundScaleRef.current;
    const width = height * aspectRatioRef.current;

    return {
      x: 0,
      y: 0,
      width,
      height,
    };
  }, [imageUrl]);

  const resetBackgroundTransform = useCallback(() => {
    setBackgroundTransform((prev) => ({
      ...prev,
      rotation: 0,
    }));
    setBackgroundDragOrigin(null);
  }, []);

  const rotateBackground = useCallback((delta: number) => {
    setBackgroundTransform((prev) => ({
      ...prev,
      rotation: prev.rotation + delta,
    }));
  }, []);

  const getSnapNodes = useCallback((excludeWallIndex?: number, excludeWallIndices?: number[]): SnapNode[] => {
    const nodes: SnapNode[] = [];
    const excluded = new Set<number>(excludeWallIndices ?? []);
    if (excludeWallIndex !== undefined) {
      excluded.add(excludeWallIndex);
    }
    walls.forEach((wall, idx) => {
      if (excluded.has(idx)) return;
      nodes.push(
        { point: wall.start, kind: 'endpoint' },
        { point: wall.end, kind: 'endpoint' },
        {
          point: {
            x: (wall.start.x + wall.end.x) / 2,
            y: (wall.start.y + wall.end.y) / 2,
          },
          kind: 'midpoint',
        }
      );
    });
    return nodes;
  }, [walls]);

  const getContinuationDirectionsForPoint = useCallback((point: Point, sourceWalls: WallSegment[] = wallsRef.current) => {
    const directions: LockedWallDirection[] = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ];

    sourceWalls.forEach((wall) => {
      if (isSamePoint(wall.start, point)) {
        const baseDirection = normalizeDirection(wall.start, wall.end);
        if (!baseDirection) return;
        directions.push(
          baseDirection,
          { x: -baseDirection.x, y: -baseDirection.y },
          { x: -baseDirection.y, y: baseDirection.x },
          { x: baseDirection.y, y: -baseDirection.x },
          rotateDirection(baseDirection, Math.PI / 4),
          rotateDirection(baseDirection, -Math.PI / 4),
          rotateDirection(baseDirection, (3 * Math.PI) / 4),
          rotateDirection(baseDirection, (-3 * Math.PI) / 4),
        );
      } else if (isSamePoint(wall.end, point)) {
        const baseDirection = normalizeDirection(wall.end, wall.start);
        if (!baseDirection) return;
        directions.push(
          baseDirection,
          { x: -baseDirection.x, y: -baseDirection.y },
          { x: -baseDirection.y, y: baseDirection.x },
          { x: baseDirection.y, y: -baseDirection.x },
          rotateDirection(baseDirection, Math.PI / 4),
          rotateDirection(baseDirection, -Math.PI / 4),
          rotateDirection(baseDirection, (3 * Math.PI) / 4),
          rotateDirection(baseDirection, (-3 * Math.PI) / 4),
        );
      }
    });

    const uniqueDirections = dedupeDirections(directions);
    return uniqueDirections.length > 4 ? uniqueDirections : null;
  }, []);

  const getOpeningMetricsOnWall = useCallback((wall: WallSegment, position: Point) => {
    const metrics = getAttachmentForWall(wall, position);
    if (!metrics) return null;
    return {
      wallId: metrics.wallId,
      offsetAlongWall: metrics.offsetAlongWall,
      position: metrics.position,
      rotation: metrics.rotation,
      thickness: metrics.thickness,
    };
  }, []);

  const resolveOpening = useCallback((opening: Opening, walls: WallSegment[] = wallsRef.current): ResolvedOpening => {
    if (opening.wallId) {
      const wall = walls.find((candidate) => candidate.id === opening.wallId);
      if (wall && opening.offsetAlongWall !== undefined) {
        const dx = wall.end.x - wall.start.x;
        const dy = wall.end.y - wall.start.y;
        const t = Math.max(0, Math.min(1, opening.offsetAlongWall));
        return {
          ...opening,
          position: {
            x: wall.start.x + dx * t,
            y: wall.start.y + dy * t,
          },
          rotation: THREE.MathUtils.radToDeg(Math.atan2(dy, dx)),
          thickness: wall.thickness,
        };
      }
    }

    return {
      ...opening,
      position: opening.position,
      rotation: opening.rotation,
      thickness: opening.thickness || 20,
    };
  }, []);

  const getRelativePosFromClient = useCallback((clientX: number, clientY: number): Point => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const canvasHeight = mode === 'trace' ? TRACE_CANVAS_HEIGHT : SCALE_CANVAS_HEIGHT;
    const rect = containerRef.current.getBoundingClientRect();
    const x = (clientX - rect.left - offset.x) / zoom;
    const y = canvasHeight - (clientY - rect.top - offset.y) / zoom;
    return { x, y };
  }, [mode, offset.x, offset.y, zoom]);

  const getRelativePos = useCallback((e: React.MouseEvent | MouseEvent): Point => {
    return getRelativePosFromClient(e.clientX, e.clientY);
  }, [getRelativePosFromClient]);

  const worldToScreen = useCallback((point: Point) => {
    const canvasHeight = mode === 'trace' ? TRACE_CANVAS_HEIGHT : SCALE_CANVAS_HEIGHT;
    return {
      x: point.x * zoomRef.current + offsetRef.current.x,
      y: (canvasHeight - point.y) * zoomRef.current + offsetRef.current.y,
    };
  }, [mode]);

  const clampZoom = useCallback((value: number) => {
    return Math.min(Math.max(value, MIN_ZOOM), MAX_ZOOM);
  }, []);

  const getWorldUnitsPerScreenPixel = useCallback(() => {
    return 1 / (zoomRef.current || 1);
  }, []);

  const getWorldDistanceForPixels = useCallback((pixels: number) => {
    return pixels * getWorldUnitsPerScreenPixel();
  }, [getWorldUnitsPerScreenPixel]);

  const getOpeningRenderMetrics = useCallback((opening: ResolvedOpening): OpeningRenderMetrics => {
    const worldUnitsPerPixel = getWorldUnitsPerScreenPixel();
    const openingThickness = opening.thickness || 20;
    const minHitSize = OPENING_MIN_HIT_SIZE_PX * worldUnitsPerPixel;
    const hitPadding = OPENING_HIT_PADDING_PX * worldUnitsPerPixel;
    const bodyHeight = Math.max(openingThickness, minHitSize);
    const hitWidth = Math.max(opening.width, minHitSize) + hitPadding * 2;
    const hitHeight = bodyHeight + hitPadding * 2;
    const lineInset = Math.min(opening.width * 0.08, Math.max(3 * worldUnitsPerPixel, opening.width * 0.025));
    const maxWindowOffset = Math.max(bodyHeight / 2 - 2 * worldUnitsPerPixel, 0);
    const preferredWindowOffset = bodyHeight * 0.1;
    const windowLineOffset = Math.min(preferredWindowOffset, maxWindowOffset);

    return {
      bodyHeight,
      hitWidth,
      hitHeight,
      lineInset,
      windowLineOffset,
    };
  }, [getWorldUnitsPerScreenPixel]);

  const isPointInsideOpening = useCallback((pos: Point, opening: ResolvedOpening) => {
    const metrics = getOpeningRenderMetrics(opening);
    const angle = THREE.MathUtils.degToRad(opening.rotation);
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const localX = (pos.x - opening.position.x) * cos - (pos.y - opening.position.y) * sin;
    const localY = (pos.x - opening.position.x) * sin + (pos.y - opening.position.y) * cos;

    const halfHitWidth = metrics.hitWidth / 2;
    const halfHitHeight = metrics.hitHeight / 2;
    return Math.abs(localX) <= halfHitWidth && Math.abs(localY) <= halfHitHeight;
  }, [getOpeningRenderMetrics]);

  const getVectorBounds = useCallback(() => {
    const walls = wallsRef.current;
    const openings = openingsRef.current;
    if (walls.length === 0 && openings.length === 0) return null;

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    walls.forEach((wall) => {
      const halfThickness = wall.thickness / 2;
      minX = Math.min(minX, wall.start.x - halfThickness, wall.end.x - halfThickness);
      minY = Math.min(minY, wall.start.y - halfThickness, wall.end.y - halfThickness);
      maxX = Math.max(maxX, wall.start.x + halfThickness, wall.end.x + halfThickness);
      maxY = Math.max(maxY, wall.start.y + halfThickness, wall.end.y + halfThickness);
    });

    openings.forEach((opening) => {
      const resolvedOpening = resolveOpening(opening, walls);
      const halfWidth = resolvedOpening.width / 2;
      const halfThickness = (resolvedOpening.thickness || 20) / 2;
      minX = Math.min(minX, resolvedOpening.position.x - halfWidth, resolvedOpening.position.x - halfThickness);
      minY = Math.min(minY, resolvedOpening.position.y - halfWidth, resolvedOpening.position.y - halfThickness);
      maxX = Math.max(maxX, resolvedOpening.position.x + halfWidth, resolvedOpening.position.x + halfThickness);
      maxY = Math.max(maxY, resolvedOpening.position.y + halfWidth, resolvedOpening.position.y + halfThickness);
    });

    return { minX, minY, maxX, maxY };
  }, [resolveOpening]);

  const getContentBounds = useCallback(() => {
    const vectorBounds = getVectorBounds();
    const currentMode = modeRef.current;
    const canvasHeight = currentMode === 'trace' ? TRACE_CANVAS_HEIGHT : SCALE_CANVAS_HEIGHT;

    if (vectorBounds) {
      return {
        x: vectorBounds.minX,
        y: canvasHeight - vectorBounds.maxY,
        width: Math.max(vectorBounds.maxX - vectorBounds.minX, 1),
        height: Math.max(vectorBounds.maxY - vectorBounds.minY, 1),
      };
    }

    const imageBounds = getTraceImageBounds();
    if (imageBounds) {
      const rotatedBounds = getRotatedBounds(imageBounds.width, imageBounds.height, backgroundTransformRef.current);
      return {
        x: rotatedBounds.minX,
        y: canvasHeight - rotatedBounds.maxY,
        width: Math.max(rotatedBounds.maxX - rotatedBounds.minX, 1),
        height: Math.max(rotatedBounds.maxY - rotatedBounds.minY, 1),
      };
    }

    const neutralBoxSize = 2000;
    return {
      x: ((currentMode === 'trace' ? TRACE_CANVAS_WIDTH : SCALE_CANVAS_WIDTH) - neutralBoxSize) / 2,
      y: (canvasHeight - neutralBoxSize) / 2,
      width: neutralBoxSize,
      height: neutralBoxSize,
    };
  }, [getTraceImageBounds, getVectorBounds]);

  const fitToView = useCallback(() => {
    if (!containerRef.current) return;

    const bounds = getContentBounds();
    if (!bounds) return;

    const container = containerRef.current.getBoundingClientRect();
    const availableWidth = Math.max(container.width - FIT_PADDING * 2, 1);
    const availableHeight = Math.max(container.height - FIT_PADDING * 2, 1);
    const nextZoom = clampZoom(Math.min(
      availableWidth / Math.max(bounds.width, 1),
      availableHeight / Math.max(bounds.height, 1)
    ));

    const nextOffset = {
      x: (container.width - bounds.width * nextZoom) / 2 - bounds.x * nextZoom,
      y: (container.height - bounds.height * nextZoom) / 2 - bounds.y * nextZoom,
    };

    zoomRef.current = nextZoom;
    offsetRef.current = nextOffset;
    setZoom(nextZoom);
    setOffset(nextOffset);
  }, [clampZoom, getContentBounds]);

  const scheduleFitToView = useCallback(() => {
    if (fitFrameRef.current !== null) {
      cancelAnimationFrame(fitFrameRef.current);
    }

    fitFrameRef.current = requestAnimationFrame(() => {
      fitFrameRef.current = requestAnimationFrame(() => {
        fitToView();
      });
    });
  }, [fitToView]);

  const zoomAtPoint = useCallback((nextZoom: number, clientX: number, clientY: number) => {
    if (!containerRef.current) return;

    const clampedZoom = clampZoom(nextZoom);
    const container = containerRef.current.getBoundingClientRect();
    const pointerX = clientX - container.left;
    const pointerY = clientY - container.top;
    const worldX = (pointerX - offsetRef.current.x) / zoomRef.current;
    const worldY = (pointerY - offsetRef.current.y) / zoomRef.current;

    const nextOffset = {
      x: pointerX - worldX * clampedZoom,
      y: pointerY - worldY * clampedZoom,
    };

    zoomRef.current = clampedZoom;
    offsetRef.current = nextOffset;
    setZoom(clampedZoom);
    setOffset(nextOffset);
  }, [clampZoom]);

  useEffect(() => {
    if (!imgRef.current) return;

    const img = imgRef.current;
    const handleLoad = () => {
      if (img.naturalHeight > 0) {
        setAspectRatio(img.naturalWidth / img.naturalHeight);
      }
      scheduleFitToView();
    };

    if (img.complete) {
      handleLoad();
    } else {
      img.addEventListener('load', handleLoad);
      return () => img.removeEventListener('load', handleLoad);
    }
  }, [scheduleFitToView]);

  const getSnapResult = useCallback((pos: Point, isShiftPressed: boolean, options?: SnapResolverOptions): SnapResult => {
    const anchor = options?.anchor ?? null;
    const allowAlignment = options?.allowAlignment ?? true;
    const allNodes = getSnapNodes(options?.excludeWallIndex, options?.excludeWallIndices);
    const pointSnapRadius = getWorldDistanceForPixels(POINT_SNAP_RADIUS_PX);
    const alignmentSnapRadius = getWorldDistanceForPixels(ALIGNMENT_SNAP_RADIUS_PX);

    let snapped = { ...pos };
    let snappedNode: SnapNode | null = null;

    const endpointCandidates = allNodes.filter((node) => node.kind === 'endpoint');
    const midpointCandidates = allNodes.filter((node) => node.kind === 'midpoint');

    const findClosestNode = (nodes: SnapNode[]) => {
      let closest: SnapNode | null = null;
      let minDistance = pointSnapRadius;

      nodes.forEach((node) => {
        const dist = Math.hypot(node.point.x - pos.x, node.point.y - pos.y);
        if (dist < minDistance) {
          minDistance = dist;
          closest = node;
        }
      });

      return closest;
    };

    const endpointMatch = findClosestNode(endpointCandidates);
    const midpointMatch = endpointMatch ? null : findClosestNode(midpointCandidates);

    if (endpointMatch || midpointMatch) {
      snappedNode = endpointMatch ?? midpointMatch;
      snapped = { ...snappedNode.point };
    }

    if (!snappedNode && isShiftPressed && anchor) {
      const directionPool = continuationDirections ?? options?.continuationDirections ?? null;
      snapped = constrainPointToDirections(anchor, snapped, directionPool);
    }

    const guides: AlignmentGuide[] = [];
    if (!snappedNode && allowAlignment) {
      let bestX: number | null = null;
      let bestY: number | null = null;
      let minXDelta = alignmentSnapRadius;
      let minYDelta = alignmentSnapRadius;

      allNodes.forEach((node) => {
        const xDelta = Math.abs(node.point.x - snapped.x);
        if (xDelta < minXDelta) {
          minXDelta = xDelta;
          bestX = node.point.x;
        }

        const yDelta = Math.abs(node.point.y - snapped.y);
        if (yDelta < minYDelta) {
          minYDelta = yDelta;
          bestY = node.point.y;
        }
      });

      if (bestX !== null) {
        snapped.x = bestX;
        guides.push({ axis: 'x', value: bestX });
      }

      if (bestY !== null) {
        snapped.y = bestY;
        guides.push({ axis: 'y', value: bestY });
      }
    }

    return { point: snapped, guides, snappedNode };
  }, [continuationDirections, getSnapNodes, getWorldDistanceForPixels]);

  const getCurrentWallPreviewPoint = useCallback((): Point | null => {
    if (!currentStart) return null;
    if (!isWallLengthInputActive || !lockedWallDirection) {
      return mousePos;
    }

    const typedMeters = parseWallLengthMeters(wallLengthInputValue);
    const lengthCm = typedMeters !== null ? typedMeters * 100 : 0;
    return {
      x: currentStart.x + lockedWallDirection.x * lengthCm,
      y: currentStart.y + lockedWallDirection.y * lengthCm,
    };
  }, [currentStart, isWallLengthInputActive, lockedWallDirection, mousePos, parseWallLengthMeters, wallLengthInputValue]);

  const commitWallSegment = useCallback((endPoint: Point) => {
    if (!currentStart) return;

    const newWall: WallSegment = {
      id: createWallId(),
      start: currentStart,
      end: endPoint,
      thickness: currentThickness,
    };

    const nextWalls = [...wallsRef.current, newWall];
    pushHistorySnapshot({
      walls: nextWalls,
    });
    setCurrentStart(endPoint);
    setContinuationDirections(getContinuationDirectionsForPoint(endPoint, nextWalls));
    setActiveSnapNode(null);
    setAlignmentGuides([]);
    setSelectedWallIndex(null);
    setSelectedOpeningIndex(null);
    resetWallLengthInput();
  }, [currentStart, currentThickness, getContinuationDirectionsForPoint, pushHistorySnapshot, resetWallLengthInput]);

  const getPreviewWallLengthCm = useCallback(() => {
    const previewPoint = getCurrentWallPreviewPoint();
    if (!currentStart || !previewPoint) return null;
    return Math.hypot(previewPoint.x - currentStart.x, previewPoint.y - currentStart.y);
  }, [currentStart, getCurrentWallPreviewPoint]);

  const getReferenceCalibrationPreviewPoint = useCallback(() => {
    if (!referenceCalibrationStart) return null;
    const snapResult = getSnapResult(rawMousePos, false, {
      anchor: referenceCalibrationStart,
      allowAlignment: true,
    });
    return snapResult.point;
  }, [getSnapResult, rawMousePos, referenceCalibrationStart]);

  const getDisplayedWallLength = useCallback(() => {
    if (isWallLengthInputActive) {
      return wallLengthInputValue;
    }

    if (currentStart && activeTool === 'draw' && mode === 'scale') {
      const previewLength = getPreviewWallLengthCm();
      return previewLength !== null ? formatMetersValue(previewLength) : '--';
    }

    if (activeTool === 'multi-wall' && selectedWallIndices.length > 0) {
      return formatMetersValue(getSelectedWallsTotalLength());
    }

    if (selectedWallIndex !== null && walls[selectedWallIndex]) {
      return formatMetersValue(getWallLength(walls[selectedWallIndex]));
    }

    return '--';
  }, [
    activeTool,
    currentStart,
    formatMetersValue,
    getPreviewWallLengthCm,
    getSelectedWallsTotalLength,
    getWallLength,
    isWallLengthInputActive,
    mode,
    selectedWallIndex,
    selectedWallIndices.length,
    wallLengthInputValue,
    walls,
  ]);

  const rotateSelectedWalls = useCallback((direction: 'ccw' | 'cw') => {
    if (!selectedWallsRotationPivot || selectedWallIndices.length < 2) {
      return;
    }

    const angleRad =
      THREE.MathUtils.degToRad(MULTI_WALL_ROTATION_STEP_DEGREES) * (direction === 'ccw' ? -1 : 1);

    const rotatedWalls = walls.map((wall, wallIndex) => {
      if (!selectedWallIndices.includes(wallIndex)) {
        return wall;
      }

      return {
        ...wall,
        start: rotatePointAroundPivot(wall.start, selectedWallsRotationPivot, angleRad),
        end: rotatePointAroundPivot(wall.end, selectedWallsRotationPivot, angleRad),
      };
    });

    pushHistorySnapshot(
      {
        walls: rotatedWalls,
      },
      {
        selection: {
          selectedWallIndex: null,
          selectedOpeningIndex: null,
          selectedWallIndices: [...selectedWallIndices],
        },
      },
    );
  }, [pushHistorySnapshot, selectedWallIndices, selectedWallsRotationPivot, walls]);

  const cancelPrintMode = useCallback(() => {
    setPrintFrame(null);
    setDraggingPrintFrame(null);
    setPrintStatusMessage(null);
    setIsPrintPanelOpen(false);
  }, []);

  const startPrintMode = useCallback((nextScale: PrintScaleOption, nextOrientation: PrintOrientation) => {
    const dimensions = getPrintFrameDimensions(nextScale, nextOrientation);
    const center = getViewportCenterInWorld();

    setPrintScale(nextScale);
    setPrintOrientation(nextOrientation);
    setPrintFrame({
      x: center.x - dimensions.width / 2,
      y: center.y - dimensions.height / 2,
      width: dimensions.width,
      height: dimensions.height,
      scale: nextScale,
      orientation: nextOrientation,
    });
    setPrintStatusMessage('Print mode: position the A4 frame, then export the PDF.');
    setIsPrintPanelOpen(true);
    setCurrentStart(null);
    setContinuationDirections(null);
    setAlignmentGuides([]);
    setActiveSnapNode(null);
    setDraggingPoint(null);
    setDraggingWallGroup(null);
    setDraggingOpening(null);
    setMarqueeSelection(null);
    setMarqueeMode(null);
    setPendingMultiWallToggle(null);
    setSelectedWallIndex(null);
    setSelectedOpeningIndex(null);
    setSelectedWallIndices([]);
    setIsRoomMeasureMode(false);
    setRoomMeasureMessage(null);
    resetWallLengthInput();
  }, [getViewportCenterInWorld, resetWallLengthInput]);

  const handleExportA4Pdf = useCallback(async () => {
    if (!printFrame) {
      return;
    }

    try {
      const orientation = printFrame.orientation;
      const pageWidthPx = orientation === 'portrait' ? 2480 : 3508;
      const pageHeightPx = orientation === 'portrait' ? 3508 : 2480;
      const scaleX = pageWidthPx / printFrame.width;
      const scaleY = pageHeightPx / printFrame.height;
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = pageWidthPx;
      exportCanvas.height = pageHeightPx;
      const context = exportCanvas.getContext('2d');

      if (!context) {
        throw new Error('No 2D context available.');
      }

      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, pageWidthPx, pageHeightPx);

      const worldToCanvas = (point: Point) => ({
        x: (point.x - printFrame.x) * scaleX,
        y: pageHeightPx - (point.y - printFrame.y) * scaleY,
      });

      const traceBounds = getTraceImageBounds();
      if (showBackground && imageUrl && traceBounds && imgRef.current?.complete) {
        context.save();
        context.globalAlpha = workflowStep === 'trace' ? 0.92 : 0.35;

        const centerX = backgroundTransform.x + traceBounds.width / 2;
        const centerY = backgroundTransform.y + traceBounds.height / 2;
        const canvasCenter = worldToCanvas({ x: centerX, y: centerY });

        context.translate(canvasCenter.x, canvasCenter.y);
        context.rotate((-backgroundTransform.rotation * Math.PI) / 180);
        context.scale(1, -1);
        context.drawImage(
          imgRef.current,
          -traceBounds.width * scaleX / 2,
          -traceBounds.height * scaleY / 2,
          traceBounds.width * scaleX,
          traceBounds.height * scaleY,
        );
        context.restore();
      }

      if (roomMeasurement?.polygon) {
        context.save();
        context.fillStyle = 'rgba(203, 187, 160, 0.22)';
        context.strokeStyle = 'rgba(140, 115, 85, 0.35)';
        context.lineWidth = 8 * scaleX;
        context.beginPath();
        roomMeasurement.polygon.forEach((point, index) => {
          const mapped = worldToCanvas(point);
          if (index === 0) context.moveTo(mapped.x, mapped.y);
          else context.lineTo(mapped.x, mapped.y);
        });
        context.closePath();
        context.fill();
        context.stroke();
        context.restore();
      }

      walls.forEach((wall, index) => {
        const start = worldToCanvas(wall.start);
        const end = worldToCanvas(wall.end);
        const isSingleSelected = selectedWallIndex === index;
        const isMultiSelected = selectedWallIndices.includes(index);

        context.save();
        context.strokeStyle = isSingleSelected ? '#10b981' : isMultiSelected ? '#8C7355' : '#141414';
        context.globalAlpha = isSingleSelected ? 0.9 : isMultiSelected ? 0.88 : 0.8;
        context.lineWidth = wall.thickness * scaleX;
        context.lineCap = 'butt';
        context.beginPath();
        context.moveTo(start.x, start.y);
        context.lineTo(end.x, end.y);
        context.stroke();
        context.restore();
      });

      openings.forEach((opening, index) => {
        const resolvedOpening = resolveOpening(opening, walls);
        const metrics = getOpeningRenderMetrics(resolvedOpening);
        const center = worldToCanvas(resolvedOpening.position);
        const rotation = (-resolvedOpening.rotation * Math.PI) / 180;
        const isSelected = selectedOpeningIndex === index;

        context.save();
        context.translate(center.x, center.y);
        context.rotate(rotation);
        context.fillStyle = '#ffffff';
        context.globalAlpha = isSelected ? 1 : 0.92;
        context.fillRect(
          -resolvedOpening.width * scaleX / 2,
          -metrics.bodyHeight * scaleY / 2,
          resolvedOpening.width * scaleX,
          metrics.bodyHeight * scaleY,
        );

        if (resolvedOpening.type === 'window' || resolvedOpening.type === 'window-floor') {
          context.strokeStyle = isSelected ? OPENING_SELECTION_COLOR : '#141414';
          context.lineWidth = 1.5 * scaleX;
          context.beginPath();
          context.moveTo(
            (-resolvedOpening.width / 2 + metrics.lineInset) * scaleX,
            -metrics.windowLineOffset * scaleY,
          );
          context.lineTo(
            (resolvedOpening.width / 2 - metrics.lineInset) * scaleX,
            -metrics.windowLineOffset * scaleY,
          );
          if (resolvedOpening.type === 'window') {
            context.moveTo(
              (-resolvedOpening.width / 2 + metrics.lineInset) * scaleX,
              metrics.windowLineOffset * scaleY,
            );
            context.lineTo(
              (resolvedOpening.width / 2 - metrics.lineInset) * scaleX,
              metrics.windowLineOffset * scaleY,
            );
          }
          context.stroke();
        }

        context.restore();
      });

      const jpegDataUrl = exportCanvas.toDataURL('image/jpeg', 0.95);
      const jpegBytes = dataUrlToUint8Array(jpegDataUrl);
      const pdfBlob = buildSinglePagePdfFromJpeg(jpegBytes, pageWidthPx, pageHeightPx, orientation);
      const timestamp = `${new Date().toISOString().slice(0, 10)}-${new Date().toTimeString().slice(0, 8).replace(/:/g, '')}`;
      const fileName = `planities-a4-1-${printFrame.scale}-${printFrame.orientation}-${timestamp}.pdf`;
      const url = URL.createObjectURL(pdfBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('PDF export failed:', error);
      setPrintStatusMessage('PDF export failed.');
    }
  }, [
    getOpeningRenderMetrics,
    getTraceImageBounds,
    imageUrl,
    openings,
    printFrame,
    resolveOpening,
    roomMeasurement?.polygon,
    selectedOpeningIndex,
    selectedWallIndex,
    selectedWallIndices,
    showBackground,
    walls,
    workflowStep,
  ]);

  const findWallAt = useCallback((pos: Point, input: InputPrecision = 'mouse'): number | null => {
    let bestWallIndex: number | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    const hitPaddingWorld = getWorldDistanceForPixels(getWallSegmentHitPaddingPx(input));

    for (let i = 0; i < walls.length; i++) {
      const wall = walls[i];
      // Distance from point to line segment
      const l2 = Math.pow(wall.start.x - wall.end.x, 2) + Math.pow(wall.start.y - wall.end.y, 2);
      if (l2 === 0) continue;
      let t = ((pos.x - wall.start.x) * (wall.end.x - wall.start.x) + (pos.y - wall.start.y) * (wall.end.y - wall.start.y)) / l2;
      t = Math.max(0, Math.min(1, t));
      const dist = Math.sqrt(
        Math.pow(pos.x - (wall.start.x + t * (wall.end.x - wall.start.x)), 2) +
        Math.pow(pos.y - (wall.start.y + t * (wall.end.y - wall.start.y)), 2)
      );
      const hitThreshold = wall.thickness / 2 + hitPaddingWorld;
      if (dist <= hitThreshold && dist < bestDistance) {
        bestWallIndex = i;
        bestDistance = dist;
      }
    }
    return bestWallIndex;
  }, [getWorldDistanceForPixels, walls]);

  const findPointAt = useCallback((
    pos: Point,
    input: InputPrecision = 'mouse',
  ): { wallIndex: number, type: 'start' | 'end' } | null => {
    const threshold = getWorldDistanceForPixels(getHandleHitRadiusPx('wall-node', input));
    const searchOrder = selectedWallIndex !== null
      ? [selectedWallIndex, ...walls.map((_, index) => index).filter((index) => index !== selectedWallIndex)]
      : walls.map((_, index) => index);

    for (const wallIndex of searchOrder) {
      const wall = walls[wallIndex];
      if (!wall) continue;

      const distStart = Math.hypot(pos.x - wall.start.x, pos.y - wall.start.y);
      if (distStart < threshold) return { wallIndex, type: 'start' };

      const distEnd = Math.hypot(pos.x - wall.end.x, pos.y - wall.end.y);
      if (distEnd < threshold) return { wallIndex, type: 'end' };
    }

    return null;
  }, [getWorldDistanceForPixels, selectedWallIndex, walls]);

  const isScreenHandleHit = useCallback((
    clientX: number,
    clientY: number,
    point: Point,
    target: HandleTarget,
    input: InputPrecision,
  ) => {
    if (!containerRef.current) {
      return false;
    }

    const container = containerRef.current.getBoundingClientRect();
    const screenPoint = worldToScreen(point);
    const distance = Math.hypot(
      clientX - container.left - screenPoint.x,
      clientY - container.top - screenPoint.y,
    );

    return distance <= getHandleHitRadiusPx(target, input);
  }, [worldToScreen]);

  const findOpeningAt = (pos: Point): number | null => {
    for (let i = 0; i < openings.length; i++) {
      const op = resolveOpening(openings[i], walls);
      if (isPointInsideOpening(pos, op)) return i;
    }
    return null;
  };

  const getMarqueeBounds = useCallback((selection: MarqueeSelectionState) => ({
    minX: Math.min(selection.origin.x, selection.current.x),
    minY: Math.min(selection.origin.y, selection.current.y),
    maxX: Math.max(selection.origin.x, selection.current.x),
    maxY: Math.max(selection.origin.y, selection.current.y),
  }), []);

  const getWallsInsideMarquee = useCallback((selection: MarqueeSelectionState) => {
    const bounds = getMarqueeBounds(selection);
    return walls
      .map((wall, index) => (wallIntersectsRect(wall, bounds) ? index : null))
      .filter((index): index is number => index !== null);
  }, [getMarqueeBounds, walls]);

  const getOpeningsInsideMarquee = useCallback((selection: MarqueeSelectionState) => {
    const bounds = getMarqueeBounds(selection);
    return openings
      .map((opening, index) => {
        const resolvedOpening = resolveOpening(opening, walls);
        return isPointInsideRect(resolvedOpening.position, bounds) ? index : null;
      })
      .filter((index): index is number => index !== null);
  }, [getMarqueeBounds, openings, resolveOpening, walls]);

  const getClosestOpeningSnap = useCallback((rawPos: Point, maxDistance: number) => {
    let bestSnap: ReturnType<typeof getOpeningMetricsOnWall> = null;
    let minSnapDist = Infinity;
    let wallIndex: number | null = null;

    walls.forEach((wall, index) => {
      const l2 = Math.pow(wall.start.x - wall.end.x, 2) + Math.pow(wall.start.y - wall.end.y, 2);
      if (l2 === 0) return;

      let t = ((rawPos.x - wall.start.x) * (wall.end.x - wall.start.x) + (rawPos.y - wall.start.y) * (wall.end.y - wall.start.y)) / l2;
      t = Math.max(0, Math.min(1, t));

      const snapX = wall.start.x + t * (wall.end.x - wall.start.x);
      const snapY = wall.start.y + t * (wall.end.y - wall.start.y);
      const dist = Math.hypot(rawPos.x - snapX, rawPos.y - snapY);

      if (dist < minSnapDist && dist < maxDistance) {
        minSnapDist = dist;
        bestSnap = getOpeningMetricsOnWall(wall, { x: snapX, y: snapY });
        wallIndex = index;
      }
    });

    return { snap: bestSnap, wallIndex };
  }, [getOpeningMetricsOnWall, walls]);

  const clearTouchLongPress = useCallback(() => {
    if (touchLongPressTimeoutRef.current !== null) {
      window.clearTimeout(touchLongPressTimeoutRef.current);
      touchLongPressTimeoutRef.current = null;
    }
  }, []);

  const resetTouchInteractionState = useCallback(() => {
    clearTouchLongPress();
    touchPressRef.current = null;
    touchGestureRef.current = null;
    touchPointersRef.current.clear();
  }, [clearTouchLongPress]);

  const activateTouchDragTarget = useCallback((press: TouchPressState) => {
    dragSnapshotRef.current = createSnapshot();

    if (press.target.type === 'point') {
      setDraggingPoint(press.target.point);
      setSelectedWallIndex(press.target.point.wallIndex);
      setSelectedOpeningIndex(null);
      setCurrentThickness(wallsRef.current[press.target.point.wallIndex]?.thickness ?? currentThicknessRef.current);
      return;
    }

    if (press.target.type === 'opening') {
      setDraggingOpening(press.target.openingIndex);
      setSelectedOpeningIndex(press.target.openingIndex);
      setSelectedWallIndex(null);
      setCurrentOpeningWidth(openingsRef.current[press.target.openingIndex]?.width ?? currentOpeningWidthRef.current);
      return;
    }

    if (press.target.type === 'pivot' && selectedWallIndicesRef.current.length > 1) {
      setDraggingWallGroup({
        wallIndices: [...selectedWallIndicesRef.current],
        startPointer: press.startWorld,
        baseWalls: cloneWalls(wallsRef.current),
      });
      setSelectedWallIndex(null);
      setSelectedOpeningIndex(null);
    }
  }, [createSnapshot]);

  const rotateSelectedWallsByAngle = useCallback((angleRad: number, baseWalls: WallSegment[]) => {
    if (!selectedWallsRotationPivot || selectedWallIndices.length < 2) {
      return;
    }

    const rotatedWalls = baseWalls.map((wall, wallIndex) => {
      if (!selectedWallIndices.includes(wallIndex)) {
        return wall;
      }

      return {
        ...wall,
        start: rotatePointAroundPivot(wall.start, selectedWallsRotationPivot, angleRad),
        end: rotatePointAroundPivot(wall.end, selectedWallsRotationPivot, angleRad),
      };
    });

    setWalls(rotatedWalls);
  }, [selectedWallIndices, selectedWallsRotationPivot]);

  const uiOverlayEventBlockUntilRef = useRef(0);

  const markUiOverlayInteraction = useCallback((event: Event | React.SyntheticEvent) => {
    const nativeEvent = 'nativeEvent' in event ? event.nativeEvent : event;
    const eventType = nativeEvent.type;
    const pointerEvent = nativeEvent as PointerEvent;
    if (eventType.startsWith('touch') || pointerEvent.pointerType === 'touch' || pointerEvent.pointerType === 'pen') {
      uiOverlayEventBlockUntilRef.current = Date.now() + UI_OVERLAY_EVENT_BLOCK_MS;
    }
  }, []);

  const isFromUiOverlayTarget = useCallback((target: EventTarget | null) => {
    return target instanceof Element && Boolean(target.closest(UI_OVERLAY_SELECTOR));
  }, []);

  const shouldIgnoreSurfaceEvent = useCallback((
    event: Pick<React.SyntheticEvent, 'target' | 'nativeEvent'>,
    pointerType?: string,
  ) => {
    if (isFromUiOverlayTarget(event.target)) {
      return true;
    }

    const nativeEvent = event.nativeEvent;
    const nativePointerType = 'pointerType' in nativeEvent ? (nativeEvent as PointerEvent).pointerType : undefined;
    const effectivePointerType = pointerType ?? nativePointerType;
    if ((effectivePointerType === 'mouse' || effectivePointerType === undefined) && Date.now() < uiOverlayEventBlockUntilRef.current) {
      return true;
    }

    return false;
  }, [isFromUiOverlayTarget]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (shouldIgnoreSurfaceEvent(e)) {
      return;
    }

    setIsMobileToolsOpen(false);
    setIsMobilePropertiesOpen(false);
    setMobileOverlayPanel(null);

    if (e.button === 1 || (e.button === 0 && panMode)) {
      e.preventDefault();
      setIsDragging(true);
      setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
      return;
    }

    if (e.button === 0) {
      const rawPos = getRelativePos(e);

      if (isPrintModeActive && printFrame) {
        const isInsideFrame = isPointInsideRect(rawPos, {
          minX: printFrame.x,
          minY: printFrame.y,
          maxX: printFrame.x + printFrame.width,
          maxY: printFrame.y + printFrame.height,
        });

        if (isInsideFrame) {
          setDraggingPrintFrame({
            offsetX: rawPos.x - printFrame.x,
            offsetY: rawPos.y - printFrame.y,
          });
        }

        setAlignmentGuides([]);
        setActiveSnapNode(null);
        return;
      }

      if (isAdjustingBackground && hasBackground) {
        setBackgroundDragOrigin({
          pointer: rawPos,
          transform: backgroundTransformRef.current,
        });
        setAlignmentGuides([]);
        setActiveSnapNode(null);
        return;
      }
      
      if (isRoomMeasureMode) {
        const measurement = measureRoomAtPoint(rawPos);
        setSelectedWallIndex(null);
        setSelectedOpeningIndex(null);
        setSelectedWallIndices([]);

        if (!measurement) {
          setRoomMeasurement(null);
          setRoomMeasureMessage('Cannot calculate area: room is not fully closed.');
          return;
        }

        setRoomMeasurement(measurement);
        setRoomMeasureMessage('Room measured. Click inside another closed room.');
        return;
      }

      if (isReferenceCalibration) {
        if (referenceCalibrationSegment) {
          return;
        }

        const snapResult = getSnapResult(rawPos, e.shiftKey, {
          anchor: referenceCalibrationStart,
          allowAlignment: Boolean(referenceCalibrationStart),
        });

        if (!referenceCalibrationStart) {
          setReferenceCalibrationStart(snapResult.point);
          setMousePos(snapResult.point);
          setAlignmentGuides([]);
          setActiveSnapNode(snapResult.snappedNode);
          setSelectedWallIndex(null);
          setSelectedOpeningIndex(null);
          return;
        }

        if (Math.hypot(snapResult.point.x - referenceCalibrationStart.x, snapResult.point.y - referenceCalibrationStart.y) <= ROOM_GRAPH_EPSILON) {
          return;
        }

        setReferenceCalibrationSegment({
          start: referenceCalibrationStart,
          end: snapResult.point,
        });
        setReferenceCalibrationStart(null);
        setMousePos(snapResult.point);
        setAlignmentGuides([]);
        setActiveSnapNode(null);
        return;
      }

      // 0. Delete mode
      if (activeTool === 'delete') {
        if (e.shiftKey) {
          setMarqueeSelection({ origin: rawPos, current: rawPos });
          setMarqueeMode('delete');
          setActiveSnapNode(null);
          setAlignmentGuides([]);
          return;
        }

        const openingAt = findOpeningAt(rawPos);
        if (openingAt !== null) {
          pushHistorySnapshot({
            openings: openings.filter((_, i) => i !== openingAt),
          }, {
            selection: null,
          });
          return;
        }
        const wallAt = findWallAt(rawPos, 'mouse');
        if (wallAt !== null) {
          const cascadeDelete = createWallCascadeDeletion(wallAt);
          if (!cascadeDelete) return;
          pushHistorySnapshot(cascadeDelete, {
            selection: null,
          });
          return;
        }
        return;
      }

      // 1. If we are currently drawing, prioritize finishing the segment
      if (currentStart && activeTool === 'draw') {
        if (isWallLengthInputActive) {
          return;
        }
        const snapResult = getSnapResult(rawPos, e.shiftKey, {
          anchor: currentStart,
          allowAlignment: true,
          continuationDirections,
        });
        commitWallSegment(snapResult.point);
        return;
      }

      if (activeTool === 'multi-wall') {
        if (isMultiWallRotationMode) {
          if (e.button === 0) {
            rotateSelectedWalls('ccw');
          } else if (e.button === 2) {
            rotateSelectedWalls('cw');
          }
          return;
        }

        const wallAt = findWallAt(rawPos, 'mouse');

        if (e.shiftKey && wallAt === null) {
          setMarqueeSelection({ origin: rawPos, current: rawPos });
          setMarqueeMode('multi-select');
          setPendingMultiWallToggle(null);
          setAlignmentGuides([]);
          setActiveSnapNode(null);
          return;
        }

        if (selectedWallIndices.length > 0 && (wallAt === null || selectedWallIndices.includes(wallAt))) {
          dragSnapshotRef.current = createSnapshot();
          setDraggingWallGroup({
            wallIndices: [...selectedWallIndices],
            startPointer: rawPos,
            baseWalls: cloneWalls(walls),
          });
          setPendingMultiWallToggle(null);
          setSelectedWallIndex(null);
          setSelectedOpeningIndex(null);
          return;
        }

        if (wallAt !== null) {
          setPendingMultiWallToggle({
            wallIndex: wallAt,
            startClientX: e.clientX,
            startClientY: e.clientY,
          });
          return;
        }

        return;
      }

      // 2. If not drawing, check tool behavior
      if (activeTool === 'select') {
        const pointAt = findPointAt(rawPos, 'mouse');
        const wallAt = findWallAt(rawPos, 'mouse');

        if (pointAt) {
          if (selectedWallIndexRef.current === pointAt.wallIndex) {
            pendingPointDragRef.current = {
              point: pointAt,
              startClientX: e.clientX,
              startClientY: e.clientY,
            };
            setSelectedWallIndex(pointAt.wallIndex);
            setSelectedOpeningIndex(null);
            setCurrentThickness(walls[pointAt.wallIndex].thickness);
            return;
          }

          setSelectedWallIndex(pointAt.wallIndex);
          setSelectedOpeningIndex(null);
          setCurrentThickness(walls[pointAt.wallIndex].thickness);
          return;
        }

        const openingAt = findOpeningAt(rawPos);
        if (openingAt !== null) {
          dragSnapshotRef.current = createSnapshot();
          setSelectedOpeningIndex(openingAt);
          setSelectedWallIndex(null);
          setDraggingOpening(openingAt);
          setCurrentOpeningWidth(openings[openingAt].width);
          return;
        }

        if (wallAt !== null) {
          if (isCalibrating && calibrationMode === 'wall') {
            setCalibrationWallIndex(wallAt);
          }
          setSelectedWallIndex(wallAt);
          setSelectedOpeningIndex(null);
          setCurrentThickness(walls[wallAt].thickness);
          return;
        }
        setSelectedWallIndex(null);
        setSelectedOpeningIndex(null);
      } else if (activeTool === 'door' || activeTool === 'window' || activeTool === 'window-floor') {
        // Place opening on wall using the preview position if available
        if (previewOpening) {
          const newOpening: Opening = {
            position: previewOpening.position,
            width: currentOpeningWidth,
            type: activeTool,
            rotation: previewOpening.rotation,
            thickness: previewOpening.thickness,
            wallId: previewOpening.wallId,
            offsetAlongWall: previewOpening.offsetAlongWall,
          };
          pushHistorySnapshot({
            openings: [...openings, newOpening],
          });
        }
      } else if (activeTool === 'draw') {
        // Draw tool: start new wall
        const snapResult = getSnapResult(rawPos, false, {
          allowAlignment: false,
        });
        const pos = snapResult.point;
        setCurrentStart(pos);
        setContinuationDirections(snapResult.snappedNode?.kind === 'endpoint'
          ? getContinuationDirectionsForPoint(pos)
          : null);
        resetWallLengthInput();
        setAlignmentGuides([]);
        setActiveSnapNode(snapResult.snappedNode);
        setSelectedWallIndex(null);
        setSelectedOpeningIndex(null);
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (shouldIgnoreSurfaceEvent(e)) {
      return;
    }

    const rawPos = getRelativePos(e);
    setRawMousePos(rawPos);

    if (isReferenceCalibration) {
      if (referenceCalibrationStart) {
        const snapResult = getSnapResult(rawPos, e.shiftKey, {
          anchor: referenceCalibrationStart,
          allowAlignment: true,
        });
        setMousePos(snapResult.point);
        setActiveSnapNode(snapResult.snappedNode);
        setAlignmentGuides(snapResult.guides);
        return;
      }

      setMousePos(rawPos);
      setAlignmentGuides([]);
      setActiveSnapNode(null);
      return;
    }

    if (isDragging) {
      const nextOffset = {
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      };
      offsetRef.current = nextOffset;
      setOffset(nextOffset);
    } else if (draggingPrintFrame && printFrame) {
      setPrintFrame({
        ...printFrame,
        x: rawPos.x - draggingPrintFrame.offsetX,
        y: rawPos.y - draggingPrintFrame.offsetY,
      });
      setMousePos(rawPos);
      setAlignmentGuides([]);
      setActiveSnapNode(null);
      return;
    } else if (backgroundDragOrigin && hasBackground) {
      setBackgroundTransform({
        ...backgroundDragOrigin.transform,
        x: backgroundDragOrigin.transform.x + (rawPos.x - backgroundDragOrigin.pointer.x),
        y: backgroundDragOrigin.transform.y + (rawPos.y - backgroundDragOrigin.pointer.y),
      });
    } else if (marqueeSelection) {
      setMarqueeSelection((prev) => prev ? { ...prev, current: rawPos } : prev);
      setAlignmentGuides([]);
      setActiveSnapNode(null);
    } else if (pendingMultiWallToggle) {
      const moved = Math.hypot(e.clientX - pendingMultiWallToggle.startClientX, e.clientY - pendingMultiWallToggle.startClientY);
      if (moved > MULTI_WALL_TOGGLE_CANCEL_THRESHOLD_PX) {
        setPendingMultiWallToggle(null);
      }
    } else if (pendingPointDragRef.current) {
      const moved = Math.hypot(
        e.clientX - pendingPointDragRef.current.startClientX,
        e.clientY - pendingPointDragRef.current.startClientY,
      );

      if (moved >= NODE_DRAG_START_MOUSE_THRESHOLD_PX) {
        dragSnapshotRef.current = createSnapshot();
        setDraggingPoint(pendingPointDragRef.current.point);
        pendingPointDragRef.current = null;
      }
    } else if (draggingWallGroup) {
      const snapResult = getSnapResult(rawPos, false, {
        allowAlignment: true,
        excludeWallIndices: draggingWallGroup.wallIndices,
      });
      const delta = {
        x: snapResult.point.x - draggingWallGroup.startPointer.x,
        y: snapResult.point.y - draggingWallGroup.startPointer.y,
      };
      const newWalls = draggingWallGroup.baseWalls.map((wall, index) => {
        if (!draggingWallGroup.wallIndices.includes(index)) {
          return wall;
        }

        return {
          ...wall,
          start: { x: wall.start.x + delta.x, y: wall.start.y + delta.y },
          end: { x: wall.end.x + delta.x, y: wall.end.y + delta.y },
        };
      });
      setWalls(newWalls);
      setMousePos(snapResult.point);
      setActiveSnapNode(snapResult.snappedNode);
      setAlignmentGuides(snapResult.guides);
      return;
    } else if (draggingPoint) {
      const snapResult = getSnapResult(rawPos, e.shiftKey, {
        excludeWallIndex: draggingPoint.wallIndex,
        allowAlignment: true,
      });
      const pos = snapResult.point;
      const newWalls = [...walls];
      if (draggingPoint.type === 'start') {
        newWalls[draggingPoint.wallIndex].start = pos;
      } else {
        newWalls[draggingPoint.wallIndex].end = pos;
      }
      setWalls(newWalls);
      setActiveSnapNode(snapResult.snappedNode);
      setAlignmentGuides(snapResult.guides);
    } else if (draggingOpening !== null) {
      // Find the best wall to snap to (prioritize current wall if possible, or nearest)
      let bestSnap: ReturnType<typeof getOpeningMetricsOnWall> = null;
      let minSnapDist = Infinity;

      for (const wall of walls) {
        const l2 = Math.pow(wall.start.x - wall.end.x, 2) + Math.pow(wall.start.y - wall.end.y, 2);
        if (l2 === 0) continue;
        
        let t = ((rawPos.x - wall.start.x) * (wall.end.x - wall.start.x) + (rawPos.y - wall.start.y) * (wall.end.y - wall.start.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        
        const snapX = wall.start.x + t * (wall.end.x - wall.start.x);
        const snapY = wall.start.y + t * (wall.end.y - wall.start.y);
        const dist = Math.sqrt(Math.pow(rawPos.x - snapX, 2) + Math.pow(rawPos.y - snapY, 2));

        if (dist < minSnapDist && dist < 50) { // 50px snap radius
          minSnapDist = dist;
          bestSnap = getOpeningMetricsOnWall(wall, { x: snapX, y: snapY });
        }
      }

      if (bestSnap) {
        const newOpenings = [...openings];
        newOpenings[draggingOpening].position = bestSnap.position;
        newOpenings[draggingOpening].rotation = bestSnap.rotation;
        newOpenings[draggingOpening].thickness = bestSnap.thickness;
        newOpenings[draggingOpening].wallId = bestSnap.wallId;
        newOpenings[draggingOpening].offsetAlongWall = bestSnap.offsetAlongWall;
        setOpenings(newOpenings);
      }
    }

    // Handle preview for doors/windows
    if (activeTool === 'door' || activeTool === 'window' || activeTool === 'window-floor') {
      let bestSnap: ReturnType<typeof getOpeningMetricsOnWall> = null;
      let minSnapDist = Infinity;

      for (const wall of walls) {
        const l2 = Math.pow(wall.start.x - wall.end.x, 2) + Math.pow(wall.start.y - wall.end.y, 2);
        if (l2 === 0) continue;
        
        let t = ((rawPos.x - wall.start.x) * (wall.end.x - wall.start.x) + (rawPos.y - wall.start.y) * (wall.end.y - wall.start.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        
        const snapX = wall.start.x + t * (wall.end.x - wall.start.x);
        const snapY = wall.start.y + t * (wall.end.y - wall.start.y);
        const dist = Math.sqrt(Math.pow(rawPos.x - snapX, 2) + Math.pow(rawPos.y - snapY, 2));

        if (dist < minSnapDist && dist < 60) { // 60px snap radius for preview
          minSnapDist = dist;
          bestSnap = getOpeningMetricsOnWall(wall, { x: snapX, y: snapY });
        }
      }
      setPreviewOpening(bestSnap);
    } else {
      setPreviewOpening(null);
    }

    if (draggingPoint || marqueeSelection || pendingMultiWallToggle) {
      setMousePos(rawPos);
      return;
    }

    if (isPrintModeActive) {
      setPreviewOpening(null);
      setMousePos(rawPos);
      setAlignmentGuides([]);
      setActiveSnapNode(null);
      return;
    }

    if (isRoomMeasureMode) {
      setPreviewOpening(null);
      setMousePos(rawPos);
      setAlignmentGuides([]);
      setActiveSnapNode(null);
      return;
    }

    if (activeTool === 'draw' && currentStart && isWallLengthInputActive) {
      setMousePos(rawPos);
      setAlignmentGuides([]);
      setActiveSnapNode(null);
      return;
    }

    const snapResult = getSnapResult(rawPos, e.shiftKey, {
      anchor: currentStart,
      allowAlignment: Boolean(currentStart && activeTool === 'draw'),
      continuationDirections,
    });
    setMousePos(snapResult.point);
    setActiveSnapNode(snapResult.snappedNode);
    setAlignmentGuides(
      (currentStart && activeTool === 'draw') || draggingPoint
        ? snapResult.guides
        : []
    );
  };

  const handleMouseUp = () => {
    pendingPointDragRef.current = null;

    if (draggingPrintFrame) {
      setDraggingPrintFrame(null);
    }

    if (isPrintModeActive) {
      setIsDragging(false);
      setBackgroundDragOrigin(null);
      setDraggingPoint(null);
      setDraggingWallGroup(null);
      setDraggingOpening(null);
      setMarqueeSelection(null);
      setMarqueeMode(null);
      setPendingMultiWallToggle(null);
      setActiveSnapNode(null);
      setAlignmentGuides([]);
      return;
    }

    if (pendingMultiWallToggle) {
      setSelectedWallIndices((prev) => (
        prev.includes(pendingMultiWallToggle.wallIndex)
          ? prev.filter((wallIndex) => wallIndex !== pendingMultiWallToggle.wallIndex)
          : [...prev, pendingMultiWallToggle.wallIndex]
      ));
      setSelectedWallIndex(null);
      setSelectedOpeningIndex(null);
    }

    if (marqueeSelection) {
      const marqueeThreshold = getWorldDistanceForPixels(6);
      const hasDraggedMarquee = Math.abs(marqueeSelection.current.x - marqueeSelection.origin.x) > marqueeThreshold
        || Math.abs(marqueeSelection.current.y - marqueeSelection.origin.y) > marqueeThreshold;

      if (!hasDraggedMarquee) {
        setMarqueeSelection(null);
        setMarqueeMode(null);
      } else if (marqueeMode === 'delete') {
        const marqueeWalls = getWallsInsideMarquee(marqueeSelection);
        const wallIdsToDelete = new Set(marqueeWalls.map((wallIndex) => wallsRef.current[wallIndex]?.id).filter((wallId): wallId is string => Boolean(wallId)));
        const openingIndicesToDelete = new Set(getOpeningsInsideMarquee(marqueeSelection));

        if (wallIdsToDelete.size > 0 || openingIndicesToDelete.size > 0) {
          pushHistorySnapshot({
            walls: wallsRef.current.filter((_, index) => !marqueeWalls.includes(index)),
            openings: openingsRef.current.filter((opening, index) => !openingIndicesToDelete.has(index) && !(opening.wallId && wallIdsToDelete.has(opening.wallId))),
          }, {
            selection: null,
          });
        }
      } else {
        const marqueeWalls = getWallsInsideMarquee(marqueeSelection);
        if (marqueeWalls.length > 0) {
          setSelectedWallIndices((prev) => Array.from(new Set([...prev, ...marqueeWalls])));
        }
        setSelectedWallIndex(null);
        setSelectedOpeningIndex(null);
      }
    }

    if (dragSnapshotRef.current && (draggingPoint || draggingWallGroup || draggingOpening !== null)) {
      const nextSnapshot = createSnapshot();
      const previousSnapshot = dragSnapshotRef.current;
      if (JSON.stringify(previousSnapshot) !== JSON.stringify(nextSnapshot)) {
        setHistory((prev) => {
          const nextHistory = prev.slice(0, historyIndexRef.current + 1);
          nextHistory.push(nextSnapshot);
          return nextHistory;
        });
        setHistoryIndex((prev) => prev + 1);
        historyIndexRef.current += 1;
      }
    }

    dragSnapshotRef.current = null;
    setIsDragging(false);
    setBackgroundDragOrigin(null);
    setDraggingPoint(null);
    setDraggingWallGroup(null);
    setDraggingOpening(null);
    setMarqueeSelection(null);
    setMarqueeMode(null);
    setPendingMultiWallToggle(null);
    setActiveSnapNode(null);
    if (!currentStart) {
      setAlignmentGuides([]);
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (shouldIgnoreSurfaceEvent(e)) {
      return;
    }

    e.preventDefault();
    const zoomFactor = Math.exp(-e.deltaY * ZOOM_SENSITIVITY);
    zoomAtPoint(zoomRef.current * zoomFactor, e.clientX, e.clientY);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (shouldIgnoreSurfaceEvent(e, e.pointerType)) {
      return;
    }

    if (e.pointerType === 'mouse') {
      return;
    }

    e.preventDefault();
    setIsMobileToolsOpen(false);
    setIsMobilePropertiesOpen(false);
    setMobileOverlayPanel(null);
    touchPointersRef.current.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });

    const pointerEntries = Array.from(touchPointersRef.current.entries());
    if (pointerEntries.length === 2) {
      clearTouchLongPress();
      const [[firstId, firstPointer], [secondId, secondPointer]] = pointerEntries;
      const midpoint = {
        x: (firstPointer.clientX + secondPointer.clientX) / 2,
        y: (firstPointer.clientY + secondPointer.clientY) / 2,
      };
      const distance = Math.hypot(secondPointer.clientX - firstPointer.clientX, secondPointer.clientY - firstPointer.clientY);

      if (
        activeTool === 'multi-wall' &&
        selectedWallIndices.length > 1 &&
        selectedWallsRotationPivot &&
        touchPressRef.current?.target.type === 'pivot'
      ) {
        const secondWorld = getRelativePosFromClient(secondPointer.clientX, secondPointer.clientY);
        touchGestureRef.current = {
          type: 'group-rotate',
          pointerIds: [firstId, secondId],
          startDistance: distance,
          startMidpoint: midpoint,
          startZoom: zoomRef.current,
          startOffset: offsetRef.current,
          startAngle: Math.atan2(secondWorld.y - selectedWallsRotationPivot.y, secondWorld.x - selectedWallsRotationPivot.x),
          pivot: selectedWallsRotationPivot,
          baseWalls: cloneWalls(wallsRef.current),
        };
      } else {
        touchGestureRef.current = {
          type: 'pinch-pan',
          pointerIds: [firstId, secondId],
          startDistance: distance,
          startMidpoint: midpoint,
          startZoom: zoomRef.current,
          startOffset: offsetRef.current,
        };
      }
      return;
    }

    if (pointerEntries.length > 1) {
      return;
    }

    const rawPos = getRelativePosFromClient(e.clientX, e.clientY);
    setRawMousePos(rawPos);
    setMousePos(rawPos);

    let target: TouchPressState['target'] = { type: 'empty' };

    if (activeTool === 'select') {
      const pointAt = findPointAt(rawPos, 'touch');
      const wallAt = findWallAt(rawPos, 'touch');
      if (pointAt && selectedWallIndexRef.current === pointAt.wallIndex) {
        target = { type: 'point', point: pointAt };
      } else {
        const openingAt = findOpeningAt(rawPos);
        if (openingAt !== null) {
          target = { type: 'opening', openingIndex: openingAt };
        } else {
          const selectableWallIndex = wallAt ?? pointAt?.wallIndex ?? null;
          if (selectableWallIndex !== null) {
            target = { type: 'wall', wallIndex: selectableWallIndex };
          }
        }
      }
    } else if (activeTool === 'multi-wall') {
      if (selectedWallsRotationPivot && selectedWallIndices.length > 1) {
        if (isScreenHandleHit(e.clientX, e.clientY, selectedWallsRotationPivot, 'multi-selection-pivot', 'touch')) {
          target = { type: 'pivot' };
        }
      }
      if (target.type === 'empty') {
        const wallAt = findWallAt(rawPos, 'touch');
        if (wallAt !== null) {
          target = { type: 'wall', wallIndex: wallAt };
        }
      }
    } else if (activeTool === 'draw') {
      target = { type: 'draw' };
    } else if (activeTool === 'door' || activeTool === 'window' || activeTool === 'window-floor') {
      const closest = getClosestOpeningSnap(rawPos, 60);
      if (closest.wallIndex !== null) {
        setSelectedWallIndex(closest.wallIndex);
      }
    }

    touchPressRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startWorld: rawPos,
      target,
      dragActivated: false,
    };

    if (target.type === 'opening' || target.type === 'pivot') {
      const activatedPress = {
        ...touchPressRef.current,
        dragActivated: true,
      } as TouchPressState;
      touchPressRef.current = activatedPress;
      activateTouchDragTarget(activatedPress);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (shouldIgnoreSurfaceEvent(e, e.pointerType)) {
      return;
    }

    if (e.pointerType === 'mouse' || !touchPointersRef.current.has(e.pointerId)) {
      return;
    }

    e.preventDefault();
    touchPointersRef.current.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
    const rawPos = getRelativePosFromClient(e.clientX, e.clientY);
    setRawMousePos(rawPos);

    if (touchGestureRef.current) {
      const gesture = touchGestureRef.current;
      const pointerEntries = gesture.pointerIds
        .map((pointerId) => touchPointersRef.current.get(pointerId))
        .filter((value): value is TouchPointerInfo => Boolean(value));

      if (pointerEntries.length < 2) {
        return;
      }

      const [firstPointer, secondPointer] = pointerEntries;
      const midpointClient = {
        x: (firstPointer.clientX + secondPointer.clientX) / 2,
        y: (firstPointer.clientY + secondPointer.clientY) / 2,
      };
      const distance = Math.hypot(secondPointer.clientX - firstPointer.clientX, secondPointer.clientY - firstPointer.clientY);

      if (gesture.type === 'pinch-pan') {
        if (!containerRef.current) {
          return;
        }

        const container = containerRef.current.getBoundingClientRect();
        const startPointerX = gesture.startMidpoint.x - container.left;
        const startPointerY = gesture.startMidpoint.y - container.top;
        const currentPointerX = midpointClient.x - container.left;
        const currentPointerY = midpointClient.y - container.top;
        const nextZoom = clampZoom(gesture.startZoom * (distance / gesture.startDistance));
        const worldX = (startPointerX - gesture.startOffset.x) / gesture.startZoom;
        const worldY = (startPointerY - gesture.startOffset.y) / gesture.startZoom;
        const nextOffset = {
          x: currentPointerX - worldX * nextZoom,
          y: currentPointerY - worldY * nextZoom,
        };

        zoomRef.current = nextZoom;
        offsetRef.current = nextOffset;
        setZoom(nextZoom);
        setOffset(nextOffset);
        setAlignmentGuides([]);
        setActiveSnapNode(null);
        return;
      }

      if (gesture.type === 'group-rotate' && gesture.pivot && gesture.baseWalls) {
        const secondWorld = getRelativePosFromClient(secondPointer.clientX, secondPointer.clientY);
        const currentAngle = Math.atan2(secondWorld.y - gesture.pivot.y, secondWorld.x - gesture.pivot.x);
        const delta = currentAngle - (gesture.startAngle ?? currentAngle);
        const snappedDelta =
          Math.round(delta / THREE.MathUtils.degToRad(MULTI_WALL_ROTATION_STEP_DEGREES)) *
          THREE.MathUtils.degToRad(MULTI_WALL_ROTATION_STEP_DEGREES);
        rotateSelectedWallsByAngle(snappedDelta, gesture.baseWalls);
        setMousePos(rawPos);
        return;
      }
    }

    const press = touchPressRef.current;
    if (press) {
      const moved = Math.hypot(e.clientX - press.startClientX, e.clientY - press.startClientY);
      if (!press.dragActivated && press.target.type === 'point' && moved >= NODE_DRAG_START_TOUCH_THRESHOLD_PX) {
        const activatedPress = {
          ...press,
          dragActivated: true,
        };
        touchPressRef.current = activatedPress;
        activateTouchDragTarget(activatedPress);
      } else if (!press.dragActivated && moved > TOUCH_MOVE_CANCEL_PX) {
        clearTouchLongPress();
      }

      if (touchPressRef.current?.dragActivated) {
        if (draggingWallGroup) {
          const snapResult = getSnapResult(rawPos, false, {
            allowAlignment: true,
            excludeWallIndices: draggingWallGroup.wallIndices,
          });
          const delta = {
            x: snapResult.point.x - draggingWallGroup.startPointer.x,
            y: snapResult.point.y - draggingWallGroup.startPointer.y,
          };
          const newWalls = draggingWallGroup.baseWalls.map((wall, index) => {
            if (!draggingWallGroup.wallIndices.includes(index)) {
              return wall;
            }

            return {
              ...wall,
              start: { x: wall.start.x + delta.x, y: wall.start.y + delta.y },
              end: { x: wall.end.x + delta.x, y: wall.end.y + delta.y },
            };
          });
          setWalls(newWalls);
          setMousePos(snapResult.point);
          setActiveSnapNode(snapResult.snappedNode);
          setAlignmentGuides(snapResult.guides);
          return;
        }

        if (draggingPoint) {
          const snapResult = getSnapResult(rawPos, false, {
            excludeWallIndex: draggingPoint.wallIndex,
            allowAlignment: true,
          });
          const pos = snapResult.point;
          const newWalls = [...wallsRef.current];
          if (draggingPoint.type === 'start') {
            newWalls[draggingPoint.wallIndex].start = pos;
          } else {
            newWalls[draggingPoint.wallIndex].end = pos;
          }
          setWalls(newWalls);
          setMousePos(pos);
          setActiveSnapNode(snapResult.snappedNode);
          setAlignmentGuides(snapResult.guides);
          return;
        }

        if (draggingOpening !== null) {
          const bestSnap = getClosestOpeningSnap(rawPos, 50).snap;
          if (bestSnap) {
            const newOpenings = [...openingsRef.current];
            newOpenings[draggingOpening].position = bestSnap.position;
            newOpenings[draggingOpening].rotation = bestSnap.rotation;
            newOpenings[draggingOpening].thickness = bestSnap.thickness;
            newOpenings[draggingOpening].wallId = bestSnap.wallId;
            newOpenings[draggingOpening].offsetAlongWall = bestSnap.offsetAlongWall;
            setOpenings(newOpenings);
          }
          setMousePos(rawPos);
          return;
        }
      }
    }

    if (activeTool === 'door' || activeTool === 'window' || activeTool === 'window-floor') {
      const closest = getClosestOpeningSnap(rawPos, 60);
      setPreviewOpening(closest.snap);
      if (closest.wallIndex !== null) {
        setSelectedWallIndex(closest.wallIndex);
      }
      setMousePos(rawPos);
      return;
    }

    if (activeTool === 'draw' && currentStart) {
      const snapResult = getSnapResult(rawPos, false, {
        anchor: currentStart,
        allowAlignment: true,
        continuationDirections,
      });
      setMousePos(snapResult.point);
      setActiveSnapNode(snapResult.snappedNode);
      setAlignmentGuides(snapResult.guides);
      return;
    }

    setMousePos(rawPos);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (shouldIgnoreSurfaceEvent(e, e.pointerType)) {
      return;
    }

    if (e.pointerType === 'mouse') {
      return;
    }

    e.preventDefault();
    const rawPos = getRelativePosFromClient(e.clientX, e.clientY);
    const press = touchPressRef.current;
    const gesture = touchGestureRef.current;
    const pointerInfo = touchPointersRef.current.get(e.pointerId);

    touchPointersRef.current.delete(e.pointerId);
    clearTouchLongPress();

    if (gesture) {
      if (touchPointersRef.current.size < 2) {
        touchGestureRef.current = null;
        if (draggingWallGroup) {
          handleMouseUp();
        }
      }
      if (pointerInfo) {
        setMousePos(rawPos);
      }
      return;
    }

    if (!press || press.pointerId !== e.pointerId) {
      return;
    }

    const moved = Math.hypot(e.clientX - press.startClientX, e.clientY - press.startClientY);
    touchPressRef.current = null;

    if (press.dragActivated) {
      handleMouseUp();
      return;
    }

    if (moved > TOUCH_MOVE_CANCEL_PX) {
      return;
    }

    if (isRoomMeasureMode) {
      const measurement = measureRoomAtPoint(rawPos);
      setSelectedWallIndex(null);
      setSelectedOpeningIndex(null);
      setSelectedWallIndices([]);
      if (!measurement) {
        setRoomMeasurement(null);
        setRoomMeasureMessage('Cannot calculate area: room is not fully closed.');
        return;
      }
      setRoomMeasurement(measurement);
      setRoomMeasureMessage('Room measured. Tap inside another closed room.');
      return;
    }

    if (isReferenceCalibration) {
      if (referenceCalibrationSegment) {
        return;
      }

      const snapResult = getSnapResult(rawPos, false, {
        anchor: referenceCalibrationStart,
        allowAlignment: Boolean(referenceCalibrationStart),
      });

      if (!referenceCalibrationStart) {
        setReferenceCalibrationStart(snapResult.point);
        setMousePos(snapResult.point);
        setAlignmentGuides([]);
        setActiveSnapNode(snapResult.snappedNode);
        setSelectedWallIndex(null);
        setSelectedOpeningIndex(null);
        return;
      }

      if (Math.hypot(snapResult.point.x - referenceCalibrationStart.x, snapResult.point.y - referenceCalibrationStart.y) <= ROOM_GRAPH_EPSILON) {
        return;
      }

      setReferenceCalibrationSegment({
        start: referenceCalibrationStart,
        end: snapResult.point,
      });
      setReferenceCalibrationStart(null);
      setMousePos(snapResult.point);
      setAlignmentGuides([]);
      setActiveSnapNode(null);
      return;
    }

    if (activeTool === 'delete') {
      const openingAt = findOpeningAt(rawPos);
      if (openingAt !== null) {
        pushHistorySnapshot({ openings: openings.filter((_, i) => i !== openingAt) }, { selection: null });
        return;
      }
      const wallAt = findWallAt(rawPos, 'touch');
      if (wallAt !== null) {
        const cascadeDelete = createWallCascadeDeletion(wallAt);
        if (cascadeDelete) {
          pushHistorySnapshot(cascadeDelete, { selection: null });
        }
      }
      return;
    }

    if (currentStart && activeTool === 'draw') {
      const snapResult = getSnapResult(rawPos, false, {
        anchor: currentStart,
        allowAlignment: true,
        continuationDirections,
      });
      commitWallSegment(snapResult.point);
      return;
    }

    if (activeTool === 'draw') {
      const snapResult = getSnapResult(rawPos, false, { allowAlignment: false });
      setCurrentStart(snapResult.point);
      setContinuationDirections(snapResult.snappedNode?.kind === 'endpoint' ? getContinuationDirectionsForPoint(snapResult.point) : null);
      resetWallLengthInput();
      setAlignmentGuides([]);
      setActiveSnapNode(snapResult.snappedNode);
      setSelectedWallIndex(null);
      setSelectedOpeningIndex(null);
      return;
    }

    if (activeTool === 'door' || activeTool === 'window' || activeTool === 'window-floor') {
      const closest = getClosestOpeningSnap(rawPos, 60);
      if (closest.snap) {
        const newOpening: Opening = {
          position: closest.snap.position,
          width: currentOpeningWidth,
          type: activeTool,
          rotation: closest.snap.rotation,
          thickness: closest.snap.thickness,
          wallId: closest.snap.wallId,
          offsetAlongWall: closest.snap.offsetAlongWall,
        };
        pushHistorySnapshot({
          openings: [...openings, newOpening],
        });
      }
      setSelectedWallIndex(null);
      return;
    }

    if (activeTool === 'select') {
      if (press.target.type === 'point') {
        setSelectedWallIndex(press.target.point.wallIndex);
        setSelectedOpeningIndex(null);
        setCurrentThickness(wallsRef.current[press.target.point.wallIndex]?.thickness ?? currentThicknessRef.current);
        return;
      }
      if (press.target.type === 'opening') {
        setSelectedOpeningIndex(press.target.openingIndex);
        setSelectedWallIndex(null);
        setCurrentOpeningWidth(openingsRef.current[press.target.openingIndex]?.width ?? currentOpeningWidthRef.current);
        return;
      }
      if (press.target.type === 'wall') {
        if (isCalibrating && calibrationMode === 'wall') {
          setCalibrationWallIndex(press.target.wallIndex);
        }
        setSelectedWallIndex(press.target.wallIndex);
        setSelectedOpeningIndex(null);
        setCurrentThickness(wallsRef.current[press.target.wallIndex]?.thickness ?? currentThicknessRef.current);
        return;
      }
      setSelectedWallIndex(null);
      setSelectedOpeningIndex(null);
      return;
    }

    if (activeTool === 'multi-wall' && press.target.type === 'wall') {
      const { wallIndex } = press.target;
      setSelectedWallIndices((prev) => (
        prev.includes(wallIndex)
          ? prev.filter((selectedWallIndex) => selectedWallIndex !== wallIndex)
          : [...prev, wallIndex]
      ));
      setSelectedWallIndex(null);
      setSelectedOpeningIndex(null);
    }
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    if (shouldIgnoreSurfaceEvent(e, e.pointerType)) {
      return;
    }

    if (e.pointerType === 'mouse') {
      return;
    }

    resetTouchInteractionState();
    handleMouseUp();
  };

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (shouldIgnoreSurfaceEvent(e)) {
      return;
    }

    if (isMultiWallRotationMode) {
      e.preventDefault();
    }
  }, [isMultiWallRotationMode, shouldIgnoreSurfaceEvent]);

  const handleUndo = () => {
    if (currentStart) {
      setCurrentStart(null);
      setContinuationDirections(null);
      setActiveSnapNode(null);
      setAlignmentGuides([]);
      return;
    }

    if (historyIndexRef.current === 0) return;
    const nextIndex = historyIndexRef.current - 1;
    historyIndexRef.current = nextIndex;
    setHistoryIndex(nextIndex);
    applySnapshot(history[nextIndex]);
  };

  const handleRedo = () => {
    if (historyIndexRef.current >= history.length - 1) return;
    const nextIndex = historyIndexRef.current + 1;
    historyIndexRef.current = nextIndex;
    setHistoryIndex(nextIndex);
    applySnapshot(history[nextIndex]);
  };

  const updateThickness = (newThickness: number) => {
    if (activeTool === 'multi-wall' && selectedWallIndices.length > 0) {
      const newWalls = [...walls];
      selectedWallIndices.forEach((wallIndex) => {
        if (newWalls[wallIndex]) {
          newWalls[wallIndex].thickness = newThickness;
        }
      });
      pushHistorySnapshot({
        walls: newWalls,
        currentThickness: newThickness,
      }, {
        selection: getSelectionState(),
      });
      return;
    }

    if (selectedWallIndex !== null) {
      const newWalls = [...walls];
      newWalls[selectedWallIndex].thickness = newThickness;
      pushHistorySnapshot({
        walls: newWalls,
        currentThickness: newThickness,
      }, {
        selection: getSelectionState(),
      });
      return;
    }
    setCurrentThickness(newThickness);
  };

  const updateOpeningWidth = (newWidth: number) => {
    if (selectedOpeningIndex !== null) {
      const newOpenings = [...openings];
      newOpenings[selectedOpeningIndex].width = newWidth;
      pushHistorySnapshot({
        openings: newOpenings,
        currentOpeningWidth: newWidth,
      }, {
        selection: getSelectionState(),
      });
      return;
    }
    setCurrentOpeningWidth(newWidth);
  };

  const applyScale = (factor: number, options?: { preserveControlSizes?: boolean }) => {
    let nextFactor = factor;
    let scaledGeometry = scaleGeometry(wallsRef.current, openingsRef.current, nextFactor);
    let scaledBounds = getBoundsForGeometry(scaledGeometry.walls, scaledGeometry.openings);

    if (scaledBounds) {
      const availableWidth = SCALE_CANVAS_WIDTH - 1;
      const availableHeight = SCALE_CANVAS_HEIGHT - 1;
      const boundsWidth = Math.max(scaledBounds.maxX - scaledBounds.minX, 1);
      const boundsHeight = Math.max(scaledBounds.maxY - scaledBounds.minY, 1);
      const fitFactor = Math.min(availableWidth / boundsWidth, availableHeight / boundsHeight, 1);

      if (fitFactor < 1) {
        nextFactor *= fitFactor;
        scaledGeometry = scaleGeometry(wallsRef.current, openingsRef.current, nextFactor);
        scaledBounds = getBoundsForGeometry(scaledGeometry.walls, scaledGeometry.openings);
      }
    }

    if (scaledBounds) {
      let dx = 0;
      let dy = 0;

      if (scaledBounds.minX < 0) dx = -scaledBounds.minX;
      else if (scaledBounds.maxX > SCALE_CANVAS_WIDTH) dx = SCALE_CANVAS_WIDTH - scaledBounds.maxX;

      if (scaledBounds.minY < 0) dy = -scaledBounds.minY;
      else if (scaledBounds.maxY > SCALE_CANVAS_HEIGHT) dy = SCALE_CANVAS_HEIGHT - scaledBounds.maxY;

      scaledGeometry = translateGeometry(scaledGeometry.walls, scaledGeometry.openings, dx, dy);
    }

    setBackgroundScale((prev) => prev * nextFactor);
    setBackgroundTransform((prev) => ({
      ...prev,
      x: prev.x * nextFactor,
      y: prev.y * nextFactor,
    }));

    pushHistorySnapshot({
      walls: scaledGeometry.walls,
      openings: scaledGeometry.openings,
      currentThickness: options?.preserveControlSizes ? currentThicknessRef.current : currentThicknessRef.current * nextFactor,
      currentOpeningWidth: options?.preserveControlSizes ? currentOpeningWidthRef.current : currentOpeningWidthRef.current * nextFactor,
    }, {
      selection: getSelectionState(),
    });
  };

  const createWallCascadeDeletion = useCallback((wallIndex: number) => {
    const wallToDelete = wallsRef.current[wallIndex];
    if (!wallToDelete) return null;

    return {
      walls: wallsRef.current.filter((_, index) => index !== wallIndex),
      openings: openingsRef.current.filter((opening) => opening.wallId !== wallToDelete.id),
    };
  }, []);

  const commitSizeInput = useCallback(() => {
    setIsEditingSizeInput(false);
    const parsedValue = parseFloat(sizeInputValue);

    if (Number.isNaN(parsedValue)) {
      if (activeTool === 'multi-wall' && selectedWallIndices.length > 0 && getMultiWallThicknessValue() === null) {
        setSizeInputValue('');
        return;
      }
      setSizeInputValue(formatDisplayValue(getControlValue()));
      return;
    }

    if (getControlContext() === 'opening') {
      const normalizedValue = Math.max(fromDisplayUnits(parsedValue), 20);
      updateOpeningWidth(normalizedValue);
      setSizeInputValue(formatDisplayValue(normalizedValue));
      return;
    }

    const normalizedValue = Math.max(fromDisplayUnits(parsedValue), 5);
    updateThickness(normalizedValue);
    setSizeInputValue(formatDisplayValue(normalizedValue));
  }, [activeTool, formatDisplayValue, fromDisplayUnits, getControlContext, getControlValue, getMultiWallThicknessValue, selectedWallIndices.length, sizeInputValue]);

  const handleSizeInputChange = useCallback((nextValue: string) => {
    setSizeInputValue(nextValue);

    const parsedValue = parseFloat(nextValue);
    if (Number.isNaN(parsedValue)) return;

    if (selectedOpeningIndex !== null) {
      updateOpeningWidth(Math.max(fromDisplayUnits(parsedValue), 20));
      return;
    }

    if (selectedWallIndex !== null) {
      updateThickness(Math.max(fromDisplayUnits(parsedValue), 5));
    }
    if (activeTool === 'multi-wall' && selectedWallIndices.length > 0) {
      updateThickness(Math.max(fromDisplayUnits(parsedValue), 5));
    }
  }, [activeTool, fromDisplayUnits, selectedOpeningIndex, selectedWallIndex, selectedWallIndices.length]);

  const stopUiMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    markUiOverlayInteraction(e);
  }, [markUiOverlayInteraction]);

  const stopUiMouseUp = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    markUiOverlayInteraction(e);
  }, [markUiOverlayInteraction]);

  const stopUiClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    markUiOverlayInteraction(e);
  }, [markUiOverlayInteraction]);

  const stopUiPointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    markUiOverlayInteraction(e);
  }, [markUiOverlayInteraction]);

  const stopUiPointerUp = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    markUiOverlayInteraction(e);
  }, [markUiOverlayInteraction]);

  const stopUiTouchStart = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    markUiOverlayInteraction(e);
  }, [markUiOverlayInteraction]);

  const stopUiTouchEnd = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    markUiOverlayInteraction(e);
  }, [markUiOverlayInteraction]);

  const stopUiWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
  }, []);

  const toggleGuideGroup = useCallback((group: GuideGroup) => {
    setOpenGuideGroup((current) => current === group ? null : group);
    setHighlightedGuideGroup(group);
    if (guideHighlightTimeoutRef.current !== null) {
      window.clearTimeout(guideHighlightTimeoutRef.current);
    }
    guideHighlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightedGuideGroup((current) => current === group ? null : current);
      guideHighlightTimeoutRef.current = null;
    }, 1400);
  }, []);

  const activateTool = useCallback((nextTool: 'draw' | 'select' | 'multi-wall' | 'door' | 'window' | 'window-floor' | 'delete') => {
    setActiveTool(nextTool);
    setIsMobileToolsOpen(false);
    setMobileOverlayPanel(null);
    setIsRoomMeasureMode(false);
    setRoomMeasureMessage(null);
    setPrintFrame(null);
    setDraggingPrintFrame(null);
    setPrintStatusMessage(null);
    setIsPrintPanelOpen(false);
    setCurrentStart(null);
    setContinuationDirections(null);
    setAlignmentGuides([]);
    setActiveSnapNode(null);
    setDraggingPoint(null);
    setDraggingWallGroup(null);
    setDraggingOpening(null);
    setMarqueeSelection(null);
    setMarqueeMode(null);
    setPendingMultiWallToggle(null);
    resetWallLengthInput();

    if (nextTool !== 'multi-wall') {
      setSelectedWallIndices([]);
    }

    if (nextTool !== 'select') {
      setSelectedWallIndex(null);
      setSelectedOpeningIndex(null);
    }
  }, [resetWallLengthInput]);

  const toggleRoomMeasureMode = useCallback(() => {
    setIsRoomMeasureMode((current) => {
      const next = !current;
      if (next) {
        setPrintFrame(null);
        setDraggingPrintFrame(null);
        setPrintStatusMessage(null);
        setRoomMeasureMessage('Room measure mode: click inside a closed room.');
        setCurrentStart(null);
        setContinuationDirections(null);
        setAlignmentGuides([]);
        setActiveSnapNode(null);
        setDraggingPoint(null);
        setDraggingWallGroup(null);
        setDraggingOpening(null);
        setMarqueeSelection(null);
        setMarqueeMode(null);
        setPendingMultiWallToggle(null);
        setSelectedWallIndex(null);
        setSelectedOpeningIndex(null);
        setSelectedWallIndices([]);
        resetWallLengthInput();
      } else {
        setRoomMeasureMessage(null);
      }
      return next;
    });
  }, [resetWallLengthInput]);

  useEffect(() => {
    scheduleFitToView();
  }, [imageUrl, mode, scheduleFitToView]);

  useEffect(() => {
    if (mode === 'trace' && imageUrl) {
      scheduleFitToView();
    }
  }, [aspectRatio, imageUrl, mode, scheduleFitToView]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const observer = new ResizeObserver(() => {
      scheduleFitToView();
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [scheduleFitToView]);

  useEffect(() => {
    if (!isEditingSizeInput) {
      if (activeTool === 'multi-wall' && selectedWallIndices.length > 0 && getMultiWallThicknessValue() === null) {
        setSizeInputValue('');
        return;
      }
      setSizeInputValue(formatDisplayValue(getControlValue()));
    }
  }, [activeTool, currentOpeningWidth, currentThickness, displayUnit, formatDisplayValue, getControlValue, getMultiWallThicknessValue, isEditingSizeInput, selectedOpeningIndex, selectedWallIndex, selectedWallIndices.length]);

  useEffect(() => {
    if (activeTool !== 'draw' || !currentStart) {
      setAlignmentGuides([]);
      if (activeTool !== 'draw' || !currentStart) {
        setContinuationDirections(null);
      }
    }
  }, [activeTool, currentStart]);

  useEffect(() => {
    if (mode !== 'scale' || activeTool !== 'draw' || !currentStart) {
      resetWallLengthInput();
    }
  }, [activeTool, currentStart, mode, resetWallLengthInput]);

  const handleFinish = () => {
    if (walls.length === 0) return;
    onComplete({
      walls,
      openings,
      suggestedScale: backgroundScale,
      imageAspectRatio: aspectRatio
    });
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isLengthDrivenWallDraft = activeTool === 'draw' && currentStart !== null;
      const wallLengthInputChar = getWallLengthInputChar(e);

      if (isLengthDrivenWallDraft && wallLengthInputChar && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (!isWallLengthInputActive) {
          const previewPoint = getCurrentWallPreviewPoint() ?? getSnapResult(rawMousePos, e.shiftKey, {
            anchor: currentStart,
            allowAlignment: true,
            continuationDirections,
          }).point;
          const nextDirection = normalizeDirection(currentStart, previewPoint) ?? { x: 1, y: 0 };
          setLockedWallDirection(nextDirection);
          setWallLengthInputValue(sanitizeWallLengthInput(wallLengthInputChar));
          setIsWallLengthInputActive(true);
          setAlignmentGuides([]);
          setActiveSnapNode(null);
          return;
        }

        setWallLengthInputValue((prev) => sanitizeWallLengthInput(`${prev}${wallLengthInputChar}`));
        return;
      }

      if (isWallLengthInputActive) {
        if (e.key === 'Backspace') {
          e.preventDefault();
          setWallLengthInputValue((prev) => prev.slice(0, -1));
          return;
        }

        if (e.key === 'Enter') {
          e.preventDefault();
          if (currentStart && lockedWallDirection) {
            const typedMeters = parseWallLengthMeters(wallLengthInputValue);
            if (typedMeters !== null) {
              commitWallSegment({
                x: currentStart.x + lockedWallDirection.x * typedMeters * 100,
                y: currentStart.y + lockedWallDirection.y * typedMeters * 100,
              });
            }
          }
          return;
        }

        if (e.code === 'Escape') {
          e.preventDefault();
          resetWallLengthInput();
          return;
        }

        return;
      }

      if (e.code === 'Space') setPanMode(true);
      if (e.code === 'KeyW') activateTool('draw');
      if (e.code === 'KeyV') activateTool('select');
      if (e.code === 'KeyM') activateTool('multi-wall');
      if (e.code === 'KeyD') activateTool('door');
      if (e.code === 'KeyF') activateTool('window');
      if (e.code === 'KeyX') activateTool('delete');
      
      if (e.code === 'Escape') {
        if (isWallLengthInputActive) return;
        setIsAdjustingBackground(false);
        setBackgroundDragOrigin(null);
        setAlignmentGuides([]);
        setActiveSnapNode(null);
        setCurrentStart(null);
        setContinuationDirections(null);
        setSelectedWallIndex(null);
        setSelectedOpeningIndex(null);
        setDraggingWallGroup(null);
        setPendingMultiWallToggle(null);
        setMarqueeSelection(null);
        if (activeTool === 'multi-wall') {
          setSelectedWallIndices([]);
        }
        if (activeTool === 'delete') activateTool('select');
      }
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        if (e.shiftKey) handleRedo();
        else handleUndo();
      }
      if (e.key === 'y' && (e.ctrlKey || e.metaKey)) handleRedo();
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedWallIndex !== null) {
          const cascadeDelete = createWallCascadeDeletion(selectedWallIndex);
          if (cascadeDelete) {
            pushHistorySnapshot(cascadeDelete, {
              selection: null,
            });
          }
        }
        if (selectedOpeningIndex !== null) {
          pushHistorySnapshot({
            openings: openings.filter((_, i) => i !== selectedOpeningIndex),
          }, {
            selection: null,
          });
        }
      }
      
      if (e.key === '+' || e.key === '=') {
        if (getControlContext() === 'opening') {
          updateOpeningWidth(Math.min(currentOpeningWidth + 10, 500));
        } else {
          updateThickness(Math.min(getControlValue() + 5, 100));
        }
      }
      if (e.key === '-' || e.key === '_') {
        if (getControlContext() === 'opening') {
          updateOpeningWidth(Math.max(currentOpeningWidth - 10, 20));
        } else {
          updateThickness(Math.max(getControlValue() - 5, 5));
        }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setPanMode(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [activateTool, activeTool, commitWallSegment, continuationDirections, createWallCascadeDeletion, currentOpeningWidth, currentStart, currentThickness, getControlContext, getControlValue, getCurrentWallPreviewPoint, getSnapResult, getWallLengthInputChar, handleRedo, isWallLengthInputActive, lockedWallDirection, openings, parseWallLengthMeters, pushHistorySnapshot, rawMousePos, resetWallLengthInput, sanitizeWallLengthInput, selectedOpeningIndex, selectedWallIndex, wallLengthInputValue, workflowStep]);

  const getToolInstruction = () => {
    if (isReferenceCalibration) {
      if (referenceCalibrationSegment) return "Enter the real length of the reference segment in the dialog below";
      if (referenceCalibrationStart) return "Click the second point of the reference segment";
      return "Click the first point of the reference segment";
    }
    if (isCalibrating) return calibrationWallIndex === null ? "Select one traced wall to recalibrate the scale" : "Enter the real internal span in the dialog below";
    if (isPrintModeActive) return printStatusMessage ?? "Print mode: position the A4 frame, then export the PDF.";
    if (isRoomMeasureMode) return roomMeasureMessage ?? "Room measure mode: click inside a closed room.";
    if (isMultiWallRotationMode) return "Rotation mode: CTRL + left click = rotate 15 degrees clockwise";
    if (isMultiWallRotationMode) return "Rotation mode: left click = 15° CCW, right click = 15° CW";
    if (isAdjustingBackground && hasBackground) return "Drag to move the reference • use rotate controls to straighten it";
    if (panMode || isDragging) return "Drag to move the view";
    const isDrawToolActive = activeTool === 'draw';
    if (isDrawToolActive) {
      return workflowStep === 'scale'
        ? (currentStart ? "Click for the second point of the reference segment â€¢ SHIFT = soft constraints" : "Click for the first point of the reference segment")
        : (currentStart ? "Click for the second point â€¢ SHIFT = soft constraints" : "Click for the first wall point");
    }
    switch (activeTool as any) {
      case 'draw': return currentStart ? "Click for the second point • SHIFT = soft constraints" : "Click for the first wall point";
      case 'door': return "Click a wall to insert a door";
      case 'window': return "Click a wall to insert a window";
      case 'window-floor': return "Click a wall to insert a floor window";
      case 'select': return "Drag nodes to edit • click to select";
      case 'multi-wall': return "Click walls to build a group • SHIFT + drag = marquee • drag to move";
      case 'delete': return "Click elements to remove them";
      default: return "";
    }
  };

  const currentGuideContent = GUIDE_PANEL_CONTENT[workflowStep === 'trace' ? 'trace' : 'scale'];

  const getGuidePanelStyle = useCallback((group: GuideGroup) => {
    void guideViewportTick;

    const anchorMap: Record<GuideGroup, React.RefObject<HTMLDivElement | null>> = {
      drawing: drawingGuideAnchorRef,
      interaction: interactionGuideAnchorRef,
      environment: environmentGuideAnchorRef,
    };

    const anchor = anchorMap[group].current;
    if (!anchor || typeof window === 'undefined') {
      return {
        left: 220,
        top: GUIDE_PANEL_TOP_MARGIN,
      };
    }

    const rect = anchor.getBoundingClientRect();
    const panelHeight = Math.min(420, window.innerHeight - GUIDE_PANEL_TOP_MARGIN - GUIDE_PANEL_EDGE_MARGIN);
    const unclampedTop = rect.top + rect.height / 2 - panelHeight / 2;
    const top = Math.min(
      Math.max(unclampedTop, GUIDE_PANEL_TOP_MARGIN),
      window.innerHeight - panelHeight - GUIDE_PANEL_EDGE_MARGIN
    );
    const maxLeft = Math.max(GUIDE_PANEL_EDGE_MARGIN, window.innerWidth - GUIDE_PANEL_WIDTH - GUIDE_PANEL_EDGE_MARGIN);
    const left = Math.min(rect.right + 12, maxLeft);

    return {
      left,
      top,
      maxHeight: panelHeight,
    };
  }, [guideViewportTick]);

  // Phase 1 keeps the existing desktop mouse flow intact.
  // These bindings isolate the mouse-only surface so phase 2 can migrate to Pointer Events in one place.
  const interactionSurfaceEventProps = {
    onMouseDown: handleMouseDown,
    onMouseMove: handleMouseMove,
    onMouseUp: handleMouseUp,
    onMouseLeave: handleMouseUp,
    onContextMenu: handleContextMenu,
    onWheel: handleWheel,
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerCancel,
  };

  return (
    <div className="flex flex-1 flex-col bg-[#E4E3E0] select-none">
      {/* Overlays */}
      <AnimatePresence>
        {isCalibrating && (
          <motion.div 
            key="calibration-dialog"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="absolute bottom-24 left-3 right-3 z-50 rounded-3xl border border-[#141414]/10 bg-white p-5 shadow-2xl md:left-1/2 md:right-auto md:min-w-[320px] md:-translate-x-1/2 md:p-6"
            onMouseDown={stopUiMouseDown}
            onPointerDown={stopUiPointerDown}
          >
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold uppercase tracking-widest opacity-40">Calibration</h3>
                <button onClick={() => {
                  setIsCalibrating(false);
                  setCalibrationMode('wall');
                  setCalibrationWallIndex(null);
                  setReferenceCalibrationStart(null);
                  setReferenceCalibrationSegment(null);
                }} className="p-1 hover:bg-[#141414]/5 rounded-lg">
                  <Trash2 className="w-4 h-4 opacity-40" />
                </button>
              </div>
              
              <p className="text-xs text-[#141414]/60 italic">
                {isReferenceCalibration
                  ? "Draw a thin reference segment over a known distance, then enter its real measurement to lock the project scale."
                  : calibrationWallIndex === null
                    ? "Select one traced wall and enter its real internal span to manually recalibrate the project scale."
                    : "Enter the real internal span of the selected wall segment."}
              </p>

              {(isReferenceCalibration ? referenceCalibrationSegment !== null : calibrationWallIndex !== null) && (
                <div className="space-y-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold uppercase opacity-40">{isReferenceCalibration ? 'Real reference length (m)' : 'Real internal span (m)'}</label>
                    <div className="flex items-center gap-2">
                      <input 
                        type="number" 
                        step="0.01"
                        value={realLengthInput}
                        onChange={(e) => setRealLengthInput(e.target.value)}
                        className="flex-1 bg-[#141414]/5 border-none rounded-xl px-4 py-3 text-sm font-mono focus:ring-2 focus:ring-[#141414]/10"
                        autoFocus
                      />
                      <span className="text-sm font-bold opacity-40">m</span>
                    </div>
                  </div>
                  
                  <button 
                    onClick={() => {
                      const currentPx = isReferenceCalibration && referenceCalibrationSegment
                        ? Math.hypot(
                            referenceCalibrationSegment.end.x - referenceCalibrationSegment.start.x,
                            referenceCalibrationSegment.end.y - referenceCalibrationSegment.start.y,
                          )
                        : calibrationWallIndex !== null
                          ? getCalibrationReferenceLength(walls[calibrationWallIndex])
                          : 0;
                      const targetMeters = parseFloat(realLengthInput);
                      const targetCm = targetMeters * 100;
                      if (!isNaN(targetCm) && currentPx > 0) {
                        const factor = targetCm / currentPx;
                        applyScale(factor, { preserveControlSizes: isPrimaryScaleStep });
                        if (isReferenceCalibration) {
                          setReferenceCalibrationSegment(null);
                          setReferenceCalibrationStart(null);
                          setActiveTool('draw');
                        } else if (isPrimaryScaleStep) {
                          pushHistorySnapshot({
                            walls: [],
                            openings: [],
                            currentThickness: DEFAULT_WALL_THICKNESS,
                            currentOpeningWidth: 80,
                          }, {
                            selection: null,
                          });
                          setActiveTool('draw');
                        }
                        onScaleCalibrated();
                        setIsCalibrating(false);
                        setCalibrationMode('wall');
                        setCalibrationWallIndex(null);
                        scheduleFitToView();
                      }
                    }}
                    className="w-full py-3 bg-[#141414] text-white rounded-xl text-xs font-bold shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all"
                  >
                    {isReferenceCalibration ? 'SET SCALE AND CONTINUE' : 'RECALIBRATE'}
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {showGuide && (
          <motion.div 
            key="guide-panel"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="absolute top-24 right-8 w-64 p-6 bg-white/95 backdrop-blur-xl border border-[#141414]/10 rounded-3xl shadow-2xl z-40 space-y-6"
            onMouseDown={stopUiMouseDown}
            onPointerDown={stopUiPointerDown}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest opacity-40">Editor Guide</h3>
              <button onClick={() => setShowGuide(false)} className="opacity-40 hover:opacity-100 transition-opacity">
                <Plus className="w-4 h-4 rotate-45" />
              </button>
            </div>

            <div className="space-y-4 text-[11px] leading-relaxed">
              <div className="space-y-1">
                <p className="font-bold uppercase tracking-tighter">Wall</p>
                <p className="opacity-60">Click two points to draw. Hold <span className="font-mono bg-[#141414]/5 px-1 rounded">SHIFT</span> for 45° constraints. Snapping stays soft on endpoints and X/Y alignments. Drag nodes to edit.</p>
                <p className="opacity-60 italic"><span className="font-bold">THICK</span> = wall thickness.</p>
              </div>

              <div className="space-y-1">
                <p className="font-bold uppercase tracking-tighter">Door / Window</p>
                <p className="opacity-60">Click a wall to insert one. Drag to position it.</p>
                <p className="opacity-60 italic"><span className="font-bold">THICK</span> = opening length.</p>
              </div>

              <div className="space-y-1">
                <p className="font-bold uppercase tracking-tighter">Navigation</p>
                <p className="opacity-60">Use the mouse wheel to zoom. Hold <span className="font-mono bg-[#141414]/5 px-1 rounded">SPACE</span> to move the view.</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {(isMobileToolsOpen || isMobilePropertiesOpen || mobileOverlayPanel !== null) && (
          <motion.div
            key="mobile-drawer-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            data-ui-overlay="true"
            className="absolute inset-0 z-40 bg-[#141414]/28 backdrop-blur-[2px] md:hidden"
            onMouseDown={(event) => {
              stopUiMouseDown(event);
              setIsMobileToolsOpen(false);
              setIsMobilePropertiesOpen(false);
              setMobileOverlayPanel(null);
            }}
            onPointerDown={(event) => {
              stopUiPointerDown(event);
              setIsMobileToolsOpen(false);
              setIsMobilePropertiesOpen(false);
              setMobileOverlayPanel(null);
            }}
            onTouchStart={(event) => {
              stopUiTouchStart(event);
              setIsMobileToolsOpen(false);
              setIsMobilePropertiesOpen(false);
              setMobileOverlayPanel(null);
            }}
          />
        )}
      </AnimatePresence>

      <div 
        className="relative flex-1 overflow-hidden bg-[#D1D0CD]"
        ref={containerRef}
        {...interactionSurfaceEventProps}
        style={{ 
          touchAction: 'none',
          cursor: isAdjustingBackground && hasBackground
            ? (backgroundDragOrigin ? 'grabbing' : 'grab')
            : isPrintModeActive
            ? (draggingPrintFrame ? 'grabbing' : 'grab')
            : isRoomMeasureMode
            ? 'crosshair'
            : activeTool === 'delete' 
            ? 'crosshair' 
            : (panMode ? (isDragging ? 'grabbing' : 'grab') : (draggingPoint || draggingWallGroup ? 'grabbing' : (activeTool === 'draw' ? 'crosshair' : (activeTool === 'multi-wall' ? 'grab' : 'default')))) 
        }}
      >
        <div data-ui-overlay="true" className="absolute left-3 right-3 top-3 z-30 grid grid-cols-[minmax(0,1fr)_auto_auto_minmax(0,1fr)] items-center gap-2 md:hidden" onMouseDown={stopUiMouseDown} onMouseUp={stopUiMouseUp} onClick={stopUiClick} onPointerDown={stopUiPointerDown} onPointerUp={stopUiPointerUp} onTouchStart={stopUiTouchStart} onTouchEnd={stopUiTouchEnd}>
          <button
            type="button"
            onClick={() => {
              setIsMobileToolsOpen((current) => {
                const next = !current;
                if (next) {
                  setIsMobilePropertiesOpen(false);
                }
                return next;
              });
            }}
            className="flex min-h-11 items-center gap-2 rounded-full border border-[#141414]/10 bg-white/88 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#141414] shadow-xl backdrop-blur-md"
          >
            {isMobileToolsOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            Tools
          </button>
          <button
            type="button"
            onClick={handleUndo}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-[#141414]/10 bg-white/88 text-[#141414] shadow-xl backdrop-blur-md"
            aria-label="Undo"
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleRedo}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-[#141414]/10 bg-white/88 text-[#141414] shadow-xl backdrop-blur-md"
            aria-label="Redo"
          >
            <Redo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setIsMobilePropertiesOpen((current) => {
                const next = !current;
                if (next) {
                  setIsMobileToolsOpen(false);
                }
                return next;
              });
            }}
            className="flex min-h-11 items-center gap-2 rounded-full border border-[#141414]/10 bg-white/88 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#141414] shadow-xl backdrop-blur-md"
          >
            {isMobilePropertiesOpen ? <X className="h-4 w-4" /> : <SlidersHorizontal className="h-4 w-4" />}
            Panels
          </button>
        </div>

        <AnimatePresence>
          {isMobileToolsOpen && (
            <motion.div
              key="mobile-tools-drawer"
              initial={{ opacity: 0, x: -24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              data-ui-overlay="true"
              className="absolute left-3 top-16 z-50 max-h-[calc(100dvh-6.5rem)] w-[min(20rem,calc(100%-3rem))] overflow-y-auto rounded-[28px] border border-[#141414]/10 bg-white/95 p-4 pb-5 shadow-2xl backdrop-blur-md md:hidden"
              onMouseDown={stopUiMouseDown}
              onMouseUp={stopUiMouseUp}
              onClick={stopUiClick}
              onPointerDown={stopUiPointerDown}
              onPointerUp={stopUiPointerUp}
              onTouchStart={stopUiTouchStart}
              onTouchEnd={stopUiTouchEnd}
              style={{ touchAction: 'pan-y', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}
            >
              <div className="flex max-h-full flex-col">
                <div className="sticky top-0 z-10 -mx-4 -mt-4 flex shrink-0 items-center justify-between rounded-t-[28px] border-b border-[#141414]/8 bg-white/96 px-4 py-4 backdrop-blur-md">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#141414]/38">Tool Picker</p>
                    <p className="mt-1 text-xs text-[#141414]/55">Mostra un solo gruppo di controlli alla volta.</p>
                  </div>
                  <button type="button" onClick={() => setIsMobileToolsOpen(false)} className="rounded-full p-2 text-[#141414]/45 hover:bg-[#141414]/5 hover:text-[#141414]">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="space-y-4 overflow-y-auto pt-4">
                <div className="space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#141414]/38">Draw</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => activateTool('draw')} className={`min-h-12 rounded-2xl px-3 py-3 text-[10px] font-bold uppercase tracking-[0.16em] ${activeTool === 'draw' ? 'bg-[#141414] text-white' : 'bg-[#141414]/5 text-[#141414]'}`}>Wall</button>
                    <button onClick={() => activateTool('door')} className={`min-h-12 rounded-2xl px-3 py-3 text-[10px] font-bold uppercase tracking-[0.16em] ${activeTool === 'door' ? 'bg-[#141414] text-white' : 'bg-[#141414]/5 text-[#141414]'}`}>Door</button>
                    <button onClick={() => activateTool('window')} className={`min-h-12 rounded-2xl px-3 py-3 text-[10px] font-bold uppercase tracking-[0.16em] ${activeTool === 'window' ? 'bg-[#141414] text-white' : 'bg-[#141414]/5 text-[#141414]'}`}>Window</button>
                    <button onClick={() => activateTool('window-floor')} className={`min-h-12 rounded-2xl px-3 py-3 text-[10px] font-bold uppercase tracking-[0.16em] ${activeTool === 'window-floor' ? 'bg-[#141414] text-white' : 'bg-[#141414]/5 text-[#141414]'}`}>Full Height</button>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#141414]/38">Edit</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => activateTool('select')} className={`min-h-12 rounded-2xl px-3 py-3 text-[10px] font-bold uppercase tracking-[0.16em] ${activeTool === 'select' ? 'bg-[#141414] text-white' : 'bg-[#141414]/5 text-[#141414]'}`}>Select</button>
                    <button onClick={() => activateTool('multi-wall')} className={`min-h-12 rounded-2xl px-3 py-3 text-[10px] font-bold uppercase tracking-[0.16em] ${activeTool === 'multi-wall' ? 'bg-[#CBBBA0] text-[#141414]' : 'bg-[#141414]/5 text-[#141414]'}`}>Multi</button>
                    <button onClick={() => { if (activeTool === 'delete') activateTool('select'); else activateTool('delete'); }} className={`col-span-2 min-h-12 rounded-2xl px-3 py-3 text-[10px] font-bold uppercase tracking-[0.16em] ${activeTool === 'delete' ? 'bg-red-500 text-white' : 'bg-red-50 text-red-600'}`}>Delete</button>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#141414]/38">Reference</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => {
                        setCalibrationMode('reference');
                        setReferenceCalibrationStart(null);
                        setReferenceCalibrationSegment(null);
                        setCalibrationWallIndex(null);
                        setIsCalibrating(true);
                        activateTool('draw');
                      }}
                      className={`col-span-2 min-h-12 rounded-2xl px-3 py-3 text-[10px] font-bold uppercase tracking-[0.16em] ${
                        workflowStep === 'scale' && hasBackground && !isScaleCalibrated
                          ? 'bg-emerald-500 text-white'
                          : 'bg-[#141414]/5 text-[#141414]'
                      }`}
                    >
                      {workflowStep === 'scale' && hasBackground && !isScaleCalibrated ? 'Set Scale' : 'Recalibrate'}
                    </button>
                    {hasBackground && (
                      <>
                        <button
                          onClick={() => {
                            setShowBackground((prev) => {
                              const next = !prev;
                              if (!next) setIsAdjustingBackground(false);
                              return next;
                            });
                          }}
                          className={`min-h-12 rounded-2xl px-3 py-3 text-[10px] font-bold uppercase tracking-[0.16em] ${
                            showBackground ? 'bg-[#141414] text-white' : 'bg-[#141414]/5 text-[#141414]'
                          }`}
                        >
                          {showBackground ? 'Ref On' : 'Ref Off'}
                        </button>
                        <button
                          onClick={() => {
                            setShowBackground(true);
                            setIsAdjustingBackground((prev) => !prev);
                            activateTool('select');
                            setIsMobileToolsOpen(true);
                          }}
                          className={`min-h-12 rounded-2xl px-3 py-3 text-[10px] font-bold uppercase tracking-[0.16em] ${
                            isAdjustingBackground ? 'bg-[#141414] text-white' : 'bg-[#141414]/5 text-[#141414]'
                          }`}
                        >
                          {isAdjustingBackground ? 'Ref Move' : 'Ref Adjust'}
                        </button>
                        <div className="col-span-2 grid grid-cols-3 gap-2">
                          <button onClick={() => rotateBackground(BACKGROUND_ROTATION_STEP)} className="min-h-12 rounded-2xl bg-[#141414]/5 px-3 py-3 text-[#141414]"><RotateCcw className="mx-auto h-4 w-4" /></button>
                          <button onClick={() => resetBackgroundTransform()} className="min-h-12 rounded-2xl bg-[#141414]/5 px-3 py-3 text-[10px] font-bold uppercase tracking-[0.16em] text-[#141414]">Reset</button>
                          <button onClick={() => rotateBackground(-BACKGROUND_ROTATION_STEP)} className="min-h-12 rounded-2xl bg-[#141414]/5 px-3 py-3 text-[#141414]"><RotateCw className="mx-auto h-4 w-4" /></button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {isMobilePropertiesOpen && (
            <motion.div
              key="mobile-properties-drawer"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              data-ui-overlay="true"
              className="absolute right-3 top-16 z-50 max-h-[calc(100dvh-6.5rem)] w-[min(22rem,70vw)] max-w-[calc(100%-3rem)] overflow-y-auto rounded-[28px] border border-[#141414]/10 bg-white/95 p-4 pb-5 shadow-2xl backdrop-blur-md md:hidden"
              onMouseDown={stopUiMouseDown}
              onMouseUp={stopUiMouseUp}
              onClick={stopUiClick}
              onPointerDown={stopUiPointerDown}
              onPointerUp={stopUiPointerUp}
              onTouchStart={stopUiTouchStart}
              onTouchEnd={stopUiTouchEnd}
              style={{ touchAction: 'pan-y', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}
            >
              <div className="flex max-h-full flex-col">
                <div className="sticky top-0 z-10 -mx-4 -mt-4 flex shrink-0 items-center justify-between rounded-t-[28px] border-b border-[#141414]/8 bg-white/96 px-4 py-4 backdrop-blur-md">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#141414]/38">Properties</p>
                    <p className="mt-1 text-xs text-[#141414]/55">Controlli contestuali richiamati on demand.</p>
                  </div>
                  <button type="button" onClick={() => setIsMobilePropertiesOpen(false)} className="rounded-full p-2 text-[#141414]/45 hover:bg-[#141414]/5 hover:text-[#141414]">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="space-y-3 overflow-y-auto pt-4">
                <button
                  onClick={handleFinish}
                  disabled={walls.length === 0 || workflowStep !== 'trace' || !isScaleCalibrated}
                  className="flex min-h-12 w-full items-center justify-center gap-2 rounded-[22px] bg-emerald-500 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.16em] text-white disabled:opacity-40"
                >
                  <Check className="h-4 w-4" />
                  Generate 3D
                </button>

                <div className={`rounded-[24px] border border-[#141414]/10 bg-white/88 p-3 shadow-sm transition-all ${(selectedWallIndex !== null || selectedOpeningIndex !== null || selectedWallIndices.length > 0) ? 'ring-1 ring-emerald-200' : ''}`}>
                  <div className="space-y-2">
                    <div className="flex items-center justify-center rounded-xl bg-[#141414]/5 p-0.5">
                      <button onClick={() => setDisplayUnit('cm')} className={`flex-1 rounded-lg px-2 py-1.5 text-[9px] font-bold uppercase ${displayUnit === 'cm' ? 'bg-[#141414] text-white' : 'text-[#141414]/50'}`}>cm</button>
                      <button onClick={() => setDisplayUnit('m')} className={`flex-1 rounded-lg px-2 py-1.5 text-[9px] font-bold uppercase ${displayUnit === 'm' ? 'bg-[#141414] text-white' : 'text-[#141414]/50'}`}>m</button>
                    </div>
                    <div className="grid grid-cols-[48px_minmax(0,1fr)_48px] items-center gap-2">
                      <button
                        onClick={() => {
                          const controlContext = getControlContext();
                          const step = getUnitStep(controlContext, 'decrease');
                          if (controlContext === 'opening') updateOpeningWidth(Math.max(currentOpeningWidth + fromDisplayUnits(step), 20));
                          else updateThickness(Math.max(getControlValue() + fromDisplayUnits(step), 5));
                        }}
                        className="flex h-12 items-center justify-center rounded-2xl bg-[#141414]/5 text-[#141414]"
                      >
                        <div className="h-0.5 w-4 bg-[#141414]" />
                      </button>
                      <div className="rounded-2xl bg-[#141414]/5 px-3 py-3 text-center">
                        <span className="block text-[8px] font-bold uppercase tracking-[0.16em] text-[#141414]/40">{getControlLabel()} ({displayUnit})</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={sizeInputValue}
                          placeholder={activeTool === 'multi-wall' && selectedWallIndices.length > 0 && getMultiWallThicknessValue() === null ? 'mixed' : undefined}
                          onFocus={() => setIsEditingSizeInput(true)}
                          onChange={(e) => handleSizeInputChange(e.target.value)}
                          onBlur={commitSizeInput}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              commitSizeInput();
                              e.currentTarget.blur();
                            }
                            if (e.key === 'Escape') {
                              setIsEditingSizeInput(false);
                              setSizeInputValue(
                                activeTool === 'multi-wall' && selectedWallIndices.length > 0 && getMultiWallThicknessValue() === null
                                  ? ''
                                  : formatDisplayValue(getControlValue())
                              );
                              e.currentTarget.blur();
                            }
                          }}
                          className="mt-1 w-full bg-transparent text-center text-[13px] font-mono font-bold focus:outline-none"
                        />
                      </div>
                      <button
                        onClick={() => {
                          const controlContext = getControlContext();
                          const step = getUnitStep(controlContext, 'increase');
                          if (controlContext === 'opening') updateOpeningWidth(Math.min(currentOpeningWidth + fromDisplayUnits(step), 500));
                          else updateThickness(Math.min(getControlValue() + fromDisplayUnits(step), 100));
                        }}
                        className="flex h-12 items-center justify-center rounded-2xl bg-[#141414]/5 text-[#141414]"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                    <div className={`rounded-2xl px-3 py-3 text-center ${isWallLengthInputActive ? 'bg-[#CBBBA0]' : 'bg-[#141414]/5'}`}>
                      <span className="block text-[8px] font-bold uppercase tracking-[0.16em] text-[#141414]/40">Length (m)</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        readOnly={!isWallLengthInputActive}
                        value={getDisplayedWallLength()}
                        onChange={(e) => {
                          if (!isWallLengthInputActive) return;
                          setWallLengthInputValue(sanitizeWallLengthInput(e.target.value));
                        }}
                        className={`mt-1 w-full bg-transparent text-center text-[13px] font-mono font-bold focus:outline-none ${isWallLengthInputActive ? 'text-[#141414]' : ''}`}
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMobileOverlayPanel('measure');
                      setIsMobilePropertiesOpen(false);
                    }}
                    className={`min-h-11 rounded-2xl px-3 py-3 text-[10px] font-bold uppercase tracking-[0.16em] ${
                      mobileOverlayPanel === 'measure' || isRoomMeasureMode ? 'bg-[#CBBBA0] text-[#141414]' : 'bg-[#141414]/5 text-[#141414]'
                    }`}
                  >
                    Measure
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileOverlayPanel('print');
                      setIsMobilePropertiesOpen(false);
                    }}
                    className={`min-h-11 rounded-2xl px-3 py-3 text-[10px] font-bold uppercase tracking-[0.16em] ${
                      mobileOverlayPanel === 'print' || isPrintPanelOpen || isPrintModeActive ? 'bg-[#CBBBA0] text-[#141414]' : 'bg-[#141414]/5 text-[#141414]'
                    }`}
                  >
                    Print
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => {
                      if (!containerRef.current) return;
                      const rect = containerRef.current.getBoundingClientRect();
                      zoomAtPoint(zoomRef.current / ZOOM_BUTTON_FACTOR, rect.left + rect.width / 2, rect.top + rect.height / 2);
                    }}
                    className="min-h-11 rounded-2xl bg-[#141414]/5 px-3 py-3 text-[#141414]"
                  >
                    <ZoomOut className="mx-auto h-4 w-4" />
                  </button>
                  <div className="flex min-h-11 items-center justify-center rounded-2xl bg-[#141414]/5 px-3 py-3 text-[10px] font-bold uppercase tracking-[0.16em] text-[#141414]">
                    {Math.round(zoom * 100)}%
                  </div>
                  <button
                    onClick={() => {
                      if (!containerRef.current) return;
                      const rect = containerRef.current.getBoundingClientRect();
                      zoomAtPoint(zoomRef.current * ZOOM_BUTTON_FACTOR, rect.left + rect.width / 2, rect.top + rect.height / 2);
                    }}
                    className="min-h-11 rounded-2xl bg-[#141414]/5 px-3 py-3 text-[#141414]"
                  >
                    <ZoomIn className="mx-auto h-4 w-4" />
                  </button>
                </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {mobileOverlayPanel === 'measure' && (
            <motion.div
              key="mobile-measure-panel"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              data-ui-overlay="true"
              className="absolute inset-x-3 top-16 z-50 max-h-[calc(100dvh-6.5rem)] overflow-y-auto rounded-[28px] border border-[#141414]/10 bg-white/96 p-4 pb-6 shadow-2xl backdrop-blur-md md:hidden"
              onMouseDown={stopUiMouseDown}
              onMouseUp={stopUiMouseUp}
              onClick={stopUiClick}
              onPointerDown={stopUiPointerDown}
              onPointerUp={stopUiPointerUp}
              onTouchStart={stopUiTouchStart}
              onTouchEnd={stopUiTouchEnd}
              style={{ touchAction: 'pan-y', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}
            >
              <div className="space-y-4">
                <div className="sticky top-0 z-10 -mx-4 -mt-4 flex items-center justify-between rounded-t-[28px] border-b border-[#141414]/8 bg-white/96 px-4 py-4 backdrop-blur-md">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#141414]/38">Measure</p>
                    <p className="mt-1 text-xs text-[#141414]/55">Perimetro, area e stato della misurazione stanza.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMobileOverlayPanel(null)}
                    className="rounded-full p-2 text-[#141414]/45 hover:bg-[#141414]/5 hover:text-[#141414]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={toggleRoomMeasureMode}
                  className={`flex min-h-12 w-full items-center justify-center rounded-[22px] px-4 py-3 text-[10px] font-bold uppercase tracking-[0.16em] ${
                    isRoomMeasureMode ? 'bg-[#CBBBA0] text-[#141414]' : 'bg-[#141414] text-white'
                  }`}
                >
                  {isRoomMeasureMode ? 'Measure Mode Active' : 'Enable Measure Mode'}
                </button>

                <div className="rounded-[24px] bg-[#F1ECE3] p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#6C5A46]">Status</p>
                  <p className="mt-2 text-sm leading-6 text-[#141414]/72">
                    {roomMeasureMessage ?? 'Tap inside a closed room to calculate perimeter and area.'}
                  </p>
                </div>

                <div className="overflow-hidden rounded-[24px] border border-[#141414]/10 bg-white/92">
                  <div className="px-4 py-4 text-center">
                    <span className="block text-[9px] font-bold uppercase tracking-[0.16em] text-[#141414]/38">Perimeter (m)</span>
                    <span className="mt-2 block text-lg font-mono font-bold text-[#141414]">
                      {roomMeasurement ? formatMetersValue(roomMeasurement.perimeterCm) : '--'}
                    </span>
                  </div>
                  <div className="border-t border-[#141414]/10 px-4 py-4 text-center">
                    <span className="block text-[9px] font-bold uppercase tracking-[0.16em] text-[#141414]/38">Area (m²)</span>
                    <span className="mt-2 block text-lg font-mono font-bold text-[#141414]">
                      {roomMeasurement ? formatSquareMetersValue(roomMeasurement.areaCm2) : '--'}
                    </span>
                  </div>
                </div>

                <div className="rounded-[24px] bg-[#141414]/5 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#141414]/38">How to use</p>
                  <div className="mt-3 space-y-2 text-sm leading-6 text-[#141414]/68">
                    <p>1. Activate measure mode.</p>
                    <p>2. Tap inside a closed room on the workspace.</p>
                    <p>3. Read perimeter and area here.</p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {mobileOverlayPanel === 'print' && (
            <motion.div
              key="mobile-print-panel"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              data-ui-overlay="true"
              className="absolute inset-x-3 top-16 z-50 max-h-[calc(100dvh-6.5rem)] overflow-y-auto rounded-[28px] border border-[#141414]/10 bg-white/96 p-4 pb-6 shadow-2xl backdrop-blur-md md:hidden"
              onMouseDown={stopUiMouseDown}
              onMouseUp={stopUiMouseUp}
              onClick={stopUiClick}
              onPointerDown={stopUiPointerDown}
              onPointerUp={stopUiPointerUp}
              onTouchStart={stopUiTouchStart}
              onTouchEnd={stopUiTouchEnd}
              style={{ touchAction: 'pan-y', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}
            >
              <div className="space-y-4">
                <div className="sticky top-0 z-10 -mx-4 -mt-4 flex items-center justify-between rounded-t-[28px] border-b border-[#141414]/8 bg-white/96 px-4 py-4 backdrop-blur-md">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#141414]/38">Print</p>
                    <p className="mt-1 text-xs text-[#141414]/55">Setup A4 export and keep every control reachable on mobile.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMobileOverlayPanel(null)}
                    className="rounded-full p-2 text-[#141414]/45 hover:bg-[#141414]/5 hover:text-[#141414]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="rounded-[24px] bg-[#F1ECE3] p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#6C5A46]">Print frame</p>
                  <p className="mt-2 text-sm leading-6 text-[#141414]/72">
                    {printStatusMessage ?? 'Choose scale and orientation, then place the frame on the workspace.'}
                  </p>
                </div>

                <div className="space-y-3 rounded-[24px] border border-[#141414]/10 bg-white/92 p-4">
                  <div className="space-y-2">
                    <span className="block text-[9px] font-bold uppercase tracking-[0.16em] text-[#141414]/38">Scale</span>
                    <div className="grid grid-cols-3 gap-2">
                      {[50, 100, 200].map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setPrintScale(option as PrintScaleOption)}
                          className={`min-h-11 rounded-2xl text-[10px] font-bold ${printScale === option ? 'bg-[#141414] text-white' : 'bg-[#141414]/5 text-[#141414]'}`}
                        >
                          1:{option}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <span className="block text-[9px] font-bold uppercase tracking-[0.16em] text-[#141414]/38">Orientation</span>
                    <div className="grid grid-cols-2 gap-2">
                      {(['portrait', 'landscape'] as PrintOrientation[]).map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setPrintOrientation(option)}
                          className={`min-h-11 rounded-2xl text-[10px] font-bold uppercase ${printOrientation === option ? 'bg-[#141414] text-white' : 'bg-[#141414]/5 text-[#141414]'}`}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => startPrintMode(printScale, printOrientation)}
                      className="min-h-12 rounded-2xl bg-[#141414] px-3 py-3 text-[10px] font-bold uppercase tracking-[0.16em] text-white"
                    >
                      {isPrintModeActive ? 'Update Frame' : 'Start Print Mode'}
                    </button>
                    <button
                      type="button"
                      onClick={handleExportA4Pdf}
                      disabled={!isPrintModeActive}
                      className="min-h-12 rounded-2xl bg-[#141414]/5 px-3 py-3 text-[10px] font-bold uppercase tracking-[0.16em] text-[#141414] disabled:opacity-40"
                    >
                      Export PDF
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={cancelPrintMode}
                    disabled={!isPrintModeActive && !isPrintPanelOpen}
                    className="min-h-11 w-full rounded-2xl bg-transparent px-3 py-3 text-[10px] font-bold uppercase tracking-[0.16em] text-[#141414]/55 hover:bg-[#141414]/5 disabled:opacity-30"
                  >
                    Cancel Print Mode
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="absolute left-3 right-3 top-3 z-30 hidden items-start gap-3 overflow-x-auto pb-1 md:left-6 md:right-auto md:top-6 md:block md:w-[168px] md:space-y-3 md:overflow-visible md:pb-0" ref={leftToolbarRef} onMouseDown={stopUiMouseDown} onPointerDown={stopUiPointerDown}>
          <div className="relative flex min-w-[196px] items-stretch gap-2 md:min-w-0" ref={drawingGuideAnchorRef}>
            <button
              onClick={() => toggleGuideGroup('drawing')}
              className={`w-10 shrink-0 rounded-[24px] border border-[#141414]/10 bg-white/82 shadow-xl backdrop-blur-md transition-all flex flex-col items-center justify-center gap-2 ${openGuideGroup === 'drawing' ? 'bg-[#D8C9B0] text-[#141414]' : 'text-[#141414]/55 hover:bg-white hover:text-[#141414]'}`}
              aria-label="Drawing tools guide"
            >
              <FileText className="w-4 h-4" />
              <span className="text-[8px] font-bold tracking-[0.18em] [writing-mode:vertical-rl] rotate-180">GUIDE</span>
            </button>
            <div className={`flex-1 rounded-[28px] border border-[#141414]/10 bg-white/88 p-2 shadow-xl backdrop-blur-md transition-all ${openGuideGroup === 'drawing' || highlightedGuideGroup === 'drawing' ? 'ring-1 ring-[#D8C9B0] shadow-[0_12px_30px_rgba(140,115,85,0.18)]' : ''}`}>
              <div className="space-y-1">
                <button 
                  onClick={() => activateTool('draw')}
                  className={`w-full flex flex-col items-center justify-center gap-1 p-3 rounded-2xl transition-all ${activeTool === 'draw' ? 'bg-[#141414] text-white shadow-md' : 'hover:bg-[#141414]/5 text-[#141414]'}`}
                >
                  <WallIcon />
                  <span className="text-[8px] font-bold tracking-widest">WALL</span>
                </button>
                <button 
                  onClick={() => activateTool('door')}
                  className={`w-full flex flex-col items-center justify-center gap-1 p-3 rounded-2xl transition-all ${activeTool === 'door' ? 'bg-[#141414] text-white shadow-md' : 'hover:bg-[#141414]/5 text-[#141414]'}`}
                >
                  <DoorIcon />
                  <span className="text-[8px] font-bold tracking-widest">DOOR</span>
                </button>
                <div className="grid grid-cols-2 gap-1">
                  <button 
                    onClick={() => activateTool('window')}
                    className={`w-full flex flex-col items-center justify-center gap-1 p-3 rounded-2xl transition-all ${activeTool === 'window' ? 'bg-[#141414] text-white shadow-md' : 'hover:bg-[#141414]/5 text-[#141414]'}`}
                  >
                    <WindowIcon />
                    <span className="text-[8px] font-bold tracking-widest">WINDOW</span>
                  </button>
                  <button 
                    onClick={() => activateTool('window-floor')}
                    className={`w-full flex flex-col items-center justify-center gap-1 p-3 rounded-2xl transition-all ${activeTool === 'window-floor' ? 'bg-[#141414] text-white shadow-md' : 'hover:bg-[#141414]/5 text-[#141414]'}`}
                  >
                    <FloorWindowIcon />
                    <span className="text-[8px] font-bold tracking-[0.14em]">FULL HT</span>
                  </button>
                </div>
              </div>
            </div>
            <AnimatePresence>
              {openGuideGroup === 'drawing' && (
                <motion.div
                  key="drawing-guide"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="fixed z-40 w-72 overflow-y-auto rounded-[28px] border border-[#141414]/10 bg-white/96 p-5 shadow-2xl backdrop-blur-md"
                  style={getGuidePanelStyle('drawing')}
                  onMouseDown={stopUiMouseDown}
                  onPointerDown={stopUiPointerDown}
                  onWheel={stopUiWheel}
                >
                  <div className="space-y-4 pb-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#141414]/45">{currentGuideContent.drawing.title}</h3>
                      <button onClick={() => setOpenGuideGroup(null)} className="rounded-lg p-1 text-[#141414]/35 hover:bg-[#141414]/5 hover:text-[#141414]">
                        <Plus className="w-4 h-4 rotate-45" />
                      </button>
                    </div>
                    <div className="space-y-3 text-[11px] leading-relaxed text-[#141414]/72">
                      {currentGuideContent.drawing.sections.map((section) => (
                        <div key={section.label} className="space-y-1">
                          <p className="font-bold uppercase tracking-[0.14em] text-[#141414]/72">{section.label}</p>
                          {section.description.map((line) => (
                            <p key={line}>{line}</p>
                          ))}
                        </div>
                      ))}
                    </div>
                    {currentGuideContent.drawing.tip && <GuideTip>{currentGuideContent.drawing.tip}</GuideTip>}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="relative flex min-w-[196px] items-stretch gap-2 md:min-w-0" ref={interactionGuideAnchorRef}>
            <button
              onClick={() => toggleGuideGroup('interaction')}
              className={`w-10 shrink-0 rounded-[24px] border border-[#141414]/10 bg-white/82 shadow-xl backdrop-blur-md transition-all flex flex-col items-center justify-center gap-2 ${openGuideGroup === 'interaction' ? 'bg-[#D8C9B0] text-[#141414]' : 'text-[#141414]/55 hover:bg-white hover:text-[#141414]'}`}
              aria-label="Interaction tools guide"
            >
              <FileText className="w-4 h-4" />
              <span className="text-[8px] font-bold tracking-[0.18em] [writing-mode:vertical-rl] rotate-180">GUIDE</span>
            </button>
            <div className={`flex-1 rounded-[28px] border border-[#141414]/10 bg-white/88 p-2 shadow-xl backdrop-blur-md transition-all ${openGuideGroup === 'interaction' || highlightedGuideGroup === 'interaction' ? 'ring-1 ring-[#D8C9B0] shadow-[0_12px_30px_rgba(140,115,85,0.18)]' : ''}`}>
              <div className="grid grid-cols-2 gap-1">
                <button 
                  onClick={() => setPanMode(!panMode)}
                  className={`h-11 rounded-2xl transition-all flex items-center justify-center ${panMode ? 'bg-[#141414] text-white shadow-md' : 'hover:bg-[#141414]/5 text-[#141414]'}`}
                  title="Pan (Space)"
                >
                  <Hand className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => activateTool('select')}
                  className={`h-11 rounded-2xl transition-all flex items-center justify-center ${activeTool === 'select' ? 'bg-[#141414] text-white shadow-md' : 'hover:bg-[#141414]/5 text-[#141414]'}`}
                  title="Select (V)"
                >
                  <MousePointer2 className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => activateTool('multi-wall')}
                  className={`col-span-2 h-11 rounded-2xl transition-all flex items-center justify-center gap-2 ${activeTool === 'multi-wall' ? 'bg-[#CBBBA0] text-[#141414] shadow-md' : 'hover:bg-[#141414]/5 text-[#141414]'}`}
                  title="Multi-wall (M)"
                >
                  <MoveIcon className="w-4 h-4" />
                  <span className="text-[8px] font-bold tracking-[0.16em]">MULTI</span>
                </button>
                <button onClick={handleUndo} className="h-11 rounded-2xl transition-colors text-[#141414]/60 hover:bg-[#141414]/5 hover:text-[#141414] flex items-center justify-center" title="Undo (Ctrl+Z)">
                  <Undo2 className="w-4 h-4" />
                </button>
                <button onClick={handleRedo} className="h-11 rounded-2xl transition-colors text-[#141414]/60 hover:bg-[#141414]/5 hover:text-[#141414] flex items-center justify-center" title="Redo (Ctrl+Y)">
                  <Redo2 className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => { 
                    if (activeTool === 'delete') activateTool('select');
                    else activateTool('delete');
                  }}
                  className={`col-span-2 h-11 rounded-2xl transition-all flex items-center justify-center ${activeTool === 'delete' ? 'bg-red-500 text-white shadow-md' : 'hover:bg-red-50 text-red-500'}`}
                  title="Delete (X)"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            <AnimatePresence>
              {openGuideGroup === 'interaction' && (
                <motion.div
                  key="interaction-guide"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="fixed z-40 w-72 overflow-y-auto rounded-[28px] border border-[#141414]/10 bg-white/96 p-5 shadow-2xl backdrop-blur-md"
                  style={getGuidePanelStyle('interaction')}
                  onMouseDown={stopUiMouseDown}
                  onPointerDown={stopUiPointerDown}
                  onWheel={stopUiWheel}
                >
                  <div className="space-y-4 pb-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#141414]/45">{currentGuideContent.interaction.title}</h3>
                      <button onClick={() => setOpenGuideGroup(null)} className="rounded-lg p-1 text-[#141414]/35 hover:bg-[#141414]/5 hover:text-[#141414]">
                        <Plus className="w-4 h-4 rotate-45" />
                      </button>
                    </div>
                    <div className="space-y-3 text-[11px] leading-relaxed text-[#141414]/72">
                      {currentGuideContent.interaction.sections.map((section) => (
                        <div key={section.label} className="space-y-1">
                          <p className="font-bold uppercase tracking-[0.14em] text-[#141414]/72">{section.label}</p>
                          {section.description.map((line) => (
                            <p key={line}>{line}</p>
                          ))}
                        </div>
                      ))}
                    </div>
                    {currentGuideContent.interaction.tip && <GuideTip>{currentGuideContent.interaction.tip}</GuideTip>}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="relative flex min-w-[196px] items-stretch gap-2 md:min-w-0" ref={environmentGuideAnchorRef}>
            <button
              onClick={() => toggleGuideGroup('environment')}
              className={`w-10 shrink-0 rounded-[24px] border border-[#141414]/10 bg-white/82 shadow-xl backdrop-blur-md transition-all flex flex-col items-center justify-center gap-2 ${openGuideGroup === 'environment' ? 'bg-[#D8C9B0] text-[#141414]' : 'text-[#141414]/55 hover:bg-white hover:text-[#141414]'}`}
              aria-label="Environment tools guide"
            >
              <FileText className="w-4 h-4" />
              <span className="text-[8px] font-bold tracking-[0.18em] [writing-mode:vertical-rl] rotate-180">GUIDE</span>
            </button>
            <div className={`flex-1 rounded-[28px] border border-[#141414]/10 bg-white/88 p-2 shadow-xl backdrop-blur-md transition-all ${openGuideGroup === 'environment' || highlightedGuideGroup === 'environment' ? 'ring-1 ring-[#D8C9B0] shadow-[0_12px_30px_rgba(140,115,85,0.18)]' : ''}`}>
              <div className="space-y-1">
                <button 
                  onClick={() => {
                    setCalibrationMode('reference');
                    setReferenceCalibrationStart(null);
                    setReferenceCalibrationSegment(null);
                    setCalibrationWallIndex(null);
                    setIsCalibrating(true);
                    activateTool('draw');
                  }}
                  className={`w-full min-h-[44px] px-3 py-2 rounded-2xl text-[9px] font-bold shadow-sm transition-all flex items-center justify-center gap-2 ${
                    workflowStep === 'scale' && hasBackground && !isScaleCalibrated
                      ? 'bg-emerald-500 text-white hover:bg-emerald-600' 
                      : 'bg-white border border-[#141414]/10 text-[#141414] hover:bg-[#141414]/5'
                  }`}
                >
                  <Box className="w-3 h-3" />
                  {workflowStep === 'scale' && hasBackground && !isScaleCalibrated ? 'SET SCALE' : 'RECAL'}
                </button>

                {hasBackground && (
                  <>
                    <button
                      onClick={() => {
                        setShowBackground((prev) => {
                          const next = !prev;
                          if (!next) setIsAdjustingBackground(false);
                          return next;
                        });
                      }}
                      className={`w-full min-h-[44px] px-3 py-2 rounded-2xl text-[9px] font-bold shadow-sm transition-all ${
                        showBackground
                          ? 'bg-[#141414] text-white'
                          : 'bg-white border border-[#141414]/10 text-[#141414] hover:bg-[#141414]/5'
                      }`}
                    >
                      {showBackground ? 'REF ON' : 'REF OFF'}
                    </button>

                    <button
                      onClick={() => {
                        setShowBackground(true);
                        setIsAdjustingBackground((prev) => !prev);
                        activateTool('select');
                      }}
                      className={`w-full min-h-[44px] px-3 py-2 rounded-2xl text-[9px] font-bold shadow-sm transition-all flex items-center justify-center gap-2 ${
                        isAdjustingBackground
                          ? 'bg-[#141414] text-white'
                          : 'bg-white border border-[#141414]/10 text-[#141414] hover:bg-[#141414]/5'
                      }`}
                    >
                      <Crosshair className="w-3 h-3" />
                      {isAdjustingBackground ? 'REF MOVE' : 'REF ADJ'}
                    </button>

                    <div className="grid grid-cols-3 gap-1">
                      <button
                        onClick={() => rotateBackground(BACKGROUND_ROTATION_STEP)}
                        className="h-10 rounded-2xl bg-white border border-[#141414]/10 text-[#141414] hover:bg-[#141414]/5 flex items-center justify-center"
                        title="Rotate left"
                      >
                        <RotateCcw className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => resetBackgroundTransform()}
                        className="h-10 rounded-2xl bg-white border border-[#141414]/10 text-[8px] font-bold tracking-[0.14em] text-[#141414] hover:bg-[#141414]/5"
                        title="Reset reference rotation"
                      >
                        RESET
                      </button>
                      <button
                        onClick={() => rotateBackground(-BACKGROUND_ROTATION_STEP)}
                        className="h-10 rounded-2xl bg-white border border-[#141414]/10 text-[#141414] hover:bg-[#141414]/5 flex items-center justify-center"
                        title="Rotate right"
                      >
                        <RotateCw className="w-3 h-3" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
            <AnimatePresence>
              {openGuideGroup === 'environment' && (
                <motion.div
                  key="environment-guide"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="fixed z-40 w-72 overflow-y-auto rounded-[28px] border border-[#141414]/10 bg-white/96 p-5 shadow-2xl backdrop-blur-md"
                  style={getGuidePanelStyle('environment')}
                  onMouseDown={stopUiMouseDown}
                  onPointerDown={stopUiPointerDown}
                  onWheel={stopUiWheel}
                >
                  <div className="space-y-4 pb-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#141414]/45">{currentGuideContent.environment.title}</h3>
                      <button onClick={() => setOpenGuideGroup(null)} className="rounded-lg p-1 text-[#141414]/35 hover:bg-[#141414]/5 hover:text-[#141414]">
                        <Plus className="w-4 h-4 rotate-45" />
                      </button>
                    </div>
                    <div className="space-y-3 text-[11px] leading-relaxed text-[#141414]/72">
                      {currentGuideContent.environment.sections.map((section) => (
                        <div key={section.label} className="space-y-1">
                          <p className="font-bold uppercase tracking-[0.14em] text-[#141414]/72">{section.label}</p>
                          {section.description.map((line) => (
                            <p key={line}>{line}</p>
                          ))}
                        </div>
                      ))}
                    </div>
                    {currentGuideContent.environment.tip && <GuideTip>{currentGuideContent.environment.tip}</GuideTip>}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="absolute bottom-[4.5rem] left-3 right-3 z-30 hidden gap-3 overflow-x-auto pb-1 [&>*]:w-[148px] [&>*]:shrink-0 md:bottom-auto md:left-auto md:right-6 md:top-6 md:block md:w-[120px] md:space-y-3 md:overflow-visible md:pb-0 md:[&>*]:w-full" onMouseDown={stopUiMouseDown} onPointerDown={stopUiPointerDown}>
          <button 
            onClick={handleFinish}
            disabled={walls.length === 0 || workflowStep !== 'trace' || !isScaleCalibrated}
            className="w-full rounded-[24px] bg-emerald-500 text-white px-4 py-3 text-[9px] font-bold shadow-xl backdrop-blur-md hover:scale-[1.02] hover:bg-emerald-600 transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:hover:scale-100"
          >
            <Check className="w-3 h-3" />
            GENERATE 3D
          </button>

          <div className={`rounded-[28px] border border-[#141414]/10 p-2 shadow-xl backdrop-blur-md transition-all ${isPrintPanelOpen || isPrintModeActive ? 'bg-[#F1ECE3]/95 ring-1 ring-[#CBBBA0]' : 'bg-white/88'}`}>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setIsPrintPanelOpen((current) => !current)}
                className={`w-full rounded-2xl px-3 py-3 text-[9px] font-bold tracking-[0.16em] transition-all flex items-center justify-center gap-2 ${
                  isPrintModeActive ? 'bg-[#CBBBA0] text-[#141414]' : 'bg-[#141414]/5 text-[#141414] hover:bg-white'
                }`}
              >
                <Printer className="w-3 h-3" />
                EXPORT A4 PDF
              </button>

              {(isPrintPanelOpen || isPrintModeActive) && (
                <div className="space-y-2 rounded-2xl bg-white/72 p-2">
                  <div className="space-y-1">
                    <span className="block text-center text-[8px] font-bold uppercase tracking-[0.14em] text-[#141414]/45">
                      Scale
                    </span>
                    <div className="grid grid-cols-3 gap-1">
                      {[50, 100, 200].map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setPrintScale(option as PrintScaleOption)}
                          className={`h-9 rounded-xl text-[8px] font-bold transition-all ${
                            printScale === option ? 'bg-[#141414] text-white' : 'bg-[#141414]/5 text-[#141414] hover:bg-white'
                          }`}
                        >
                          1:{option}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="block text-center text-[8px] font-bold uppercase tracking-[0.14em] text-[#141414]/45">
                      Orientation
                    </span>
                    <div className="grid grid-cols-2 gap-1">
                      {(['portrait', 'landscape'] as PrintOrientation[]).map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setPrintOrientation(option)}
                          className={`h-9 rounded-xl px-2 text-[8px] font-bold uppercase transition-all ${
                            printOrientation === option ? 'bg-[#141414] text-white' : 'bg-[#141414]/5 text-[#141414] hover:bg-white'
                          }`}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <button
                      type="button"
                      onClick={() => startPrintMode(printScale, printOrientation)}
                      className="w-full rounded-2xl bg-[#141414] px-3 py-3 text-[8px] font-bold uppercase tracking-[0.16em] text-white transition-all hover:opacity-90"
                    >
                      {isPrintModeActive ? 'Update Frame' : 'Start Print Mode'}
                    </button>
                    <button
                      type="button"
                      onClick={handleExportA4Pdf}
                      disabled={!isPrintModeActive}
                      className="w-full rounded-2xl bg-[#141414]/5 px-3 py-3 text-[8px] font-bold uppercase tracking-[0.16em] text-[#141414] transition-all hover:bg-white disabled:opacity-40"
                    >
                      Export PDF
                    </button>
                    <button
                      type="button"
                      onClick={cancelPrintMode}
                      disabled={!isPrintModeActive && !isPrintPanelOpen}
                      className="w-full rounded-2xl bg-transparent px-3 py-2 text-[8px] font-bold uppercase tracking-[0.16em] text-[#141414]/55 transition-all hover:bg-white/70 hover:text-[#141414] disabled:opacity-30"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className={`rounded-[28px] border border-[#141414]/10 bg-white/88 p-2 shadow-xl backdrop-blur-md transition-all ${(selectedWallIndex !== null || selectedOpeningIndex !== null || selectedWallIndices.length > 0) ? 'ring-1 ring-emerald-200' : ''}`}>
            <div className="space-y-2">
              <div className="flex items-center justify-center bg-white/70 rounded-xl p-0.5">
                <button
                  onClick={() => setDisplayUnit('cm')}
                  className={`flex-1 px-2 py-1 rounded-lg text-[8px] font-bold uppercase transition-all ${displayUnit === 'cm' ? 'bg-[#141414] text-white' : 'text-[#141414]/50 hover:text-[#141414]'}`}
                >
                  cm
                </button>
                <button
                  onClick={() => setDisplayUnit('m')}
                  className={`flex-1 px-2 py-1 rounded-lg text-[8px] font-bold uppercase transition-all ${displayUnit === 'm' ? 'bg-[#141414] text-white' : 'text-[#141414]/50 hover:text-[#141414]'}`}
                >
                  m
                </button>
              </div>

              <button
                onClick={() => {
                  const controlContext = getControlContext();
                  const step = getUnitStep(controlContext, 'increase');
                  if (controlContext === 'opening') updateOpeningWidth(Math.min(currentOpeningWidth + fromDisplayUnits(step), 500));
                  else updateThickness(Math.min(getControlValue() + fromDisplayUnits(step), 100));
                }}
                className="w-full h-10 rounded-2xl bg-[#141414]/5 hover:bg-white transition-colors flex items-center justify-center"
              >
                <Plus className="w-4 h-4" />
              </button>

              <div className="relative h-[76px] rounded-2xl bg-[#141414]/5 px-3 py-3 text-center flex flex-col justify-center">
                <span className="block text-[8px] uppercase opacity-40 font-bold tracking-tighter">
                  {getControlLabel()} ({displayUnit})
                </span>
                {getSelectionCountLabel() && (
                  <span className="absolute right-3 top-2 rounded-full bg-[#F1ECE3] px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.12em] text-[#6C5A46]">
                    {getSelectionCountLabel()}
                  </span>
                )}
                  <input 
                    type="text"
                    inputMode="decimal"
                    value={sizeInputValue}
                    placeholder={activeTool === 'multi-wall' && selectedWallIndices.length > 0 && getMultiWallThicknessValue() === null ? 'mixed' : undefined}
                    onFocus={() => setIsEditingSizeInput(true)}
                    onChange={(e) => handleSizeInputChange(e.target.value)}
                    onBlur={commitSizeInput}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      commitSizeInput();
                      e.currentTarget.blur();
                    }
                    if (e.key === 'Escape') {
                      setIsEditingSizeInput(false);
                      setSizeInputValue(
                        activeTool === 'multi-wall' && selectedWallIndices.length > 0 && getMultiWallThicknessValue() === null
                          ? ''
                          : formatDisplayValue(getControlValue())
                      );
                      e.currentTarget.blur();
                    }
                  }}
                  className="mt-1 text-[12px] font-mono font-bold bg-transparent w-full text-center focus:outline-none"
                />
              </div>

              <button
                onClick={() => {
                  const controlContext = getControlContext();
                  const step = getUnitStep(controlContext, 'decrease');
                  if (controlContext === 'opening') updateOpeningWidth(Math.max(currentOpeningWidth + fromDisplayUnits(step), 20));
                  else updateThickness(Math.max(getControlValue() + fromDisplayUnits(step), 5));
                }}
                className="w-full h-10 rounded-2xl bg-[#141414]/5 hover:bg-white transition-colors flex items-center justify-center"
              >
                <div className="w-4 h-0.5 bg-[#141414]" />
              </button>
            </div>
          </div>

          <div className={`rounded-[28px] border border-[#141414]/10 p-3 shadow-xl backdrop-blur-md transition-colors ${isWallLengthInputActive ? 'bg-[#CBBBA0]' : 'bg-white/88'}`}>
            <div className="text-center">
              <span className="block text-[8px] uppercase opacity-40 font-bold tracking-tighter">
                LENGTH (M)
              </span>
              <input
                type="text"
                inputMode="decimal"
                readOnly={!isWallLengthInputActive}
                value={getDisplayedWallLength()}
                onChange={(e) => {
                  if (!isWallLengthInputActive) return;
                  setWallLengthInputValue(sanitizeWallLengthInput(e.target.value));
                }}
                className={`mt-1 w-full bg-transparent text-center text-[12px] font-mono font-bold focus:outline-none ${
                  isWallLengthInputActive ? 'text-[#141414] ring-1 ring-emerald-200 rounded-lg' : ''
                }`}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={toggleRoomMeasureMode}
            className={`w-full rounded-[28px] border border-[#141414]/10 p-3 shadow-xl backdrop-blur-md transition-colors ${
              isRoomMeasureMode ? 'bg-[#CBBBA0]' : 'bg-white/88 hover:bg-white'
            }`}
          >
            <div className="overflow-hidden rounded-2xl bg-[#141414]/5">
              <div className="px-3 py-3 text-center">
                <span className="block text-[8px] font-bold uppercase tracking-tighter opacity-40">
                  PERIMETER (M)
                </span>
                <span className="mt-1 block text-[12px] font-mono font-bold text-[#141414]">
                  {roomMeasurement ? formatMetersValue(roomMeasurement.perimeterCm) : '--'}
                </span>
              </div>
              <div className="border-t border-[#141414]/10 px-3 py-3 text-center">
                <span className="block text-[8px] font-bold uppercase tracking-tighter opacity-40">
                  AREA (M²)
                </span>
                <span className="mt-1 block text-[12px] font-mono font-bold text-[#141414]">
                  {roomMeasurement ? formatSquareMetersValue(roomMeasurement.areaCm2) : '--'}
                </span>
              </div>
            </div>
          </button>

          <div className="rounded-[28px] border border-[#141414]/10 bg-white/88 p-2 shadow-xl backdrop-blur-md">
            <div className="space-y-2">
              <button 
                onClick={() => {
                  if (!containerRef.current) return;
                  const rect = containerRef.current.getBoundingClientRect();
                  zoomAtPoint(zoomRef.current * ZOOM_BUTTON_FACTOR, rect.left + rect.width / 2, rect.top + rect.height / 2);
                }}
                className="w-full h-10 rounded-2xl bg-[#141414]/5 hover:bg-white transition-colors flex items-center justify-center"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <div className="rounded-2xl bg-[#141414]/5 px-3 py-3 text-center">
                <span className="block text-[8px] uppercase opacity-40 font-bold tracking-tighter">
                  ZOOM
                </span>
                <span className="block mt-1 text-[12px] font-mono font-bold">{Math.round(zoom * 100)}%</span>
              </div>
              <button 
                onClick={() => {
                  if (!containerRef.current) return;
                  const rect = containerRef.current.getBoundingClientRect();
                  zoomAtPoint(zoomRef.current / ZOOM_BUTTON_FACTOR, rect.left + rect.width / 2, rect.top + rect.height / 2);
                }}
                className="w-full h-10 rounded-2xl bg-[#141414]/5 hover:bg-white transition-colors flex items-center justify-center"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
            </div>
          </div>

        </div>
        {activeTool === 'multi-wall' && selectedWallIndices.length > 1 && (
          <div
            data-ui-overlay="true"
            className="absolute bottom-16 left-3 right-3 z-30 flex items-center justify-center md:hidden"
            onMouseDown={stopUiMouseDown}
            onMouseUp={stopUiMouseUp}
            onClick={stopUiClick}
            onPointerDown={stopUiPointerDown}
            onPointerUp={stopUiPointerUp}
            onTouchStart={stopUiTouchStart}
            onTouchEnd={stopUiTouchEnd}
          >
            <div className="flex w-full max-w-[18rem] items-center gap-2 rounded-[24px] border border-[#141414]/10 bg-white/92 p-2 shadow-xl backdrop-blur-md">
              <button
                type="button"
                onClick={() => rotateSelectedWalls('cw')}
                className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-[#141414]/5 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.16em] text-[#141414]"
                aria-label="Rotate selection left"
              >
                <RotateCcw className="h-4 w-4" />
                Left
              </button>
              <button
                type="button"
                onClick={() => rotateSelectedWalls('ccw')}
                className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-[#141414]/5 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.16em] text-[#141414]"
                aria-label="Rotate selection right"
              >
                Right
                <RotateCw className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
        {/* Status Bar */}
        <div className="absolute bottom-3 left-3 right-3 z-20 flex items-center justify-center gap-3 rounded-full border border-white/10 bg-[#141414]/80 px-3 py-1.5 text-white shadow-xl backdrop-blur-md md:bottom-6 md:left-1/2 md:right-auto md:-translate-x-1/2 md:px-6 md:py-2">
          <p className="max-w-full truncate text-[9px] font-mono uppercase tracking-[0.16em] opacity-80 md:text-[10px] md:tracking-[0.2em]">
            {getToolInstruction()}
          </p>
          <div className="hidden h-3 w-px bg-white/20 sm:block" />
          <p className="hidden text-[9px] font-mono opacity-40 sm:block">
            {Math.round(mousePos.x)}, {Math.round(mousePos.y)}
          </p>
        </div>

        <div 
          className="absolute origin-top-left"
          style={{ 
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
          }}
        >
          <div 
            className="relative shadow-2xl transition-all duration-500"
            style={{ 
              width: mode === 'trace' ? `${TRACE_CANVAS_WIDTH}px` : `${SCALE_CANVAS_WIDTH}px`,
              height: mode === 'trace' ? `${TRACE_CANVAS_HEIGHT}px` : `${SCALE_CANVAS_HEIGHT}px`,
              backgroundColor: 'white'
            }}
          >
            {imageUrl && (
              <img 
                ref={imgRef}
                src={imageUrl} 
                alt="Planimetria" 
                className="hidden"
              />
            )}
            
            <svg 
              className="absolute inset-0 w-full h-full pointer-events-none"
              viewBox={`0 0 ${mode === 'trace' ? TRACE_CANVAS_WIDTH : SCALE_CANVAS_WIDTH} ${mode === 'trace' ? TRACE_CANVAS_HEIGHT : SCALE_CANVAS_HEIGHT}`}
            >
              <g transform={`translate(0, ${mode === 'trace' ? TRACE_CANVAS_HEIGHT : SCALE_CANVAS_HEIGHT}) scale(1, -1)`}>
                {showBackground && imageUrl && getTraceImageBounds() && (
                  <g
                    transform={`translate(${backgroundTransform.x + getTraceImageBounds()!.width / 2}, ${backgroundTransform.y + getTraceImageBounds()!.height / 2}) rotate(${backgroundTransform.rotation}) translate(${-getTraceImageBounds()!.width / 2}, ${-getTraceImageBounds()!.height / 2})`}
                  >
                    <g transform={`translate(${getTraceImageBounds()!.x}, ${getTraceImageBounds()!.y + getTraceImageBounds()!.height}) scale(1, -1)`}>
                      <image
                        href={imageUrl}
                        x={0}
                        y={0}
                        width={getTraceImageBounds()!.width}
                        height={getTraceImageBounds()!.height}
                        preserveAspectRatio="none"
                        className="pointer-events-none"
                        opacity={0.92}
                      />
                    </g>
                  </g>
                )}

                {alignmentGuides.map((guide) => (
                  guide.axis === 'x' ? (
                    <line
                      key={`guide-x-${guide.value}`}
                      x1={guide.value}
                      y1={0}
                      x2={guide.value}
                      y2={mode === 'trace' ? TRACE_CANVAS_HEIGHT : SCALE_CANVAS_HEIGHT}
                      stroke="#8C7B67"
                      strokeWidth="1"
                      strokeDasharray="4,8"
                      className="opacity-35"
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : (
                    <line
                      key={`guide-y-${guide.value}`}
                      x1={0}
                      y1={guide.value}
                      x2={mode === 'trace' ? TRACE_CANVAS_WIDTH : SCALE_CANVAS_WIDTH}
                      y2={guide.value}
                      stroke="#8C7B67"
                      strokeWidth="1"
                      strokeDasharray="4,8"
                      className="opacity-35"
                      vectorEffect="non-scaling-stroke"
                    />
                  )
                ))}

                {activeSnapNode && (
                  <circle
                    cx={activeSnapNode.point.x}
                    cy={activeSnapNode.point.y}
                    r={activeSnapNode.kind === 'endpoint' ? 5 : 4}
                    fill="#D8C9B0"
                    stroke="#8C7355"
                    strokeWidth="1"
                    className="opacity-90"
                    vectorEffect="non-scaling-stroke"
                  />
                )}

                {printFrame && (
                  <g pointerEvents="none">
                    <rect
                      x={printFrame.x}
                      y={printFrame.y}
                      width={printFrame.width}
                      height={printFrame.height}
                      fill="rgba(203, 187, 160, 0.08)"
                      stroke="#8C7355"
                      strokeWidth="2"
                      strokeDasharray="10,8"
                      vectorEffect="non-scaling-stroke"
                    />
                    <g transform={`translate(${printFrame.x + 12}, ${printFrame.y + printFrame.height - 12}) scale(1, -1)`}>
                      <rect
                        x={0}
                        y={0}
                        width={112}
                        height={24}
                        rx={12}
                        fill="rgba(255,255,255,0.9)"
                        stroke="rgba(20,20,20,0.08)"
                        strokeWidth="1"
                        vectorEffect="non-scaling-stroke"
                      />
                      <text
                        x={56}
                        y={15}
                        textAnchor="middle"
                        fontSize="8"
                        fontWeight="700"
                        letterSpacing="0.14em"
                        fill="#6C5A46"
                      >
                        {`A4 · 1:${printFrame.scale} · ${printFrame.orientation === 'portrait' ? 'Portrait' : 'Landscape'}`}
                      </text>
                    </g>
                  </g>
                )}

                {marqueeSelection && (() => {
                  const bounds = getMarqueeBounds(marqueeSelection);
                  return (
                    <rect
                      x={bounds.minX}
                      y={bounds.minY}
                      width={Math.max(bounds.maxX - bounds.minX, 1)}
                      height={Math.max(bounds.maxY - bounds.minY, 1)}
                      fill="rgba(203, 187, 160, 0.16)"
                      stroke="#8C7355"
                      strokeWidth="1"
                      strokeDasharray="6,6"
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                })()}
                {roomMeasurement?.polygon && (
                  <polygon
                    points={roomMeasurement.polygon.map((point) => `${point.x},${point.y}`).join(' ')}
                    fill="#CBBBA0"
                    fillOpacity={0.22}
                    stroke="#8C7355"
                    strokeOpacity={0.35}
                    strokeWidth={8}
                    pointerEvents="none"
                  />
                )}

                {activeTool === 'multi-wall' && selectedWallIndices.length > 1 && selectedWallsRotationPivot && (
                  <g pointerEvents="none">
                    <circle
                      cx={selectedWallsRotationPivot.x}
                      cy={selectedWallsRotationPivot.y}
                      r={MULTI_SELECTION_CENTROID_VISUAL_RADIUS_PX}
                      fill="#CBBBA0"
                      fillOpacity={0.18}
                    />
                    <circle
                      cx={selectedWallsRotationPivot.x}
                      cy={selectedWallsRotationPivot.y}
                      r={MULTI_SELECTION_CENTROID_INNER_VISUAL_RADIUS_PX}
                      fill="#8C7355"
                      fillOpacity={0.7}
                    />
                  </g>
                )}

                {/* Existing Walls */}
              {walls.map((wall, i) => {
                if (isNaN(wall.start.x) || isNaN(wall.start.y) || isNaN(wall.end.x) || isNaN(wall.end.y)) return null;
                const isSingleSelected = selectedWallIndex === i;
                const isMultiSelected = selectedWallIndices.includes(i);
                return (
                  <g key={`wall-${i}`} className="pointer-events-auto">
                    {/* Selection Hit Area (Invisible but wider) - Only active in select tool */}
                    <line
                      x1={wall.start.x}
                      y1={wall.start.y}
                      x2={wall.end.x}
                      y2={wall.end.y}
                      stroke="transparent"
                      strokeWidth={Math.max(wall.thickness, 30)}
                      className={activeTool === 'select' || activeTool === 'multi-wall' ? 'cursor-pointer' : ''}
                    />
                    {/* Main wall body */}
                    <line
                      x1={wall.start.x}
                      y1={wall.start.y}
                      x2={wall.end.x}
                      y2={wall.end.y}
                      stroke={isSingleSelected ? "#10b981" : isMultiSelected ? "#8C7355" : "#141414"}
                      strokeWidth={wall.thickness}
                      strokeLinecap="butt"
                      className={`transition-colors duration-200 ${isSingleSelected ? 'opacity-90' : isMultiSelected ? 'opacity-88' : 'opacity-80'}`}
                    />
                  </g>
                );
              })}

              {/* Corner Fills (Visual only) */}
              {(() => {
                const pointsMap = new Map<string, { point: Point, wallIndices: number[] }>();
                walls.forEach((w, i) => {
                  const sKey = `${Math.round(w.start.x * 10) / 10},${Math.round(w.start.y * 10) / 10}`;
                  const eKey = `${Math.round(w.end.x * 10) / 10},${Math.round(w.end.y * 10) / 10}`;
                  if (!pointsMap.has(sKey)) pointsMap.set(sKey, { point: w.start, wallIndices: [] });
                  pointsMap.get(sKey)!.wallIndices.push(i);
                  if (!pointsMap.has(eKey)) pointsMap.set(eKey, { point: w.end, wallIndices: [] });
                  pointsMap.get(eKey)!.wallIndices.push(i);
                });

                return Array.from(pointsMap.entries()).map(([key, data]) => {
                  if (data.wallIndices.length < 2) return null;
                  const maxThickness = Math.max(...data.wallIndices.map(idx => walls[idx].thickness));
                  const isSelected = data.wallIndices.some(idx => idx === selectedWallIndex);
                  const isMultiSelected = data.wallIndices.some(idx => selectedWallIndices.includes(idx));
                  return (
                    <circle
                      key={`corner-${key}`}
                      cx={data.point.x}
                      cy={data.point.y}
                      r={maxThickness / 2}
                      fill={isSelected ? "#10b981" : isMultiSelected ? "#8C7355" : "#141414"}
                      className="opacity-80"
                    />
                  );
                });
              })()}

              {/* Openings */}
              {openings.map((op, i) => {
                const resolvedOpening = resolveOpening(op, walls);
                const openingMetrics = getOpeningRenderMetrics(resolvedOpening);
                const isSelected = selectedOpeningIndex === i;
                if (isNaN(resolvedOpening.position.x) || isNaN(resolvedOpening.position.y) || isNaN(resolvedOpening.rotation) || isNaN(resolvedOpening.width)) return null;
                return (
                  <g 
                    key={`opening-${i}`} 
                    className="pointer-events-auto"
                    transform={`translate(${resolvedOpening.position.x}, ${resolvedOpening.position.y}) rotate(${resolvedOpening.rotation})`}
                  >
                    {/* Hit area */}
                    <rect
                      x={-openingMetrics.hitWidth / 2}
                      y={-openingMetrics.hitHeight / 2}
                      width={openingMetrics.hitWidth}
                      height={openingMetrics.hitHeight}
                      fill="transparent"
                      className={activeTool === 'select' ? 'cursor-grab active:cursor-grabbing' : ''}
                    />
                    {/* Visual */}
                    <rect
                      x={-resolvedOpening.width / 2}
                      y={-openingMetrics.bodyHeight / 2}
                      width={resolvedOpening.width}
                      height={openingMetrics.bodyHeight}
                      fill="white"
                      className={`transition-all duration-200 ${isSelected ? 'opacity-100' : 'opacity-92'}`}
                    />
                    {/* Type indicator */}
                    {resolvedOpening.type === 'window' || resolvedOpening.type === 'window-floor' ? (
                      <g>
                        <line
                          x1={-resolvedOpening.width / 2 + openingMetrics.lineInset}
                          y1={-openingMetrics.windowLineOffset}
                          x2={resolvedOpening.width / 2 - openingMetrics.lineInset}
                          y2={-openingMetrics.windowLineOffset}
                          stroke={isSelected ? OPENING_SELECTION_COLOR : "#141414"}
                          strokeWidth="1.5"
                          vectorEffect="non-scaling-stroke"
                        />
                        {resolvedOpening.type === 'window' && (
                          <line
                            x1={-resolvedOpening.width / 2 + openingMetrics.lineInset}
                            y1={openingMetrics.windowLineOffset}
                            x2={resolvedOpening.width / 2 - openingMetrics.lineInset}
                            y2={openingMetrics.windowLineOffset}
                            stroke={isSelected ? OPENING_SELECTION_COLOR : "#141414"}
                            strokeWidth="1.5"
                            vectorEffect="non-scaling-stroke"
                          />
                        )}
                      </g>
                    ) : null}

                    {isSelected && (
                      <rect
                        x={-resolvedOpening.width / 2 - 4}
                        y={-openingMetrics.bodyHeight / 2 - 4}
                        width={resolvedOpening.width + 8}
                        height={openingMetrics.bodyHeight + 8}
                        fill="none"
                        stroke={OPENING_SELECTION_COLOR}
                        strokeWidth="1.5"
                        rx="6"
                        vectorEffect="non-scaling-stroke"
                        className="opacity-90"
                      />
                    )}
                    
                  </g>
                );
              })}

              {/* Current Wall Preview */}
              {currentStart && activeTool === 'draw' && getCurrentWallPreviewPoint() && !isNaN(currentStart.x) && !isNaN(currentStart.y) && !isNaN(getCurrentWallPreviewPoint()!.x) && !isNaN(getCurrentWallPreviewPoint()!.y) && (
                <g>
                  <line
                    x1={currentStart.x}
                    y1={currentStart.y}
                    x2={getCurrentWallPreviewPoint()!.x}
                    y2={getCurrentWallPreviewPoint()!.y}
                    stroke="#141414"
                    strokeWidth={currentThickness}
                    strokeLinecap="butt"
                    className="opacity-30"
                  />
                  <line
                    x1={currentStart.x}
                    y1={currentStart.y}
                    x2={getCurrentWallPreviewPoint()!.x}
                    y2={getCurrentWallPreviewPoint()!.y}
                    stroke="#141414"
                    strokeWidth="1"
                    strokeDasharray="4,4"
                    className="opacity-60"
                  />
                </g>
              )}

              {isReferenceCalibration && (referenceCalibrationSegment || (referenceCalibrationStart && getReferenceCalibrationPreviewPoint())) && (
                <g>
                  <line
                    x1={(referenceCalibrationSegment?.start ?? referenceCalibrationStart)!.x}
                    y1={(referenceCalibrationSegment?.start ?? referenceCalibrationStart)!.y}
                    x2={(referenceCalibrationSegment?.end ?? getReferenceCalibrationPreviewPoint()!)!.x}
                    y2={(referenceCalibrationSegment?.end ?? getReferenceCalibrationPreviewPoint()!)!.y}
                    stroke="#22C55E"
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                    className="opacity-92"
                  />
                </g>
              )}

              {!isReferenceCalibration && isCalibrating && calibrationMode === 'wall' && calibrationWallIndex !== null && walls[calibrationWallIndex] && (
                <g>
                  <line
                    x1={walls[calibrationWallIndex].start.x}
                    y1={walls[calibrationWallIndex].start.y}
                    x2={walls[calibrationWallIndex].end.x}
                    y2={walls[calibrationWallIndex].end.y}
                    stroke="#22C55E"
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                    className="opacity-92"
                  />
                </g>
              )}

              {/* Current Opening Preview */}
              {(activeTool === 'door' || activeTool === 'window' || activeTool === 'window-floor') && (
                <g transform={previewOpening 
                  ? `translate(${previewOpening.position.x}, ${previewOpening.position.y}) rotate(${previewOpening.rotation})` 
                  : `translate(${mousePos.x}, ${mousePos.y})`
                }>
                  {(() => {
                    const previewResolvedOpening: ResolvedOpening = {
                      position: previewOpening?.position || mousePos,
                      width: currentOpeningWidth,
                      type: activeTool,
                      rotation: previewOpening?.rotation || 0,
                      thickness: previewOpening?.thickness || 20,
                    };
                    const previewMetrics = getOpeningRenderMetrics(previewResolvedOpening);

                    return (
                      <>
                        <rect
                          x={-currentOpeningWidth / 2}
                          y={-previewMetrics.bodyHeight / 2}
                          width={currentOpeningWidth}
                          height={previewMetrics.bodyHeight}
                          fill={previewOpening ? "white" : "rgba(255,255,255,0.5)"}
                          stroke={previewOpening ? "#10b981" : "#ef4444"}
                          strokeWidth="2"
                          strokeDasharray="4,4"
                          vectorEffect="non-scaling-stroke"
                          className="opacity-70"
                        />
                        {(activeTool === 'window' || activeTool === 'window-floor') && (
                          <>
                            <line
                              x1={-currentOpeningWidth / 2 + previewMetrics.lineInset}
                              y1={-previewMetrics.windowLineOffset}
                              x2={currentOpeningWidth / 2 - previewMetrics.lineInset}
                              y2={-previewMetrics.windowLineOffset}
                              stroke={previewOpening ? "#10b981" : "#ef4444"}
                              strokeWidth="1.5"
                              strokeDasharray="4,4"
                              vectorEffect="non-scaling-stroke"
                            />
                            {activeTool === 'window' && (
                              <line
                                x1={-currentOpeningWidth / 2 + previewMetrics.lineInset}
                                y1={previewMetrics.windowLineOffset}
                                x2={currentOpeningWidth / 2 - previewMetrics.lineInset}
                                y2={previewMetrics.windowLineOffset}
                                stroke={previewOpening ? "#10b981" : "#ef4444"}
                                strokeWidth="1.5"
                                strokeDasharray="4,4"
                                vectorEffect="non-scaling-stroke"
                              />
                            )}
                          </>
                        )}
                      </>
                    );
                  })()}
                </g>
              )}

              {/* Points / Anchors */}
              {walls.map((wall, i) => {
                if (isNaN(wall.start.x) || isNaN(wall.start.y) || isNaN(wall.end.x) || isNaN(wall.end.y)) return null;
                return (
                  <React.Fragment key={`anchors-${i}`}>
                    <circle 
                      cx={wall.start.x} 
                      cy={wall.start.y} 
                      r={selectedWallIndex === i ? ENDPOINT_SELECTED_VISUAL_RADIUS_PX : ENDPOINT_VISUAL_RADIUS_PX} 
                      fill={selectedWallIndex === i ? "#10b981" : "#141414"} 
                      className={activeTool === 'select' ? "cursor-grab active:cursor-grabbing pointer-events-auto" : "pointer-events-none"}
                    />
                    <circle 
                      cx={wall.end.x} 
                      cy={wall.end.y} 
                      r={selectedWallIndex === i ? ENDPOINT_SELECTED_VISUAL_RADIUS_PX : ENDPOINT_VISUAL_RADIUS_PX} 
                      fill={selectedWallIndex === i ? "#10b981" : "#141414"} 
                      className={activeTool === 'select' ? "cursor-grab active:cursor-grabbing pointer-events-auto" : "pointer-events-none"}
                    />
                  </React.Fragment>
                );
              })}
              
              {currentStart && !isReferenceCalibration && !isNaN(currentStart.x) && !isNaN(currentStart.y) && (
                <circle cx={currentStart.x} cy={currentStart.y} r={ENDPOINT_VISUAL_RADIUS_PX} fill="#141414" />
              )}
            </g>
          </svg>
          </div>
        </div>
      </div>
    </div>
  );
};
