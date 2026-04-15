# HMI Library Inventory

Extracted from TIA V20 project-text exports after importing the three Unified libraries.
Source Excel files live at `Docs/TIAProjectTexts{Dark,Light,OpenLibraryUnified}.xlsx`.
Full raw parser output in `HMITemplateSuite_Light_V20_Inventory.txt` and `OpenLibrary_V19_Unified_Inventory.txt` alongside this file.

---

## HMI Template Suite Light V20 (shell / chrome only)

**Faceplate types: 3** — confirms our "application shell" assumption
- `Control Modul PopUp` — generic control module popup shell
- `PieChart` — reusable pie chart widget
- `ValueStepper` — numeric stepper input

**Screen templates: 13** (names repeated across panel resolutions)
- `Dashboard`, `2300_Dashboard`
- `Machine Modules`, `2100_Machine_Modules`
- `Mixed Examples`, `2200_Mixed Examples`, `2200_Mixed_Examples`
- `2400_Wizard`
- `0003_Settings`
- `00_CopyTemplate`, `0000_CopyTemplate_single_objects`
- `4 Inch`, `7 Inch` (resolution-specific root folders)

**Popup screens: 5**
- `3100_Template` — generic popup template
- `3200_Parameter Settings`
- `3300_Alerts`
- `4 Inch`, `7 Inch`

**Takeaway**: Template Suite is **pure chrome** — layouts, navigation, dashboards, alerts, parameter settings. It provides zero device-level content. This is why we pair it with Open Library.

---

## Open Library V19 Unified (content / devices)

**Total distinct types: 262** across 39 categories.

### Device faceplates (icon — sit inline on overview screens)

| Category | Count | Items |
|---|---|---|
| Devices | 22 | `fpAnalogInput_Numeric`, `fpAnalogOutput`, `fpDigitalInput`, `fpDigitalOutput`, `fpMotor_Motor_{Horizontal,Vertical}`, `fpMotor_Pump_{Horizontal,Vertical}`, `fpMotor_SoftStarter_{Horizontal,Vertical}`, `fpMotor_SoftStarter3RW44_{Horizontal,Vertical}`, `fpPump_SoftStarter_{Horizontal,Vertical}`, `fpPump_SoftStarter3RW44_{Horizontal,Vertical}`, `fpValve_Analog_{Horizontal,Vertical}`, `fpValve_Solenoid_{Horizontal,Vertical}`, `fpVFD_Motor_{Horizontal,Vertical}`, `fpVFD_Pump_{Horizontal,Vertical}`, `fpSiwareWP321` |
| Process | 7 | `fpFlowTotalizer`, `fpHopperLevel_Bar`, `fpHopperLevel_Numeric`, `fpInterlock`, `fpPermissive`, `fpSystemControl`, `fpSystemRunControl` |

### Popup faceplates (full-screen detail views)

| Category | Count | Items |
|---|---|---|
| Devices | 13 | `fbVFD_Popup`, `fpAnalogInput_Popup`, `fpAnalogOutput_Popup`, `fpDigitalInput_Popup`, `fpDigitalOutput_Popup`, `fpMotor_SoftStarter_3RW44_Popup`, `fpMotor_SoftStarter_Popup`, `fpMotorReversing_Popup`, `fpSiwarex_Calibration_Popup`, `fpSiwarex_Popup`, `fpValve_Analog_Popup`, `fpValve_Solenoid_Popup` |
| Process | 10 | `fpFlowTotalizer_Popup`, `fpHopperLevel_Popup`, `fpInterlock{8,16}_Popup`, `fpPermissive{8,16}_Popup`, `fpPID_Compact_Popup`, `fpPID_Popup`, `fpSystemControl_Popup`, `fpSystemRunControl_Popup` |

### Device function blocks (PLC-side partners to the faceplates)

24 blocks including: `fbMotor_Reversing`, `fbMotor_Simocode`, `fbMotor_SoftStarter`, `fbMotor_SoftStarter_3RW44`, `fbServo_Unidrive`, `fbValve_Analog`, `fbValve_Hydraulic`, `fbValve_Solenoid`, `fbVFD_Analog`, `fbVFD_Danfoss`, `fbVFD_GSeries`, `fbVFD_GSeriesAdvanced`, `fbVFD_V20`, `fbAirlock_Motor`, `fbAirlock_VFD_GSeries`, `fbIO_{AnalogInput,AnalogOutput,DigitalInput,DigitalOutput}`, `fbMicroMotion_{Modbus,Profibus}`, `fbSiwarexU`, `fbSiwarexWP321`, `fbSiwarexWP321_Calibration`.

### Process function blocks

9 blocks: `fbAlarmWarning`, `fbFIFO`, `fbFlowTotalizer`, `fbHopperLevel`, `fbInterlock`, `fbLevelMonitor`, `fbPermissive`, `fbPID_Compact`, `fbStepSequencer`.

### HMI-to-PLC interface UDTs (the tag contracts)

22 UDTs defining the data interface that lets a faceplate bind to its PLC function block:

`udtHMI_3RW44Control`, `udtHMI_AnalogInput`, `udtHMI_AnalogOutput`, `udtHMI_AnalogValveControl`, `udtHMI_Brabender`, `udtHMI_Brabender_Input`, `udtHMI_Brabender_Output`, `udtHMI_Brabender_Status`, `udtHMI_DigitalInput`, `udtHMI_DigitalOutput`, `udtHMI_HopperControl_Control`, `udtHMI_HopperControl_Status`, `udtHMI_Interlock`, `udtHMI_MicroMotion`, `udtHMI_MotorControl`, `udtHMI_Permissive`, `udtHMI_PID`, `udtHMI_PID_Compact`, `udtHMI_SiwarexCalibration`, `udtHMI_SiwarexControl`, `udtHMI_SoftStarter`, `udtHMI_SystemControl`, `udtHMI_Valve3WayControl`, `udtHMI_ValveControl`, `udtHMI_VFD_Control`.

**This is the single most important finding for Phase 3.4** — these UDTs are the tag-mapping contract. Pac-Forge's tag mapping layer needs to populate these UDT instances based on each device's IO signals.

### Error UDTs

18 fault/error interface UDTs: `udtError_{AnalogInput, AnalogOutput, AnalogValve, Brabender, Hopper, MicroMotion, ModbusTCP, Motor, MotorStarterET200, PID_Compact, Simocode, SiwarexU, SiwarexWP, SoftStarter, Sterlco, USSDrive, Valve, VFD}`.

### Resources (utility functions)

**Communication (6)**: `fbAsyncParameterRW_VFD`, `fbModbusRTU`, `fbModbusTCP`, `fbModbusTCP_Wrapper`, `fbUSSCyclicInterruptComm`, `fcCRC16_ModbusRTU`.

**Conversion (17)**: bit/byte/word packing, time conversion, temperature conversion, swap helpers.

**HMI helpers (7)**: `fbErrorScroller`, `fcHMIBit`, `fcHMIBitEnable`, `fcSetHMIStatus`, `fcSetHMIStatusGeneric`, `fcSetHMIStatusSimulation`, `fcSystemRunControl`.

**IO helpers (10)**: `fcReadIB`, `fcReadID`, `fcReadIW`, `fcReadInput`, `fcReadInput_LinearScale`, `fcWriteQB`, `fcWriteQD`, `fcWriteQW`, `fcWriteOutput`, `fcWriteOutput_LinearScale`.

**Process (13)**: `fbCalculateIntegration`, `fbIntegrator`, `fbKahanSummation`, `fbPulser`, `fbPWM`, `fbRateCalc`, `fbRetentiveTimer`, `fbRunningAverage`, `fbRuntimeTimer`, `fbStacklight`, `fcBitShift_{32,64}Bit`, `fcCalculateTimeWindow`, `fcLim`, `fcTolerance`.

### Modbus vendor station blocks (57 devices)

Pre-built Modbus RTU/TCP station blocks for 15+ vendors covering VFDs, flow meters, power meters, weighing, temperature, pH, water analysis, pumps, drives. Vendors: ABB, Belimo, Binmaster, DAE Instrument, Danfoss, Delta, Emerson, Endress+Hauser, Epluse, Floridan, G Instruments, Grundfos, Hitachi, Honeywell, InSitu, Integron, Krohne, Mettler Toledo, Phoenix Contact, Ponsel, Produal, Rotork, Scandinavian Electric, Schneider, Siemens, Socomec, Sparling, Swan, Syxthsense, Telemecanique, Vacon, Weg, Wika, Yaskawa.

**Implication**: any Pac Technologies customer running one of these devices gets pre-built Modbus integration for free. Wire into the bridge's project-setup flow — if the user selects e.g. "Danfoss VLT VFD" in the device list, Pac-Forge knows the Open Library has `Danfoss_VLT` station block and can reference it.

### Supplementary devices (3)

`fbBrabender`, `fbMotorStarter_ET200`, `fbSterlco` — less common device types.

---

## Complementary model — confirmed

The two libraries are non-overlapping and fit together cleanly:

| Layer | Template Suite | Open Library |
|---|---|---|
| Panel frame + layout | ✓ | — |
| 4-level navigation system | ✓ | — |
| Color palettes + style sheets | ✓ | — |
| Alarm view + settings pages | ✓ | — |
| Dashboards, wizards, notifications | ✓ (templates) | — |
| Device faceplates (inline) | — | ✓ (29) |
| Device faceplates (popup) | — | ✓ (23) |
| PLC function blocks | — | ✓ (~40) |
| HMI↔PLC tag contracts (UDTs) | — | ✓ (22) |
| Modbus vendor integrations | — | ✓ (57) |
| Utility functions | — | ✓ (53) |

**No Types folder collision risk** — Template Suite's 3 types (`Control Modul PopUp`, `PieChart`, `ValueStepper`) are distinct from all of Open Library's 262 types.

---

## Pac-Forge integration plan impact

### Phase 3.3 (Faceplate catalog merger) — simpler than expected
- Template Suite contributes 3 chrome widgets (rare use by Pac-Forge)
- Open Library contributes the full 52-item device/process faceplate inventory
- Catalog lookup by device type: e.g. "Motor DOL" → check Open Library for `fpMotor_Motor_Horizontal` match
- Naming convention: Open Library uses `fp` prefix for faceplates, `fb` for function blocks, `udt` for UDTs, `fc` for functions

### Phase 3.4 (Tag mapping layer) — now has a concrete target
- Each Open Library device FB exposes a `udtHMI_*` struct on its instance DB
- Faceplates bind to these UDTs via the standard WinCC Unified tag-interface mechanism
- Pac-Forge must generate the IO mapping so each device's tags populate the corresponding `udtHMI_*` fields
- Example flow: a user's Motor device with FWD/REV/OVERLOAD signals → Pac-Forge picks `fbMotor_Reversing` → instance exposes `udtHMI_MotorControl` → `fpMotor_Motor_Horizontal` faceplate reads from that UDT

### Phase 5 (Authoring new faceplates) — scope reduced
- Open Library already covers all common device types (analog/digital IO, motors, pumps, valves, VFDs, drives, PID, totalizers, interlocks, permissives)
- Phase 5 is only needed for device types that have no Open Library match — unusual or customer-specific equipment
- Practical impact: maybe 10–20% of projects will need custom faceplates, the rest get them from Open Library
