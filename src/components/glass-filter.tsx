export function GlassFilter() {
  return (
    <svg className="glass-filter-definitions" xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        <filter id="radio-glass" x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.018" numOctaves="1" seed="1" result="turbulence" />
          <feGaussianBlur in="turbulence" stdDeviation="3" result="blurredNoise" />
          <feDisplacementMap in="SourceGraphic" in2="blurredNoise" scale="12" xChannelSelector="R" yChannelSelector="B" result="displaced" />
          <feGaussianBlur in="displaced" stdDeviation="0.6" />
        </filter>
      </defs>
    </svg>
  );
}
