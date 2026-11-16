import Image from "next/image";

/** The DataSea "D" tile used in headers and footers. `size` is in px. */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <Image
      src="/datasea-logo.png"
      alt=""
      width={size}
      height={size}
      className={`shrink-0 ${className ?? ""}`}
    />
  );
}
