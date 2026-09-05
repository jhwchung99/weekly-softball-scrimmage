import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'success';
type Size = 'sm' | 'md';

const VARIANT_STYLES: Record<Variant, string> = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700',
  secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
  danger: 'border border-red-300 bg-white text-red-700 hover:bg-red-50',
  success: 'bg-green-600 text-white hover:bg-green-700',
};

const SIZE_STYLES: Record<Size, string> = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-4 py-2 text-sm',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

/** Replaces the three-ish different hand-copied button className strings
 * that were previously repeated at every call site. */
export function Button({ variant = 'primary', size = 'md', className = '', ...rest }: ButtonProps) {
  return (
    <button
      className={`rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_STYLES[variant]} ${SIZE_STYLES[size]} ${className}`}
      {...rest}
    />
  );
}
