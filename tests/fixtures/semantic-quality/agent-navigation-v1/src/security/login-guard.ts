const maximumFailedAttempts = 5;

export function blockRepeatedSignIns(failedAttempts: number): boolean {
  return failedAttempts >= maximumFailedAttempts;
}
