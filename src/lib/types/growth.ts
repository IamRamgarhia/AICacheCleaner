// Shared between the server (/api/growth) and the overview GrowthPanel.

/** One scan per local day (the latest of that day wins). */
export interface GrowthPoint {
  /** Local date, YYYY-MM-DD. */
  date: string;
  totalBytes: number;
  /** Bytes per tool (scan item `category`). */
  perTool: Record<string, number>;
}

export interface ToolGrowth {
  tool: string;
  currentBytes: number;
  /** Bytes gained (negative = shrank). Null when there is no earlier point. */
  change7d: number | null;
  change30d: number | null;
}

export interface GrowthReport {
  points: GrowthPoint[];
  /** Days between the oldest and newest point; a window shorter than 7/30
   *  days means the change covers only this many days. */
  spanDays: number;
  totalChange7d: number | null;
  totalChange30d: number | null;
  /** Fastest growing first. */
  tools: ToolGrowth[];
}
