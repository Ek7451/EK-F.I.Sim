import type { SamplePlanId } from '@fisim/engine';

export interface TourStep {
  /** Screen the step happens on. The engine navigates there when the step opens. */
  route: string;
  /**
   * `data-tour` anchor to spotlight. Several anchors may be given separated by `|`; the first one visible on this
   * screen size wins (for example the side rail on desktop and the bottom bar on a phone). Omit for a centred card.
   */
  target?: string;
  title: string;
  /** Plain text. `{placeholders}` are filled with live numbers from the sandbox plan. */
  body: string;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  /** Invite the user to try the control. Next always stays available, so a tour never depends on a pointer. */
  action?: { on: 'click' | 'input'; prompt: string };
  /** Anchor on the "How this is calculated" page that explains the numbers behind this step. */
  explain?: string;
}

export interface TourDef {
  id: string;
  title: string;
  level: 'basic' | 'advanced';
  minutes: number;
  summary: string;
  prerequisites: string[];
  featureIds: string[];
  samplePlan: SamplePlanId;
  steps: TourStep[];
}
