export function rebalancePositions(currentWeights: number[], targetWeights: number[]): number[] {
  return targetWeights.map((target, index) => target - (currentWeights[index] ?? 0));
}
