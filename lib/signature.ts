import { z } from 'zod';

export const MAX_SIGNATURE_LENGTH = 300_000;

/** A drawn signature from components/signature-pad.tsx: a PNG data URL. Records store it in a text column. */
export const SignatureImage = z
  .string()
  .max(MAX_SIGNATURE_LENGTH, 'Signature image is too large')
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/, 'Draw a signature first');

/** The name of the person signing. */
export const SignerName = z.string().trim().min(1, 'Enter the name of the person signing').max(200);
