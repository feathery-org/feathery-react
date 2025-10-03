export function isKeydownValid(
  event: React.KeyboardEvent<HTMLInputElement>
): boolean {
  return Boolean(event.isTrusted && event.code);
}
