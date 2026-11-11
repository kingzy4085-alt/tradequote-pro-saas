import Link from 'next/link';
import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

// TradeQuote PRO primitives, built from the design system's tokens (slate surfaces, amber accent).

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

const BUTTON_VARIANTS = {
  primary: 'bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold shadow',
  secondary: 'bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold border border-slate-700 shadow',
  ghost: 'bg-slate-800 hover:bg-slate-700 text-slate-300',
  danger: 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 font-semibold',
} as const;

// Phones and tablets get the 48px the pricing page promises, for gloves. A desk keeps the tighter size.
const TOUCH_TARGET = 'min-h-[48px] lg:min-h-0';

const BUTTON_SIZES = {
  sm: 'px-3 py-1.5 text-xs rounded-lg',
  md: 'px-4 py-2.5 rounded-lg',
  lg: 'px-6 py-3 rounded-xl',
} as const;

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON_VARIANTS; size?: keyof typeof BUTTON_SIZES }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        TOUCH_TARGET,
        'inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className
      )}
    />
  );
}

export function ButtonLink({ href, variant = 'primary', size = 'md', children, className }: { href: string; variant?: keyof typeof BUTTON_VARIANTS; size?: keyof typeof BUTTON_SIZES; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cx(TOUCH_TARGET, 'inline-flex items-center justify-center gap-2 transition-colors', BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}>
      {children}
    </Link>
  );
}

const inputClass =
  'w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 aria-[invalid=true]:border-red-500/60';

export function Label({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
      {children}
    </label>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-red-400 mt-1" role="alert">{message}</p>;
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(props, ref) {
  return <input ref={ref} {...props} className={cx(inputClass, props.className)} />;
});

export function Select({ options, placeholder, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { options: (string | { value: string; label: string })[]; placeholder?: string }) {
  return (
    <select {...props} className={cx(inputClass, props.className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => {
        const { value, label } = typeof o === 'string' ? { value: o, label: o } : o;
        return (
          <option key={value} value={value}>
            {label}
          </option>
        );
      })}
    </select>
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={4} {...props} className={cx(inputClass, 'resize-y', props.className)} />;
}

export function Badge({ children }: { children: ReactNode }) {
  return <span className="inline-block bg-amber-500/10 text-amber-400 border border-amber-500/20 px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap">{children}</span>;
}

export function Panel({ title, description, children, className, roomy }: { title?: string; description?: string; children: ReactNode; className?: string; roomy?: boolean }) {
  return (
    <section className={cx('bg-slate-900 border border-slate-800 rounded-2xl shadow-xl', roomy ? 'p-8' : 'p-6', className)}>
      {title && <h2 className={cx('font-bold text-white mb-4', description ? 'text-xl' : 'text-lg')}>{title}</h2>}
      {description && <p className="text-slate-400 text-sm -mt-2 mb-6">{description}</p>}
      {children}
    </section>
  );
}

export function StatCard({ label, value, caption, href, meter }: { label: string; value: ReactNode; caption?: string; href?: string; /** 0 to 100: a thin bar under the figure. The caption has to say the same thing in words. */ meter?: number }) {
  const body = (
    <>
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">{label}</p>
      <p className="text-3xl sm:text-4xl font-extrabold text-white break-words">{value}</p>
      {meter !== undefined && (
        <div aria-hidden="true" className="mt-3 h-1.5 rounded-full bg-slate-800 overflow-hidden">
          <div className="h-full bg-amber-500" style={{ width: `${meter}%` }} />
        </div>
      )}
      {caption && <p className="text-xs text-amber-400 mt-2">{caption}</p>}
    </>
  );
  const cls = 'block bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl';
  return href ? (
    <Link href={href} className={cx(cls, 'hover:border-amber-500/50 transition-colors')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function PageHeader({ title, subtitle, back, actions }: { title: string; subtitle?: string; back?: { href: string; label: string }; actions?: ReactNode }) {
  return (
    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
      <div>
        {back && (
          <Link href={back.href} className="text-xs font-semibold text-amber-500 hover:underline uppercase tracking-wider">
            ← {back.label}
          </Link>
        )}
        <h1 className="text-3xl font-bold tracking-tight text-white mt-1">{title}</h1>
        {subtitle && <p className="text-slate-400 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}

export function Alert({ tone = 'error', children }: { tone?: 'error' | 'success' | 'info'; children: ReactNode }) {
  const styles = {
    error: 'border-red-500/30 bg-red-500/10 text-red-300',
    success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    info: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  }[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('border rounded-xl px-4 py-3 text-sm', styles)}>
      {children}
    </div>
  );
}

export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <p className="text-center text-2xl font-extrabold tracking-tight text-white mb-6">
          TradeQuote <span className="text-amber-500">PRO</span>
        </p>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl">
          <h1 className="text-xl font-bold text-white">{title}</h1>
          {subtitle && <p className="text-sm text-slate-400 mt-1">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <div className="text-center text-sm text-slate-400 mt-6">{footer}</div>}
      </div>
    </main>
  );
}
