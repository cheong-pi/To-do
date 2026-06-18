export function keepEndAtOrAfterStart(start: string, end: string) {
  if (!end || end < start) return start;
  return end;
}
