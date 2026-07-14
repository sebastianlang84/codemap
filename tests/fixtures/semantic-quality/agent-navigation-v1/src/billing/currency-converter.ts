export function convertInvoiceCurrency(invoiceAmount: number, exchangeRate: number): number {
  return Math.round(invoiceAmount * exchangeRate * 100) / 100;
}
