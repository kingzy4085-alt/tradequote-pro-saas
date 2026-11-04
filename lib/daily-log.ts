import { z } from 'zod';
import { signatureImage } from './signature';

export const JOB_PHOTOS_BUCKET = 'job-photos';
export const MAX_PHOTOS = 50;

/** Storage folder for one log's photos. The database only accepts photo paths inside it. */
export const photoFolder = (companyId: string, logId: string) => `${companyId}/daily-logs/${logId}/`;

export const DailyLogAction = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('photos'),
    photos: z.array(z.string().max(300)).max(MAX_PHOTOS, `A log can have up to ${MAX_PHOTOS} photos`),
  }),
  z.object({
    action: z.literal('sign'),
    signed_by: z.string().trim().min(1, 'Enter the name of the person signing').max(200),
    signature: signatureImage,
  }),
  z.object({ action: z.literal('reopen') }),
]);
export type DailyLogAction = z.infer<typeof DailyLogAction>;
