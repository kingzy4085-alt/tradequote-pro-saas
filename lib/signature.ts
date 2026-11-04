import { z } from 'zod';

/** Matches the limit on the signature columns in the database. */
export const MAX_SIGNATURE_LENGTH = 300_000;

/** A signature drawn on components/signature-pad.tsx: a PNG data URL. */
export const signatureImage = z
  .string()
  .startsWith('data:image/png;base64,', 'Draw a signature first')
  .max(MAX_SIGNATURE_LENGTH, 'Signature image is too large');
