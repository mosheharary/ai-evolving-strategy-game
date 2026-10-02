/**
 * Bridge between the 3D scene and DOM labels: the scene writes screen positions into
 * registered elements every frame (style.transform only — no React re-renders).
 */
export const labelElements = new Map<string, HTMLElement>();
