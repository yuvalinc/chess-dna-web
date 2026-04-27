/**
 * NumberTicker — animated count-up number display.
 * Each digit rolls up from below with staggered delay.
 * Pure CSS animation via Tailwind's ticker-roll keyframe.
 */
import { useEffect, useState } from 'react';

interface Props {
  value: number;
  className?: string;
  style?: React.CSSProperties;
  /** Delay before animation starts (ms) */
  delay?: number;
}

export default function NumberTicker({ value, className = '', style, delay = 0 }: Props) {
  const [show, setShow] = useState(delay === 0);

  useEffect(() => {
    if (delay > 0) {
      const t = setTimeout(() => setShow(true), delay);
      return () => clearTimeout(t);
    }
  }, [delay]);

  const digits = String(value).split('');

  if (!show) {
    // Reserve space but invisible
    return <span className={className} style={{ ...style, visibility: 'hidden' }}>{value}</span>;
  }

  return (
    <span className={className} style={{ ...style, display: 'inline-flex', overflow: 'hidden' }}>
      {digits.map((d, i) => (
        <span
          key={`${i}-${d}`}
          className="animate-ticker-roll"
          style={{
            display: 'inline-block',
            animationDelay: `${i * 0.1}s`,
          }}
        >
          {d}
        </span>
      ))}
    </span>
  );
}
