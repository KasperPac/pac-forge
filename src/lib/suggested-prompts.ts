export interface SuggestedPrompt {
  label: string;
  prompt: string;
  category: string;
}

export const SUGGESTED_PROMPTS: SuggestedPrompt[] = [
  {
    label: "Conveyor System",
    category: "Material Handling",
    prompt:
      "Generate a conveyor belt control system with 3 zones. Each zone has a presence sensor (BOOL) and a motor drive (BOOL). Implement zone-to-zone handoff logic: a zone starts its motor only when the upstream zone has a part present AND the downstream zone is clear. Include an emergency stop input that stops all zones.",
  },
  {
    label: "Motor Control",
    category: "Drives",
    prompt:
      "Generate a motor control FB with star-delta start sequence. Inputs: Start command, Stop command, Motor protection relay feedback. Outputs: Main contactor, Star contactor, Delta contactor, Running status, Fault status. Include a configurable changeover delay (default 5s) and automatic restart lockout after 3 consecutive faults.",
  },
  {
    label: "Valve Sequencer",
    category: "Process Control",
    prompt:
      "Generate a sequential valve control system for a 4-step batch process: Fill → Heat → Mix → Drain. Each step has an inlet/outlet valve (BOOL), a level sensor (REAL 0-100%), and a temperature sensor (REAL). Transitions happen on configurable setpoints. Include a HOLD/RESUME command and a safe-state ABORT that closes all valves.",
  },
  {
    label: "Tank Level Control",
    category: "Process Control",
    prompt:
      "Generate a tank level control system with analog level input (4-20mA mapped to 0-100%), high-high and low-low alarms (BOOL outputs), and a PID-controlled fill valve (REAL 0-100% output). Include alarm hysteresis, pump dry-run protection (auto-stop if level < 5% for 10s), and a manual override mode.",
  },
  {
    label: "Alarm Handler",
    category: "Safety & HMI",
    prompt:
      "Generate a reusable alarm handler FB that manages up to 16 alarm inputs. For each alarm: track active/acknowledged/cleared states, timestamp first occurrence, count total activations, and provide a horn output (silenceable). Expose a summary word (16 bits = 16 alarms) and a highest-priority-active output.",
  },
  {
    label: "Pick-and-Place",
    category: "Motion",
    prompt:
      "Generate a 2-axis pick-and-place control with pneumatic cylinders. Horizontal axis (extend/retract) and vertical axis (up/down), each with 2 end-position sensors. Gripper (open/close) with a part-present sensor. Sequence: Home → Pick (down, grip, up) → Place (extend, down, release, up, retract). Include cycle counter and auto/manual mode selection.",
  },
];
