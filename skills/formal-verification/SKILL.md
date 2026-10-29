---
name: formal-verification
description: Check BotDoor's session lifecycle with the project statechart before changing connect, arm, expiry, Owner control, input, STOP, or disconnect. Use when editing the relay session, host controller grants, or phone operator handoff.
---

# BotDoor formal verification

The lifecycle is a statechart, not a pile of flags. `formal/botdoor-lifecycle.mjs` is the model CI runs. `formal/BotDoorLifecycle.tla` is the same safety spec for TLC. Update both when a transition changes, then check them. Do not weaken STOP, expiry, target checks, Owner control, or an existing refusal to make a run pass.

## Check

```bash
node --test test/lifecycle-model.test.mjs
java -jar tla2tools.jar -workers 1 -config formal/BotDoorLifecycle.cfg formal/BotDoorLifecycle.tla
```

`tla2tools.jar` is the TLA+ tools release (TLC). Run it from the repo root. A good run prints no invariant violation. The node test must pass in `npm test`.

Confirm the checker still rejects the known bad transitions: an operator switch that raises the grant cap, a host ack whose operator does not match, editing input while Owner control is on, and a local STOP that leaves the session armed. Those live in `explore({ extendOnSwitch, acceptBadAck, allowOwnerInput, ignoreLocalStop })`.

## States

- **disconnected** — host link down, mode off, no handoff
- **authenticated-off** — host up, mode off, stop latch clear
- **arming** — grant or operator change waiting for the host ack
- **live-bot** — armed, phone and host agree the bot is the operator
- **live-owner** — armed, phone and host agree the owner is the operator
- **handoff-waiting** — owner-control handoff, same deadline, operator owner
- **paused** — pause cleared the grant and the schedule
- **stop-latched** — local STOP, off until the PC clears the latch
- **expired** — the clock reached the grant and live state was cleared

`running` is the armed session with a command lease. The lease cannot pass the grant deadline.

## Transitions that must stay true

- Connect does not arm. Disconnect clears live mode, the operator, and any handoff. A saved schedule may resume only until its original end.
- GO LIVE is the explicit new grant. Take control, return to bot, and handoff completion while a grant is live cannot move that deadline later.
- The host ack must repeat the requested operator, mode, generation, and deadline. A mismatch forces OFF.
- `request_owner` only transfers a live owner-control grant. Completing it requires that handoff id. STOP, expiry, and disconnect clear it.
- Bot clicks, typing, drag, editing keys, and clipboard writes are refused in owner-control access. Every bot input except status, STOP, and recording stop is refused while the phone operator is owner.
- Remote STOP and local STOP reach off from every state, clear the handoff and the schedule, and do not leave a grant. Local STOP also latches.

## When the code changes

1. Name the state and the transition in both models.
2. Add a relay or host test that fails if the transition extends a deadline, skips the operator ack, accepts forbidden input, or skips STOP.
3. Re-run the node checker and TLC before committing.
