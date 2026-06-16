import { describe, expect, it } from "vitest";
import { DEVICE_TEMPLATES, type DeviceTemplate } from "../device-templates";
import { RandomFdsControlModuleClassSchema } from "../theme-schema";

describe("device templates", () => {
  it("covers every RandomFdsControlModuleClass enum value", () => {
    const classes = RandomFdsControlModuleClassSchema.options;
    for (const cls of classes) {
      expect(DEVICE_TEMPLATES[cls], `template for ${cls}`).toBeDefined();
    }
  });

  it("every template has at least one IO signal slot", () => {
    for (const [cls, tpl] of Object.entries(DEVICE_TEMPLATES) as [string, DeviceTemplate][]) {
      expect(tpl.ioSlots.length, `${cls}.ioSlots`).toBeGreaterThan(0);
    }
  });

  it("every IO slot uses a valid IO kind", () => {
    for (const tpl of Object.values(DEVICE_TEMPLATES)) {
      for (const slot of tpl.ioSlots) {
        expect(["DI", "DO", "AI", "AO"]).toContain(slot.kind);
      }
    }
  });

  it("every step template only references slot suffixes that exist on the device", () => {
    for (const [cls, tpl] of Object.entries(DEVICE_TEMPLATES) as [string, DeviceTemplate][]) {
      const knownSuffixes = new Set(tpl.ioSlots.map((s) => s.suffix));
      for (const [stateKey, steps] of Object.entries(tpl.stepTemplates)) {
        for (const step of steps) {
          for (const ref of step.referencedSuffixes) {
            expect(
              knownSuffixes.has(ref),
              `${cls}.stepTemplates[${stateKey}] references unknown suffix ${ref}`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it("motor template has at least one Starting and one Stopping step", () => {
    const motor = DEVICE_TEMPLATES.motor;
    expect(motor.stepTemplates.STARTING.length).toBeGreaterThan(0);
    expect(motor.stepTemplates.STOPPING.length).toBeGreaterThan(0);
  });
});
