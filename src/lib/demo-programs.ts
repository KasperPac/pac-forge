/**
 * Preset demo programs for the TIA Console quick-start feature.
 * Each demo is a complete TIA Portal project with SCL sources
 * that can be imported directly via the bridge.
 */

export interface DemoProgram {
  id: string;
  name: string;
  description: string;
  sources: Record<string, string>;
  importOrder: string[];
}

export const DEMO_PROGRAMS: DemoProgram[] = [
  // --- Traffic Light ---
  {
    id: "traffic-light",
    name: "Traffic Light Controller",
    description:
      "3-state traffic light (Red/Yellow/Green) with configurable timer transitions. Demonstrates CASE-based state machines and IEC timers.",
    sources: {
      UDT_TrafficLight: `TYPE "UDT_TrafficLight"
VERSION : 0.1
   STRUCT
      Red : Bool;
      Yellow : Bool;
      Green : Bool;
      State : Int;
      Enable : Bool;
   END_STRUCT;
END_TYPE
`,
      FB_TrafficLight: `FUNCTION_BLOCK "FB_TrafficLight"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
VAR_INPUT
   i_Enable : Bool;
   i_Reset : Bool;
   i_RedTime : Time := T#10s;
   i_YellowTime : Time := T#3s;
   i_GreenTime : Time := T#8s;
END_VAR
VAR_OUTPUT
   o_Red : Bool;
   o_Yellow : Bool;
   o_Green : Bool;
END_VAR
VAR
   state : Int;  // 0=Off, 1=Red, 2=RedYellow, 3=Green, 4=Yellow
   tmrPhase : TON;
   phaseElapsed : Bool;
END_VAR
BEGIN
    // Timer for current phase
    #tmrPhase(IN := #i_Enable AND NOT #i_Reset, PT := T#0s);
    #phaseElapsed := #tmrPhase.Q;

    IF #i_Reset OR NOT #i_Enable THEN
        #state := 0;
    END_IF;

    CASE #state OF
        0:  // Off
            #o_Red := FALSE;
            #o_Yellow := FALSE;
            #o_Green := FALSE;
            IF #i_Enable AND NOT #i_Reset THEN
                #state := 1;
                #tmrPhase(IN := FALSE, PT := T#0s);
                #tmrPhase(IN := TRUE, PT := #i_RedTime);
            END_IF;

        1:  // Red
            #o_Red := TRUE;
            #o_Yellow := FALSE;
            #o_Green := FALSE;
            #tmrPhase(IN := TRUE, PT := #i_RedTime);
            IF #phaseElapsed THEN
                #state := 2;
                #tmrPhase(IN := FALSE, PT := T#0s);
                #tmrPhase(IN := TRUE, PT := #i_YellowTime);
            END_IF;

        2:  // Red+Yellow (transition)
            #o_Red := TRUE;
            #o_Yellow := TRUE;
            #o_Green := FALSE;
            #tmrPhase(IN := TRUE, PT := #i_YellowTime);
            IF #phaseElapsed THEN
                #state := 3;
                #tmrPhase(IN := FALSE, PT := T#0s);
                #tmrPhase(IN := TRUE, PT := #i_GreenTime);
            END_IF;

        3:  // Green
            #o_Red := FALSE;
            #o_Yellow := FALSE;
            #o_Green := TRUE;
            #tmrPhase(IN := TRUE, PT := #i_GreenTime);
            IF #phaseElapsed THEN
                #state := 4;
                #tmrPhase(IN := FALSE, PT := T#0s);
                #tmrPhase(IN := TRUE, PT := #i_YellowTime);
            END_IF;

        4:  // Yellow
            #o_Red := FALSE;
            #o_Yellow := TRUE;
            #o_Green := FALSE;
            #tmrPhase(IN := TRUE, PT := #i_YellowTime);
            IF #phaseElapsed THEN
                #state := 1;
                #tmrPhase(IN := FALSE, PT := T#0s);
                #tmrPhase(IN := TRUE, PT := #i_RedTime);
            END_IF;

        ELSE
            #state := 0;
    END_CASE;
END_FUNCTION_BLOCK
`,
      Main: `ORGANIZATION_BLOCK "Main"
TITLE = 'Main Program Sweep'
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
VAR
   TrafficLight_1 : "FB_TrafficLight";
   TL1_Red : Bool;
   TL1_Yellow : Bool;
   TL1_Green : Bool;
END_VAR
VAR_TEMP
   tempInt : Int;
END_VAR
BEGIN
    #TrafficLight_1(i_Enable := TRUE,
                    i_Reset := FALSE,
                    i_RedTime := T#10s,
                    i_YellowTime := T#3s,
                    i_GreenTime := T#8s,
                    o_Red => #TL1_Red,
                    o_Yellow => #TL1_Yellow,
                    o_Green => #TL1_Green);
END_ORGANIZATION_BLOCK
`,
    },
    importOrder: ["UDT_TrafficLight", "FB_TrafficLight", "Main"],
  },

  // --- Tank Level Control ---
  {
    id: "tank-level",
    name: "Tank Level Control",
    description:
      "Fill/drain tank with high/low level sensors, inlet and outlet valves. Demonstrates analog level simulation and hysteresis control.",
    sources: {
      UDT_Tank: `TYPE "UDT_Tank"
VERSION : 0.1
   STRUCT
      LevelPercent : Real;
      HighLevel : Bool;
      LowLevel : Bool;
      InletOpen : Bool;
      OutletOpen : Bool;
      OverflowAlarm : Bool;
   END_STRUCT;
END_TYPE
`,
      FB_TankControl: `FUNCTION_BLOCK "FB_TankControl"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
VAR_INPUT
   i_Enable : Bool;
   i_LevelSensor : Real;    // 0.0 to 100.0 %
   i_HighSetpoint : Real := 80.0;
   i_LowSetpoint : Real := 20.0;
   i_OverflowLimit : Real := 95.0;
END_VAR
VAR_OUTPUT
   o_InletValve : Bool;
   o_OutletValve : Bool;
   o_HighLevel : Bool;
   o_LowLevel : Bool;
   o_OverflowAlarm : Bool;
END_VAR
VAR
   state : Int;  // 0=Idle, 1=Filling, 2=Full, 3=Draining
   simLevel : Real;
END_VAR
BEGIN
    #o_HighLevel := #i_LevelSensor >= #i_HighSetpoint;
    #o_LowLevel := #i_LevelSensor <= #i_LowSetpoint;
    #o_OverflowAlarm := #i_LevelSensor >= #i_OverflowLimit;

    IF NOT #i_Enable THEN
        #o_InletValve := FALSE;
        #o_OutletValve := FALSE;
        #state := 0;
    END_IF;

    CASE #state OF
        0:  // Idle - start filling if enabled and level is low
            #o_InletValve := FALSE;
            #o_OutletValve := FALSE;
            IF #i_Enable AND #o_LowLevel THEN
                #state := 1;
            ELSIF #i_Enable AND NOT #o_LowLevel AND NOT #o_HighLevel THEN
                #state := 1;
            END_IF;

        1:  // Filling
            #o_InletValve := TRUE;
            #o_OutletValve := FALSE;
            IF #o_HighLevel THEN
                #state := 2;
            END_IF;
            IF #o_OverflowAlarm THEN
                #o_InletValve := FALSE;
                #state := 3;
            END_IF;

        2:  // Full - hold, then start draining
            #o_InletValve := FALSE;
            #o_OutletValve := TRUE;
            #state := 3;

        3:  // Draining
            #o_InletValve := FALSE;
            #o_OutletValve := TRUE;
            IF #o_LowLevel THEN
                #state := 1;
            END_IF;

        ELSE
            #state := 0;
    END_CASE;
END_FUNCTION_BLOCK
`,
      Main: `ORGANIZATION_BLOCK "Main"
TITLE = 'Main Program Sweep'
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
VAR
   Tank_1 : "FB_TankControl";
   Tank_1_Inlet : Bool;
   Tank_1_Outlet : Bool;
   Tank_1_SimLevel : Real := 15.0;
END_VAR
VAR_TEMP
   tempInt : Int;
END_VAR
BEGIN
    #Tank_1(i_Enable := TRUE,
            i_LevelSensor := #Tank_1_SimLevel,
            i_HighSetpoint := 80.0,
            i_LowSetpoint := 20.0,
            o_InletValve => #Tank_1_Inlet,
            o_OutletValve => #Tank_1_Outlet);
END_ORGANIZATION_BLOCK
`,
    },
    importOrder: ["UDT_Tank", "FB_TankControl", "Main"],
  },

  // --- Conveyor Sorting ---
  {
    id: "conveyor-sorting",
    name: "Conveyor Sorting System",
    description:
      "Belt conveyor with 2 diverters triggered by part sensors. Demonstrates sequential logic with sensor-based branching.",
    sources: {
      FB_ConveyorSort: `FUNCTION_BLOCK "FB_ConveyorSort"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
VAR_INPUT
   i_Enable : Bool;
   i_Reset : Bool;
   i_SensorEntry : Bool;     // Part detected at entry
   i_SensorTypeA : Bool;     // Type A detector
   i_SensorTypeB : Bool;     // Type B detector
END_VAR
VAR_OUTPUT
   o_BeltRun : Bool;
   o_DiverterA : Bool;       // Activate diverter for type A
   o_DiverterB : Bool;       // Activate diverter for type B
   o_CountA : Int;
   o_CountB : Int;
   o_CountReject : Int;
END_VAR
VAR
   state : Int;  // 0=Idle, 1=Running, 2=DivertA, 3=DivertB
   tmrDivert : TON;
   prevEntry : Bool;
   entryRise : Bool;
END_VAR
BEGIN
    // Edge detection on entry sensor
    #entryRise := #i_SensorEntry AND NOT #prevEntry;
    #prevEntry := #i_SensorEntry;

    IF #i_Reset THEN
        #o_CountA := 0;
        #o_CountB := 0;
        #o_CountReject := 0;
        #state := 0;
    END_IF;

    #tmrDivert(IN := (#state = 2 OR #state = 3), PT := T#2s);

    CASE #state OF
        0:  // Idle
            #o_BeltRun := FALSE;
            #o_DiverterA := FALSE;
            #o_DiverterB := FALSE;
            IF #i_Enable THEN
                #state := 1;
            END_IF;

        1:  // Running - belt on, waiting for parts
            #o_BeltRun := #i_Enable;
            #o_DiverterA := FALSE;
            #o_DiverterB := FALSE;
            IF NOT #i_Enable THEN
                #state := 0;
            ELSIF #entryRise THEN
                IF #i_SensorTypeA THEN
                    #state := 2;
                    #o_CountA := #o_CountA + 1;
                    #tmrDivert(IN := FALSE, PT := T#0s);
                ELSIF #i_SensorTypeB THEN
                    #state := 3;
                    #o_CountB := #o_CountB + 1;
                    #tmrDivert(IN := FALSE, PT := T#0s);
                ELSE
                    #o_CountReject := #o_CountReject + 1;
                END_IF;
            END_IF;

        2:  // Diverting type A
            #o_BeltRun := TRUE;
            #o_DiverterA := TRUE;
            #o_DiverterB := FALSE;
            #tmrDivert(IN := TRUE, PT := T#2s);
            IF #tmrDivert.Q THEN
                #state := 1;
            END_IF;

        3:  // Diverting type B
            #o_BeltRun := TRUE;
            #o_DiverterA := FALSE;
            #o_DiverterB := TRUE;
            #tmrDivert(IN := TRUE, PT := T#2s);
            IF #tmrDivert.Q THEN
                #state := 1;
            END_IF;

        ELSE
            #state := 0;
    END_CASE;
END_FUNCTION_BLOCK
`,
      Main: `ORGANIZATION_BLOCK "Main"
TITLE = 'Main Program Sweep'
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
VAR
   Conveyor_1 : "FB_ConveyorSort";
   Conv1_Belt : Bool;
   Conv1_DivA : Bool;
   Conv1_DivB : Bool;
   Conv1_CountA : Int;
   Conv1_CountB : Int;
END_VAR
VAR_TEMP
   tempInt : Int;
END_VAR
BEGIN
    #Conveyor_1(i_Enable := TRUE,
                i_Reset := FALSE,
                i_SensorEntry := FALSE,
                i_SensorTypeA := FALSE,
                i_SensorTypeB := FALSE,
                o_BeltRun => #Conv1_Belt,
                o_DiverterA => #Conv1_DivA,
                o_DiverterB => #Conv1_DivB,
                o_CountA => #Conv1_CountA,
                o_CountB => #Conv1_CountB);
END_ORGANIZATION_BLOCK
`,
    },
    importOrder: ["FB_ConveyorSort", "Main"],
  },

  // --- Star-Delta Starter ---
  {
    id: "star-delta",
    name: "Star-Delta Motor Starter",
    description:
      "Classic star-delta motor start sequence with configurable changeover timer and interlock logic. Demonstrates safe motor starting patterns.",
    sources: {
      FB_StarDelta: `FUNCTION_BLOCK "FB_StarDelta"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
VAR_INPUT
   i_Start : Bool;
   i_Stop : Bool;
   i_ThermalTrip : Bool;     // Overload relay
   i_Reset : Bool;
   i_ChangeoverTime : Time := T#5s;
END_VAR
VAR_OUTPUT
   o_MainContactor : Bool;    // K1 - Line contactor
   o_StarContactor : Bool;    // K2 - Star contactor
   o_DeltaContactor : Bool;   // K3 - Delta contactor
   o_Running : Bool;
   o_Fault : Bool;
END_VAR
VAR
   state : Int;  // 0=Stopped, 1=StarStart, 2=Changeover, 3=DeltaRun, 4=Fault
   tmrChangeover : TON;
   tmrPause : TON;
END_VAR
BEGIN
    // Safety: stop on thermal trip
    IF #i_ThermalTrip THEN
        #state := 4;
    END_IF;

    IF #i_Stop AND #state <> 4 THEN
        #state := 0;
    END_IF;

    #tmrChangeover(IN := (#state = 1), PT := #i_ChangeoverTime);
    #tmrPause(IN := (#state = 2), PT := T#50ms);

    CASE #state OF
        0:  // Stopped
            #o_MainContactor := FALSE;
            #o_StarContactor := FALSE;
            #o_DeltaContactor := FALSE;
            #o_Running := FALSE;
            #o_Fault := FALSE;
            IF #i_Start AND NOT #i_Stop AND NOT #i_ThermalTrip THEN
                #state := 1;
                #tmrChangeover(IN := FALSE, PT := T#0s);
            END_IF;

        1:  // Star start
            #o_MainContactor := TRUE;
            #o_StarContactor := TRUE;
            #o_DeltaContactor := FALSE;
            #o_Running := TRUE;
            #tmrChangeover(IN := TRUE, PT := #i_ChangeoverTime);
            IF #tmrChangeover.Q THEN
                #state := 2;
                #tmrPause(IN := FALSE, PT := T#0s);
            END_IF;

        2:  // Changeover pause (star off before delta on)
            #o_MainContactor := TRUE;
            #o_StarContactor := FALSE;
            #o_DeltaContactor := FALSE;
            #o_Running := TRUE;
            #tmrPause(IN := TRUE, PT := T#50ms);
            IF #tmrPause.Q THEN
                #state := 3;
            END_IF;

        3:  // Delta run
            #o_MainContactor := TRUE;
            #o_StarContactor := FALSE;
            #o_DeltaContactor := TRUE;
            #o_Running := TRUE;

        4:  // Fault
            #o_MainContactor := FALSE;
            #o_StarContactor := FALSE;
            #o_DeltaContactor := FALSE;
            #o_Running := FALSE;
            #o_Fault := TRUE;
            IF #i_Reset AND NOT #i_ThermalTrip THEN
                #o_Fault := FALSE;
                #state := 0;
            END_IF;

        ELSE
            #state := 0;
    END_CASE;
END_FUNCTION_BLOCK
`,
      Main: `ORGANIZATION_BLOCK "Main"
TITLE = 'Main Program Sweep'
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
VAR
   Motor_1 : "FB_StarDelta";
   M1_MainK : Bool;
   M1_StarK : Bool;
   M1_DeltaK : Bool;
   M1_Running : Bool;
   M1_Fault : Bool;
END_VAR
VAR_TEMP
   tempInt : Int;
END_VAR
BEGIN
    #Motor_1(i_Start := FALSE,
             i_Stop := FALSE,
             i_ThermalTrip := FALSE,
             i_Reset := FALSE,
             i_ChangeoverTime := T#5s,
             o_MainContactor => #M1_MainK,
             o_StarContactor => #M1_StarK,
             o_DeltaContactor => #M1_DeltaK,
             o_Running => #M1_Running,
             o_Fault => #M1_Fault);
END_ORGANIZATION_BLOCK
`,
    },
    importOrder: ["FB_StarDelta", "Main"],
  },
];

/**
 * Pick a random demo program from the pool.
 */
export function getRandomDemo(): DemoProgram {
  return DEMO_PROGRAMS[Math.floor(Math.random() * DEMO_PROGRAMS.length)];
}
