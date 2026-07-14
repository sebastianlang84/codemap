export function requireCurrentNewsletterInput(ageMinutes: number): void {
  if (ageMinutes > 30) {
    throw new Error("ERR_NEWSLETTER_INPUT_STALE: source material is too old");
  }
}
