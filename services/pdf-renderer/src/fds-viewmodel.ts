/**
 * Maps a Spec Contract V2 (src/types/spec-contract-v2.ts in the app) to the
 * flat view-model consumed by pac-fds.html. The renderer stays dumb: callers
 * may POST either a ready view-model ({ fds }) or a raw contract
 * ({ contract, meta }) — this module handles the latter.
 *
 * Generic across machine types by construction: everything is read from the
 * contract; nothing project-specific is assumed.
 */

export interface FdsViewModel {
  doc: {
    code: string;
    revision: string;
    date_display: string;
    title: string;
    subtitle: string;
    client: string;
    platform: string;
  };
  toc: Array<{ num: string; title: string }>;
  revisions: Array<{ rev: string; date: string; author: string; note: string }>;
  overview: {
    description: string;
    design_principles: string[];
    exclusions: string[];
  };
  architecture: {
    devices: Array<{ name: string; catalog: string; ip: string; role: string }>;
  };
  philosophy: {
    modes: Array<{ name: string; kind: string; desc: string; default: boolean }>;
    fault_philosophy: string;
    safety: string;
  };
  io: Array<{
    tag: string;
    device_type: string;
    signal_type: string;
    io_address: string;
    description: string;
  }>;
  functional: Array<{
    num: string;
    name: string;
    description: string;
    control_modules: Array<{ name: string; cls: string; desc: string; safety: boolean }>;
    states: Array<{ name: string; kind: string; safe: boolean }>;
    sequences: Array<{
      state_name: string;
      permissives: string[];
      steps: Array<{ n: number; action: string; criteria: string }>;
      notes: string;
    }>;
  }>;
  alarms: Array<{
    tag: string;
    sev: string;
    sev_label: string;
    description: string;
    action: string;
  }>;
  signoff: Array<{ role: string; name: string }>;
}

interface MapMeta {
  revision?: string;
  date_display?: string;
  subtitle?: string;
  author?: string;
  revision_note?: string;
}

/* Loosely-typed contract input — the renderer does not depend on the app's
 * zod schemas; it reads only the fields it renders. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

function permText(p: AnyRec): string {
  return `${p.tag} ${p.operator} ${p.value}`;
}

function criteriaText(criteria: AnyRec[] | undefined, fallback: string): string {
  if (fallback) return fallback;
  if (!criteria?.length) return "—";
  return criteria
    .map((c) => {
      switch (c.kind) {
        case "tag_equals":
          return `${c.tag} = ${c.value}`;
        case "tag_compare":
          return `${c.tag} ${c.op} ${c.value}`;
        case "expression":
          return c.text;
        case "manual_ack":
          return `Operator: ${c.prompt}`;
        default:
          return "TBD";
      }
    })
    .join(" AND ");
}

export function mapSpecContractToFdsView(
  contract: AnyRec,
  meta: MapMeta = {},
): FdsViewModel {
  const project = contract.project ?? {};
  const units: AnyRec[] = contract.hierarchy?.units ?? [];
  const emContracts: AnyRec = contract.equipment_modules ?? {};

  const devices: FdsViewModel["architecture"]["devices"] = [];
  const functional: FdsViewModel["functional"] = [];
  let fnNum = 0;

  for (const unit of units) {
    for (const em of unit.equipment_modules ?? []) {
      fnNum += 1;
      const emc = emContracts[em.equipment_module_id] ?? {};
      const states: AnyRec[] = emc.states ?? [];
      const seqStates: AnyRec = emc.sequential_states ?? {};

      for (const cm of em.control_modules ?? []) {
        if (cm.network_config) {
          devices.push({
            name: cm.control_module_name,
            catalog: cm.control_module_class,
            ip: cm.network_config.ip_address ?? "",
            role: cm.description ?? "",
          });
        }
      }

      functional.push({
        num: `6.${fnNum}`,
        name: em.equipment_module_name,
        description: em.description ?? "",
        control_modules: (em.control_modules ?? []).map((cm: AnyRec) => ({
          name: cm.control_module_name,
          cls: cm.control_module_class,
          desc: cm.description ?? "",
          safety: !!cm.is_safety,
        })),
        states: states.map((s) => ({
          name: s.name ?? s.state_id,
          kind: s.kind,
          safe: !!s.is_safe_state,
        })),
        sequences: Object.entries(seqStates).map(([stateId, seq]) => {
          const s = seq as AnyRec;
          const stateName =
            states.find((st) => st.state_id === stateId)?.name ?? stateId;
          return {
            state_name: stateName,
            permissives: (s.permissives ?? []).map(permText),
            steps: (s.steps ?? []).map((step: AnyRec) => ({
              n: step.step,
              action: step.action ?? step.name ?? "",
              criteria: criteriaText(
                step.completion_criteria,
                step.completion_criteria_text ?? "",
              ),
            })),
            notes: s.notes ?? "",
          };
        }),
      });
    }
  }

  const alarms: FdsViewModel["alarms"] = (contract.faults ?? []).map(
    (f: AnyRec) => ({
      tag: f.triggered_by_tag,
      sev: f.severity,
      sev_label: f.severity === "critical" ? "CRITICAL" : f.severity.toUpperCase(),
      description: f.description,
      action: f.action_text ?? "",
    }),
  );
  if (alarms.length === 0) {
    for (const a of contract.alarms ?? []) {
      alarms.push({
        tag: a.tag,
        sev: a.tier_id === "critical" ? "critical" : "fault",
        sev_label: (a.tier_id ?? "fault").toUpperCase(),
        description: a.description,
        action: a.action ?? "",
      });
    }
  }

  const unitName = units[0]?.unit_name ?? "";

  return {
    doc: {
      code: project.doc_code ?? "FDS-XXXX",
      revision: meta.revision ?? "01",
      date_display: meta.date_display ?? "",
      title: project.title ?? "Functional Design Specification",
      subtitle: meta.subtitle ?? unitName,
      client: project.client_name ?? "",
      platform: project.plc_model ?? "",
    },
    toc: [
      { num: "1", title: "Document control" },
      { num: "2", title: "Introduction & scope" },
      { num: "3", title: "System architecture" },
      { num: "4", title: "Control philosophy & modes of operation" },
      { num: "5", title: "I/O schedule" },
      { num: "6", title: "Functional descriptions" },
      { num: "7", title: "Alarms & interlocks" },
      { num: "8", title: "Approval & sign-off" },
    ],
    revisions: [
      {
        rev: meta.revision ?? "01",
        date: meta.date_display ?? "",
        author: meta.author ?? "Pac Technologies",
        note: meta.revision_note ?? "Issued for review",
      },
    ],
    overview: {
      description: project.system_description ?? "",
      design_principles: project.design_principles ?? [],
      exclusions: project.scope_exclusions ?? [],
    },
    architecture: { devices },
    philosophy: {
      modes: (contract.modes ?? []).map((m: AnyRec) => ({
        name: m.name,
        kind: m.kind ?? "custom",
        desc: m.description ?? "",
        default: !!m.is_default,
      })),
      fault_philosophy: project.fault_philosophy ?? "",
      safety: project.safety_classification ?? "",
    },
    io: (contract.io_list ?? []).map((row: AnyRec) => ({
      tag: row.tag,
      device_type: row.device_type,
      signal_type: row.signal_type,
      io_address: row.io_address,
      description: row.description,
    })),
    functional,
    alarms,
    signoff: [
      { role: "Prepared by", name: meta.author ?? "Pac Technologies" },
      { role: "Reviewed by", name: "" },
      { role: "Approved by (client)", name: "" },
    ],
  };
}
