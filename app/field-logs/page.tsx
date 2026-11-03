import { redirect } from 'next/navigation';

// Field logs and daily logs are one module
export default function FieldLogsPage() {
  redirect('/daily-logs');
}
