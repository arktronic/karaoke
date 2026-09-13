// butterchurn and butterchurn-presets ship as plain JS with no official type definitions;
// these ambient shapes cover only the surface this runtime actually uses.
declare module 'butterchurn' {
  interface ButterchurnVisualizer {
    connectAudio(node: AudioNode): void;
    loadPreset(preset: unknown, blendSeconds: number): void;
    render(): void;
    setRendererSize(width: number, height: number): void;
  }

  interface ButterchurnStatic {
    createVisualizer(
      context: BaseAudioContext,
      canvas: HTMLCanvasElement | OffscreenCanvas,
      options: { width: number; height: number },
    ): ButterchurnVisualizer;
  }

  const butterchurn: ButterchurnStatic;
  export default butterchurn;
}

declare module 'butterchurn-presets' {
  // The underlying package's default export is the presets record itself (name -> preset), not a
  // `getPresets()` accessor; esbuild's CJS interop may additionally wrap it in another `.default`.
  const presets: Record<string, unknown> | { default: Record<string, unknown> };
  export default presets;
}
