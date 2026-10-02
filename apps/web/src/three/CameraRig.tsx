"use client";

import { CameraControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import CameraControlsImpl from "camera-controls";
import { useEffect, useRef } from "react";
import { Box3, Vector3 } from "three";
import { useGame } from "@/store/gameStore";

/**
 * Strategy camera: pan (drag / WASD / arrows), zoom (wheel / + -), rotate (right-drag / Q E),
 * smooth focus on units, settlements and events. Keyboard state is read in useFrame — no
 * React re-renders during camera motion.
 */
export function CameraRig({ center, bounds, focusPoint }: { center: Vector3; bounds: { w: number; h: number }; focusPoint: (tile: number) => Vector3 | null }) {
  const ref = useRef<CameraControls>(null);
  const keys = useRef(new Set<string>());
  const { gl } = useThree();
  const focus = useGame((s) => s.focus);
  const reducedMotion = useGame((s) => s.settings.reducedMotion);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.mouseButtons.left = CameraControlsImpl.ACTION.TRUCK;
    c.mouseButtons.right = CameraControlsImpl.ACTION.ROTATE;
    c.mouseButtons.middle = CameraControlsImpl.ACTION.DOLLY;
    c.mouseButtons.wheel = CameraControlsImpl.ACTION.DOLLY;
    c.touches.one = CameraControlsImpl.ACTION.TOUCH_TRUCK;
    c.touches.two = CameraControlsImpl.ACTION.TOUCH_DOLLY_ROTATE;
    c.minDistance = 8;
    c.maxDistance = 95;
    c.minPolarAngle = 0.35;
    c.maxPolarAngle = 1.12;
    c.dollyToCursor = true;
    c.smoothTime = 0.18;
    c.draggingSmoothTime = 0.08;
    c.setBoundary(new Box3(new Vector3(-6, -5, -6), new Vector3(bounds.w + 6, 30, bounds.h + 6)));
    void c.setLookAt(center.x, 46, center.z + 40, center.x, 0, center.z, false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const isTyping = (e: KeyboardEvent): boolean => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    };
    const down = (e: KeyboardEvent): void => {
      if (isTyping(e)) return;
      keys.current.add(e.key.toLowerCase());
    };
    const up = (e: KeyboardEvent): void => {
      keys.current.delete(e.key.toLowerCase());
    };
    const blur = (): void => keys.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    const noMenu = (e: Event): void => e.preventDefault();
    gl.domElement.addEventListener("contextmenu", noMenu);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      gl.domElement.removeEventListener("contextmenu", noMenu);
    };
  }, [gl]);

  useEffect(() => {
    const c = ref.current;
    if (!c || !focus) return;
    const p = focusPoint(focus.tile);
    if (!p) return;
    const dist = focus.zoom ?? Math.max(16, Math.min(40, c.distance));
    void c.moveTo(p.x, p.y, p.z, !reducedMotion);
    void c.dollyTo(dist, !reducedMotion);
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, dt) => {
    const c = ref.current;
    if (!c) return;
    const k = keys.current;
    if (k.size === 0) return;
    const speed = Math.max(8, c.distance * 0.9) * dt;
    let x = 0;
    let z = 0;
    if (k.has("w") || k.has("arrowup")) z += speed;
    if (k.has("s") || k.has("arrowdown")) z -= speed;
    if (k.has("a") || k.has("arrowleft")) x -= speed;
    if (k.has("d") || k.has("arrowright")) x += speed;
    if (x || z) {
      void c.truck(x, 0, true);
      void c.forward(z, true);
    }
    if (k.has("q")) void c.rotate(-1.4 * dt, 0, true);
    if (k.has("e")) void c.rotate(1.4 * dt, 0, true);
    if (k.has("+") || k.has("=")) void c.dolly(speed * 1.5, true);
    if (k.has("-") || k.has("_")) void c.dolly(-speed * 1.5, true);
  });

  return <CameraControls ref={ref} makeDefault />;
}
