import { redirect } from 'next/navigation';

// Progress billing and receivables are handled on Invoices
export default function Page() {
  redirect('/invoices');
}
