import type { CSSProperties } from 'react';

type HermesMarkProps = {
  size?: number;
  className?: string;
};

/**
 * Hermes brand mark sourced from the artwork supplied by the repository owner.
 * CSS masks keep the SVG colour theme-aware without duplicating the vector path in JS.
 */
export function HermesMark({ size = 20, className = '' }: HermesMarkProps) {
  const style = { width: size, height: size } satisfies CSSProperties;
  return <span aria-hidden="true" className={`hermes-mark${className ? ` ${className}` : ''}`} style={style}/>;
}
