export function runningInClient() {
  return typeof window === 'object';
}
