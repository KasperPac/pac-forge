# Agent Pool Architecture (Pac-Forge)
Version: 1.0

## Goal
Support a configurable pool of named agents that can be reserved per session and are exclusive during that session.

This is used to control:
- token usage
- consistent assistant behavior per session
- specialization per role

---

## Concepts

### Agent (logical)
A named profile: “Mia – Siemens”, “Oskar – Safety”, etc.
Has specialties and prompt rules.

### Reservation (lock)
A record that an agent is allocated to a session and cannot be used elsewhere.

---

## Data Model (minimum)

### Agent
- agent_id
- display_name
- specialties: tags (TIA, IO, Safety, Review, Patterns)
- is_enabled
- status: AVAILABLE | RESERVED | OFFLINE | DISABLED
- max_concurrency (default 1)

### Session
- session_id
- user_id
- project_id
- selected_agent_ids[]
- status: ACTIVE | CLOSED | EXPIRED
- created_at
- updated_at

### AgentReservation
- reservation_id
- agent_id
- session_id
- user_id
- reserved_at
- lease_expires_at
- released_at (nullable)
- release_reason: USER_RELEASE | SESSION_END | LEASE_TIMEOUT | ADMIN_FORCE

---

## Locking Rules

### Reserve on session start
- user selects agents
- system attempts to reserve all
- if any agent is reserved, show busy and prevent selection

### Lease-based locking (mandatory)
- Each reservation has a lease (e.g. 30–60 minutes)
- Lease renews on activity (message send/receive)
- If lease expires, reservation auto-releases

### Release conditions
- session end
- timeout/expiry
- user release
- admin force-release

---

## Usage Policy (token control)
Even if multiple agents are reserved:
- a coordinator chooses which agent(s) respond per turn
- default: 1 active responder per user turn unless explicitly requested

---

## UI requirements
- Agent selector at session start
- Display selected agents in session sidebar with status
- Provide release action (optional, admin-configurable)