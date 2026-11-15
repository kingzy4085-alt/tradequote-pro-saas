export function isPublicPath(pathname: string) {
  return pathname.startsWith('/login') || pathname.startsWith('/signup') || pathname === '/' || pathname.startsWith('/legal');
}
