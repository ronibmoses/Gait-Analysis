
export enum Gender {
  MALE = 'Male',
  FEMALE = 'Female',
  OTHER = 'Other',
  PREFER_NOT_TO_SAY = 'Prefer not to say'
}

export interface UserProfile {
  firstName: string;
  lastName: string;
  email: string;
  age: number;
  gender: Gender;
  height: number; // in cm
}

export interface GaitMetrics {
  stepCount: number;
  cadence: number; // steps per minute
  stepTimeVariability: number; // milliseconds or relative score
  meanStepInterval: number; // seconds
  gaitSpeed: string; // "Slow", "Normal", "Fast" or relative numerical score
  baseOfSupport: string; // "Narrow", "Normal", "Wide"
  averageBaseOfSupportCm?: number; // Calculated base of support in cm
  turningDuration: number; // seconds, 0 if no turn
  analysisSummary: string;
  trackedSubjectImage?: string; // Snapshot of the analyzed person with skeleton overlay
}

export enum AppState {
  FORM = 'FORM',
  VIDEO_INPUT = 'VIDEO_INPUT',
  ANALYZING = 'ANALYZING',
  RESULTS = 'RESULTS'
}
