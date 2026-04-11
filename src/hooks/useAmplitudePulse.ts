import { useEffect, type RefObject } from 'react';

export function useAmplitudePulse(
  analyser: AnalyserNode | null,
  targetRef: RefObject<HTMLElement | null>,
  factor = 0.08,
) {
  useEffect(() => {
    const target = targetRef.current;
    if (!analyser || !target) return;

    const buffer = new Uint8Array(analyser.fftSize);
    let raf = 0;
    let smoothed = 0;

    const tick = () => {
      analyser.getByteTimeDomainData(buffer);
      let sumSq = 0;
      for (let i = 0; i < buffer.length; i++) {
        const v = (buffer[i] - 128) / 128;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / buffer.length);
      smoothed = smoothed * 0.7 + rms * 0.3;
      const scale = 1 + smoothed * factor * 10;
      target.style.transform = `scale(${scale.toFixed(3)})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      target.style.transform = '';
    };
  }, [analyser, targetRef, factor]);
}
