export async function GET() {
  const macroSnapshot = await loadMacroSnapshot();
  return Response.json({ macroSnapshot, channel: "newsletter" });
}

async function loadMacroSnapshot() {
  return { risk: "steady" };
}
