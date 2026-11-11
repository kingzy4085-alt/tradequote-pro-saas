// TradeQuote PRO — window.TQ. Hand-written from the class patterns in app/**/page.tsx.
import type * as React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = amber, the one main action. danger = soft red delete. success/info/critical = module submit colours. */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'info' | 'critical';
  /** sm = table row actions; md = header actions; lg = form submit; block = full-width form submit. */
  size?: 'sm' | 'md' | 'lg' | 'block';
  /** Renders an <a> instead of a <button>. */
  href?: string;
  children: React.ReactNode;
}
export declare function Button(props: ButtonProps): JSX.Element;

export interface TextFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Uppercase label above the input. */
  label?: string;
  /** 8px radius, 8px vertical padding: modals and search. */
  compact?: boolean;
  /** Monospace value: phone, PO and serial numbers. */
  mono?: boolean;
}
export declare function TextField(props: TextFieldProps): JSX.Element;

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: Array<string | { value: string; label: string }>;
  compact?: boolean;
}
export declare function Select(props: SelectProps): JSX.Element;

export interface BadgeProps {
  /** The status in words: Active, Pending, Completed. */
  children: React.ReactNode;
  className?: string;
}
export declare function Badge(props: BadgeProps): JSX.Element;

export interface StatCardProps {
  /** Uppercase metric name. */
  label: string;
  value: React.ReactNode;
  /** One amber line saying what is counted. */
  caption?: string;
  /** Shows "..." in place of the value. */
  loading?: boolean;
  className?: string;
}
export declare function StatCard(props: StatCardProps): JSX.Element;

export interface PanelProps {
  title?: string;
  /** With a description the title steps up to section-title. */
  description?: string;
  /** 32px padding instead of 24px. */
  roomy?: boolean;
  children?: React.ReactNode;
  className?: string;
}
export declare function Panel(props: PanelProps): JSX.Element;

export interface DataTableColumn<Row = any> {
  key: string;
  header: string;
  /** primary = white medium (the name column); muted = slate-400 (dates). */
  tone?: 'primary' | 'muted';
  align?: 'left' | 'right';
  render?: (row: Row) => React.ReactNode;
}
export interface DataTableProps<Row = any> {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  /** Header strip, e.g. "Records (12)". */
  title?: string;
  loading?: boolean;
  loadingText?: string;
  emptyText?: string;
  className?: string;
}
export declare function DataTable(props: DataTableProps): JSX.Element;

export interface ModalProps {
  title: string;
  open?: boolean;
  onClose?: () => void;
  /** Buttons, right-aligned: Cancel (ghost) then the primary action. */
  actions?: React.ReactNode;
  /** Render in flow instead of fixed over the page (docs, previews). */
  inline?: boolean;
  children?: React.ReactNode;
}
export declare function Modal(props: ModalProps): JSX.Element | null;

export interface ModuleTileProps {
  href: string;
  children: React.ReactNode;
  className?: string;
}
export declare function ModuleTile(props: ModuleTileProps): JSX.Element;

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Adds the amber "← Back to Command Center" link above the title. */
  backHref?: string;
  backLabel?: string;
  actions?: React.ReactNode;
  className?: string;
}
export declare function PageHeader(props: PageHeaderProps): JSX.Element;

export interface ResultPanelProps {
  /** The module's colour: success = CRM, info = Proposals, critical = Punch List. */
  tone?: 'success' | 'info' | 'critical';
  title: string;
  /** Pretty-printed as JSON in a mono block. */
  data?: unknown;
  children?: React.ReactNode;
  className?: string;
}
export declare function ResultPanel(props: ResultPanelProps): JSX.Element;
