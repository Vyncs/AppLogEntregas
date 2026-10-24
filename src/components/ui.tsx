import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import type { Confidence } from '../services/label/labelParser';
import { STATUS_LABEL, type PackageStatus } from '../types/package';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'success' | 'warning' | 'danger' | 'destructive';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 active:bg-brand-800',
  secondary: 'bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50',
  ghost: 'bg-transparent text-slate-700 hover:bg-slate-200/60',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700',
  warning: 'bg-amber-500 text-white hover:bg-amber-600',
  danger: 'bg-white text-red-700 ring-1 ring-red-300 hover:bg-red-50',
  /** Confirmação de algo que não volta (apagar) */
  destructive: 'bg-red-600 text-white hover:bg-red-700',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'md' | 'lg';
  block?: boolean;
}

export function Button({ variant = 'primary', size = 'md', block, className = '', ...rest }: ButtonProps) {
  const sizing = size === 'lg' ? 'min-h-14 px-5 text-lg' : 'min-h-11 px-4 text-sm';
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${sizing} ${VARIANT[variant]} ${block ? 'w-full' : ''} ${className}`}
      {...rest}
    />
  );
}

const STATUS_STYLE: Record<PackageStatus, string> = {
  pending: 'bg-sky-100 text-sky-800',
  delivered: 'bg-emerald-100 text-emerald-800',
  problem: 'bg-amber-100 text-amber-900',
};

export function StatusBadge({ status }: { status: PackageStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

const CONFIDENCE_STYLE: Record<Confidence, string> = {
  low: 'border-red-400 bg-red-50',
  medium: 'border-amber-300 bg-amber-50',
  high: 'border-slate-300 bg-white',
};

const CONFIDENCE_HINT: Partial<Record<Confidence, string>> = {
  low: 'confira',
  medium: 'revise',
};

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Sem valor = campo já conferido (ou editado) pelo usuário */
  confidence?: Confidence;
  error?: string;
  action?: ReactNode;
}

export function Field({ label, value, onChange, confidence, error, action, id, className = '', ...rest }: FieldProps) {
  const inputId = id ?? `campo-${label.toLowerCase().replace(/\W+/g, '-')}`;
  const tone = error ? 'border-red-500 bg-red-50' : confidence ? CONFIDENCE_STYLE[confidence] : 'border-slate-300 bg-white';
  const hint = !error && confidence ? CONFIDENCE_HINT[confidence] : undefined;
  return (
    <div className={className}>
      <label htmlFor={inputId} className="mb-1 flex items-center justify-between text-xs font-medium text-slate-600">
        {label}
        {hint && (
          <span className={confidence === 'low' ? 'font-semibold text-red-700' : 'font-semibold text-amber-700'}>
            {hint}
          </span>
        )}
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-erro` : undefined}
          className={`min-h-12 w-full rounded-xl border px-3 text-base outline-none transition focus:border-brand-600 ${tone}`}
          {...rest}
        />
        {action}
      </div>
      {error && (
        <p id={`${inputId}-erro`} className="mt-1 text-xs font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export function Spinner({ className = 'size-5' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent ${className}`}
    />
  );
}
