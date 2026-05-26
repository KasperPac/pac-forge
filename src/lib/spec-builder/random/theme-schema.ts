/**
 * Zod schema for the small theme JSON the AI returns in Stage 1 of the
 * random FDS builder. The AI provides names + prose only — every shape
 * that the V2 contract validator checks is built deterministically in
 * Stage 2.
 */
import { z } from "zod";

export const RandomFdsDeviceClassSchema = z.enum([
  "valve",
  "motor",
  "sensor_level",
  "sensor_pressure",
  "sensor_temperature",
  "sensor_weight",
  "sensor_flow",
  "sensor_position",
  "indicator",
  "transmitter",
  "filter",
  "conveyor",
  "hopper",
  "transporter",
  "dryer",
  "cooler",
  "push_button",
  "emergency_stop",
  "other",
]);
export type RandomFdsDeviceClass = z.infer<typeof RandomFdsDeviceClassSchema>;

export const RandomFdsDeviceSpecSchema = z.object({
  device_name: z.string().min(1),
  device_class: RandomFdsDeviceClassSchema,
  description: z.string(),
  is_safety: z.boolean(),
});
export type RandomFdsDeviceSpec = z.infer<typeof RandomFdsDeviceSpecSchema>;

export const RandomFdsAssemblySpecSchema = z.object({
  assembly_name: z.string().min(1),
  description: z.string(),
  devices: z.array(RandomFdsDeviceSpecSchema).min(1),
});
export type RandomFdsAssemblySpec = z.infer<typeof RandomFdsAssemblySpecSchema>;

export const RandomFdsSubsystemSpecSchema = z.object({
  subsystem_name: z.string().min(1),
  equipment_type: z.string().min(1),
  description: z.string(),
  assemblies: z.array(RandomFdsAssemblySpecSchema).min(1),
});
export type RandomFdsSubsystemSpec = z.infer<typeof RandomFdsSubsystemSpecSchema>;

export const RandomFdsThemeSchema = z.object({
  title: z.string().min(1),
  system_description: z.string(),
  plc_model: z.string(),
  hmi_type: z.string(),
  fault_philosophy: z.string(),
  design_principles: z.array(z.string()).min(1),
  machine_theme: z.string(),
  safety_classification: z.string().nullable(),
  subsystems: z.array(RandomFdsSubsystemSpecSchema).min(1),
});
export type RandomFdsTheme = z.infer<typeof RandomFdsThemeSchema>;
