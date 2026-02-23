export const FB_DEVICE_CATEGORIES = {
  Motor: "Motor",
  Sensor: "Sensor",
  Valve: "Valve",
  Pushbutton: "Pushbutton",
  LightTower: "LightTower",
  VFD: "VFD",
  ConveyorSection: "ConveyorSection",
  ZPASection: "ZPASection",
  Custom: "Custom",
} as const;

export type FbDeviceCategory = (typeof FB_DEVICE_CATEGORIES)[keyof typeof FB_DEVICE_CATEGORIES];

export interface FbTemplate {
  id: string;
  name: string;
  device_category: FbDeviceCategory;
  plc_brand: string;
  description: string | null;
  base_scl: string;
  parameters: Record<string, unknown>;
  tags: string[];
  created_by: string | null;
  updated_at: string;
  created_at: string;
}

export type FbTemplateCreate = Omit<FbTemplate, "id" | "created_at" | "updated_at" | "created_by">;

export type FbTemplateUpdate = Partial<FbTemplateCreate>;
