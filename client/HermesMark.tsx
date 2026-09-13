type HermesMarkProps = {
  size?: number;
  className?: string;
  tone?: 'plain' | 'on-accent';
};

const hermesMarkUrl = new URL('./hermes-mark.svg', import.meta.url).href;

/** The repository-owner-supplied Hermes SVG, used anywhere the UI identifies Hermes. */
export function HermesMark({ size = 20, className = '', tone = 'plain' }: HermesMarkProps) {
  return <img
    alt=""
    aria-hidden="true"
    className={`hermes-mark hermes-mark-${tone}${className ? ` ${className}` : ''}`}
    draggable={false}
    height={size}
    src={hermesMarkUrl}
    width={size}
  />;
}
