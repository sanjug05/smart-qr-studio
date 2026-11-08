export interface NeutralFinding {
  file: string
  line: number
  rule: string
  excerpt: string
}
export const RULES: { id: string; re: RegExp }[]
export const SOURCE_TARGETS: string[]
export function scanPaths(root: string, targets: string[]): NeutralFinding[]
