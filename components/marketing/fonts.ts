import { Archivo } from 'next/font/google';

// Condensed, heavy sans for headlines: it reads like site signage. Inter (the app font) stays for body text.
export const display = Archivo({
  subsets: ['latin'],
  axes: ['wdth'],
  variable: '--font-display',
  display: 'swap',
});
