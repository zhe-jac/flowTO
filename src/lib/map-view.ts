/** Tilt (degrees) past which a gesture switches the map into 3D, and below which it returns to 2D. */
export const ENTER_3D_PITCH = 20;
export const EXIT_3D_PITCH = 8;

/** Whether the view should be 3D after a tilt gesture ends; the gap between thresholds stops flickering near one value. */
export function is3DPitch(pitch: number, current: boolean) {
  return current ? pitch >= EXIT_3D_PITCH : pitch >= ENTER_3D_PITCH;
}
