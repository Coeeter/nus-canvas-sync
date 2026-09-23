export const STATUSES = ["Not started", "In progress", "Done", "Dropped"] as const;
export const AVAILABILITIES = ["Locked", "Ready", "Blocked", "Review"] as const;

export type Status = (typeof STATUSES)[number];
export type Availability = (typeof AVAILABILITIES)[number];

export interface CourseConfig {
  code: string;
  name: string;
  canvasId: number;
  delivery: string;
  structure: Array<string>;
}

export interface SemesterConfig {
  term: string;
  timezone: string;
  dashboard: { pageId: string; syncStatusBlockId: string };
  startDate: string;
  endDate: string;
  courses: Array<CourseConfig>;
  timetable: Array<string>;
  notes: Array<string>;
}

export interface ActionValues {
  action: string;
  course: string;
  status: Status;
  availability: Availability;
  weight: number | null;
  startBy: string | null;
  due: string | null;
  source: string | null;
  notes: string;
  archived: boolean;
}

export interface Action extends ActionValues {
  id: string;
  notionPageId: string | null;
  origin: "manual" | "agent" | "imported";
  term: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotionRow {
  pageId: string;
  values: ActionValues;
}
