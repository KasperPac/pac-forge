# TIA Portal LAD Programming Rules
## Ladder Diagram (LAD) Constraints for S7-1200 / S7-1500 in STEP 7 TIA Portal

> Reference document for AI-assisted PLC code generation | IEC 61131-3 compliant

---

## 1. Purpose and Scope

This document defines the structural and syntactic rules that Siemens TIA Portal strictly enforces when compiling Ladder Diagram (LAD) programs for S7-1200 and S7-1500 PLCs. Any generated LAD code that violates these rules will fail to compile in TIA Portal, even if the same code is accepted by other IEC 61131-3 environments such as Sysmac Studio (Omron), Studio 5000 (Rockwell), or CODESYS.

This reference is intended to be loaded into the knowledge base of AI-assisted PLC code generation tools to ensure all generated LAD output is TIA Portal-compliant.

---

## 2. Fundamental LAD Model in TIA Portal

TIA Portal LAD is based on the electrical relay-ladder metaphor. Logic flows strictly from left to right, and from top to bottom. Each program block is divided into independent **Networks** (rungs).

- Power flows **left to right only** — no reverse direction is permitted.
- Each Network is evaluated **independently** — there is no RLO (Result of Logic Operation) carry-over between Networks.
- Networks execute **top to bottom**; elements within a Network execute **left to right**.
- Every Network must have **at least one instruction**.
- Every Network must **terminate with an output element** (coil, box instruction, etc.).

---

## 3. Coil Placement Rules

### 3.1 Coils Must Be at the Right End of a Rung

Standard output coils — Assignment `--( )--`, Set `--(S)--`, Reset `--(R)--` — must always be placed at the **rightmost position** of a rung. They cannot be placed in the middle of a rung in series with contacts or other elements.

> ⚠️ **NOT ALLOWED:** Placing a contact to the right of a coil on the same rung path. TIA Portal will refuse to place the element and will throw a compile error.

### 3.2 No Contacts After a Coil

Once a coil (output element) appears on a rung, the rung must terminate. No contact or other input element may follow a coil on the same horizontal path.

**Correct pattern:**
```
--[ Contact A ]--[ Contact B ]--( Coil )--|
```

**Incorrect pattern (will NOT compile):**
```
--[ Contact A ]--( Coil )--[ Contact B ]--|   ← COMPILE ERROR
```

### 3.3 Multiple Coils on the Same Rung

Multiple coils are permitted on a single rung only if they are placed in **parallel branches** that all terminate at the right rail together. Each coil must be the rightmost element on its respective branch.

```
                     +---------( Coil_A )--|
--[ Contact A ]--+---|
                     +---------( Coil_B )--|
```

> ⚠️ **LOGIC BUG (compiles but is wrong):** Using the same tag address in two separate Assignment coils `--( )--` across different rungs. The last rung executed always wins, overwriting any earlier assignment. Use Set/Reset coils to avoid this.

### 3.4 Set and Reset Coils

Set `--(S)--` and Reset `--(R)--` coils can be used in separate rungs for the same tag without the duplicate coil problem. They only act when RLO = 1 (power flowing). They must still be placed at the **rightmost position** of their rung.

---

## 4. Power Flow Rules

### 4.1 Strictly Left-to-Right

TIA Portal enforces unidirectional power flow. Any network topology that would cause current to flow from right to left — even implicitly through branch connections — is rejected.

> ⚠️ **NOT ALLOWED:** Reverse power flow. Any branch arrangement that would cause power to flow backwards towards the left rail will be rejected at entry or compile time.

### 4.2 No Short-Circuit Branches

A branch that connects directly from the left power rail to the right rail (or to a coil) with no conditions or logic elements in between is a short-circuit and is **not permitted**. Every branch must contain at least one logical element.

> ⚠️ **NOT ALLOWED:** A parallel branch with no contacts (a direct wire bypass). TIA Portal will not allow the placement.

### 4.3 No Feedback / Loopback Branches

Branches that loop back to a point to the left of where they originate are not permitted. All branches must progress from left to right and merge back **downstream** of their split point.

---

## 5. Branch and Parallel Logic Rules

### 5.1 Branch Open and Close Points

Parallel branches (OR logic) are created by opening a branch and closing it at a later point. The close point must be at the **same or further right** horizontal position as the open point. Branches cannot close upstream of the open point.

> ⚠️ **NOT ALLOWED:** Closing a branch to the left of where it opened.

### 5.2 Branches Cannot Close to the Right of a Coil

A parallel branch containing only contacts cannot be closed downstream of a coil. All contact-based branches must merge **before** the coil (output) section of the rung.

```
                     +-[ Contact B ]-+
--[ Contact A ]--+---|               +-( Coil )--|    ← CORRECT: branches merge before coil
                     +---------------+

--[ Contact A ]--( Coil )--+---[ Contact B ]--+--|   ← WRONG: branch after coil
```

### 5.3 Branching After a Box Instruction via ENO

The only valid way to continue logic after a box instruction (FC/FB call, timer, math, etc.) is via its **ENO (Enable Output)** pin. If a box has ENO enabled, contacts can be placed after ENO to conditionally gate further outputs.

```
--[ Contact ]--[ BOX / FC ]--(ENO)--[ Contact C ]--( Coil )--|
```

> ℹ️ **NOTE:** Placing a contact directly after a box instruction without using ENO is NOT permitted. ENO is the correct and only mechanism for post-box logic.

### 5.4 Nesting of Branches

Nested parallel branches are permitted. However, each nested branch must itself obey all branch rules — left-to-right flow, no empty branches, closes before or at the coil section.

---

## 6. Midline Output  `---(#)---`

The Midline Output `---(#)---` writes the current RLO (power flow state) to a bit address mid-rung, without terminating the rung. It captures an intermediate power flow state into a variable while allowing the rung to continue to another output.

### 6.1 Restrictions on Midline Output

> ⚠️ **FORBIDDEN** placements:

| Placement | Rule |
|---|---|
| Connected directly to the left power rail | FORBIDDEN — must have at least one contact before it |
| Placed immediately after a branch open point | FORBIDDEN — cannot be the first element of a branch |
| Placed at the end of a branch | FORBIDDEN — something must follow it on the same path |
| Used as the final/rightmost element of a rung | FORBIDDEN — it is not a terminating output |

**Correct usage:**
```
--[ Contact A ]----(#)----[ Contact B ]--( Coil )--|
                  writes intermediate RLO to a bit, rung continues
```

---

## 7. Rung Termination Rules

Every rung must end with a valid output element. Valid terminating elements are:

- Assignment coil `--( )--`
- Set coil `--(S)--`
- Reset coil `--(R)--`, `--(R=)--`, `--(S=)--`
- A box instruction (timer, counter, math, move, FC/FB call) — the box itself acts as the output
- JUMP instruction `--(JMP)--`
- RETURN instruction `--(RET)--`

> ⚠️ **NOT ALLOWED:**
> - A rung that ends with a contact
> - A rung with no output element at all (compile error)
> - An empty Network (compile error)

---

## 8. Quick Reference: Allowed and Forbidden Patterns

| Pattern | Description | Status |
|---|---|---|
| Contacts before coil | NO/NC contacts in series or parallel, coil at right end | ✅ ALLOWED |
| Multiple coils in parallel | Two or more coils in parallel branches, each rightmost on its branch | ✅ ALLOWED |
| Set/Reset in separate rungs | S and R coils for the same tag in different rungs | ✅ ALLOWED |
| Box via ENO gating contacts | Contacts placed after a box's ENO pin | ✅ ALLOWED |
| Midline output mid-rung | `---(#)---` between contacts with logic on both sides | ✅ ALLOWED |
| Nested parallel branches | Branches within branches, all left-to-right | ✅ ALLOWED |
| Contact after coil | A contact placed to the right of a coil on the same path | ❌ NOT ALLOWED |
| Coil in middle of rung | Coil placed mid-rung with contacts or logic after it | ❌ NOT ALLOWED |
| Reverse power flow | Any branch or connection causing right-to-left current flow | ❌ NOT ALLOWED (compile error) |
| Short-circuit branch | A branch with no logic connecting left rail directly to output | ❌ NOT ALLOWED |
| Branch closing past coil | A contact-only branch closing to the right of a coil | ❌ NOT ALLOWED |
| Rung ending with contact | Last element is a contact, no output element | ❌ NOT ALLOWED (compile error) |
| Empty rung | A network with no instructions at all | ❌ NOT ALLOWED (compile error) |
| Midline output at left rail | `---(#)---` as first element, connected directly to left power rail | 🚫 FORBIDDEN |
| Midline output at branch start | `---(#)---` placed immediately after a branch open | 🚫 FORBIDDEN |
| Midline output at rung end | `---(#)---` as the final/rightmost element of a rung | 🚫 FORBIDDEN |
| Duplicate assignment coils | Same tag in `--( )--` in multiple rungs | ⚠️ COMPILES — LOGIC BUG |

---

## 9. Common Valid Patterns

### 9.1 Seal-in (Latching) Circuit

A seal-in circuit uses a normally open contact of the output coil's own tag in parallel with the start contact:

```
       +--[ Motor_Run ]--+
--+---|                  +--[ Stop NC ]--( Motor_Run )--|
       +--[ Start NO  ]--+
```

The self-holding contact is in the input (left) section. The coil is at the right end.

### 9.2 Multiple Outputs from One Condition

**Option A — Parallel coils at the end of the rung:**
```
                               +-( Output_A )--|
--[ Condition_A ]--[ Cond_B ]--|
                               +-( Output_B )--|
```

**Option B — Separate rungs (preferred for readability):**
```
Network 1:  --[ Condition_A ]--[ Cond_B ]--( Output_A )--|
Network 2:  --[ Condition_A ]--[ Cond_B ]--( Output_B )--|
```

### 9.3 Using a Box Instruction with ENO

```
--[ Enable ]--[ MY_FC (EN) ... (ENO) ]--[ Post_Condition ]--( Result_Coil )--|
```

- Connect enable conditions to the **EN** input on the left.
- If the function executes without error, ENO = 1.
- Contacts after ENO gate the output on successful execution.
- If ENO is not needed, leave it unconnected — the box will still execute.

### 9.4 Midline Output for Intermediate State Capture

```
--[ Cond_A ]--[ Cond_B ]----(# Intermediate_Bit )----[ Cond_C ]--( Final_Output )--|
```

`Intermediate_Bit` is set to the RLO value at that point in the rung, then the rung continues.

---

## 10. Code Generation Checklist

Apply this checklist to every generated rung before output:

- [ ] Does the rung end with a valid output element (coil or box)?
- [ ] Are all contacts placed to the LEFT of all coils?
- [ ] Do all parallel branches flow left to right only?
- [ ] Do all parallel branches contain at least one logical element (no empty/short-circuit branches)?
- [ ] Do all parallel branches close BEFORE (to the left of) any coils?
- [ ] If a Midline Output `---(#)---` is used, does it have logic on both sides?
- [ ] Is the same tag used in more than one Assignment coil `--( )--`? If so, use Set/Reset instead.
- [ ] Are all Networks non-empty and do they all have at least one output element?

---

## Notes

- These rules are enforced by the TIA Portal compiler (STEP 7 V13 and above) for all S7-1200 and S7-1500 targets.
- They apply regardless of TIA Portal version (V13 through V19+).
- They are grounded in the IEC 61131-3 Ladder Diagram standard as implemented by Siemens.
- Other IEC 61131-3 platforms (Sysmac Studio, Studio 5000, CODESYS) may be more permissive — code valid on those platforms is not necessarily valid in TIA Portal.

---

*Siemens SIMATIC TIA Portal | S7-1200 / S7-1500 | LAD Reference | Based on IEC 61131-3*
