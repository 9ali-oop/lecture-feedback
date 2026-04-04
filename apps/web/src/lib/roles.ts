export function roleHome(role: string): string {
  if (role === 'admin') return '/admin';
  if (role === 'lecturer') return '/lecturer';
  return '/student';
}
