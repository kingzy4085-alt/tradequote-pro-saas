import { redirect } from 'next/navigation';

// Draws are listed in the Progress Billing module; this address only has pages under it
export default function DrawsIndex() {
  redirect('/progress-billing');
}
