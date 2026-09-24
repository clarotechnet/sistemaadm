type BrandLogoProps = {
  size?: number;
  className?: string;
};

export function BrandLogo({ size = 40, className = "" }: BrandLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="RH Controle"
      role="img"
    >
      <rect x="0" y="0" width="64" height="64" rx="12" fill="#E31B23" />

      <circle cx="32" cy="32" r="22" stroke="white" strokeWidth="2.2" opacity="0.95" />
      <circle cx="32" cy="32" r="18" stroke="white" strokeWidth="2" opacity="0.95" />
      <circle cx="32" cy="32" r="14" stroke="white" strokeWidth="1.8" opacity="0.95" />
      <circle cx="32" cy="32" r="10" stroke="white" strokeWidth="1.6" opacity="0.95" />
      <circle cx="32" cy="32" r="6.5" fill="white" />
    </svg>
  );
}