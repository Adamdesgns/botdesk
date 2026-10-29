------------------------------ MODULE BotDoorLifecycle ------------------------------
\* Safety spec for the BotDoor session lifecycle. The executable twin is
\* formal/botdoor-lifecycle.mjs. Both must agree on these invariants:
\* a live grant has a deadline and cannot outlive its cap; phone and host
\* operators agree; local STOP leaves the session off; disconnect is not live;
\* a waiting handoff is an owner session; editing input is not accepted while
\* Owner control (operator or access mode) is on.
EXTENDS Integers

CONSTANTS MAX, Extend, BadAck, BadInput

VARIABLES link, mode, operator, hostOp, access, stopped, handoff, phase,
          clock, grantEnd, grantCap, proposedEnd, proposedCap, requestedOp,
          intent, fault

vars == <<link, mode, operator, hostOp, access, stopped, handoff, phase,
          clock, grantEnd, grantCap, proposedEnd, proposedCap, requestedOp,
          intent, fault>>

Min(a, b) == IF a < b THEN a ELSE b

Init ==
  /\ link = "down" /\ mode = "off" /\ operator = "bot" /\ hostOp = "bot"
  /\ access = "window" /\ stopped = FALSE /\ handoff = "none" /\ phase = "idle"
  /\ clock = 0 /\ grantEnd = 0 /\ grantCap = 0
  /\ proposedEnd = 0 /\ proposedCap = 0 /\ requestedOp = "bot"
  /\ intent = "none" /\ fault = FALSE

Off(keep, nextMode) ==
  /\ mode' = nextMode /\ operator' = "bot" /\ hostOp' = "bot"
  /\ handoff' = "none" /\ phase' = "idle" /\ grantEnd' = 0
  /\ proposedEnd' = 0 /\ proposedCap' = 0 /\ requestedOp' = "bot"
  /\ intent' = "none" /\ fault' = fault
  /\ link' = keep.link /\ access' = keep.access /\ clock' = keep.clock
  /\ stopped' = keep.stopped /\ grantCap' = 0

Connect ==
  /\ link = "down" /\ link' = "up"
  /\ UNCHANGED <<mode, operator, hostOp, access, stopped, handoff, phase,
                 clock, grantEnd, grantCap, proposedEnd, proposedCap,
                 requestedOp, intent, fault>>

Disconnect ==
  /\ link = "up"
  /\ Off([link |-> "down", access |-> access, clock |-> clock, stopped |-> stopped], "off")

Tick ==
  /\ clock < MAX
  /\ LET next == clock + 1
         over == (mode = "armed" /\ grantEnd > 0 /\ next >= grantEnd)
                 \/ (phase = "arming" /\ proposedEnd > 0 /\ next >= proposedEnd)
     IN IF over
        THEN /\ Off([link |-> link, access |-> access, clock |-> next, stopped |-> stopped], "off")
        ELSE /\ clock' = next
             /\ UNCHANGED <<link, mode, operator, hostOp, access, stopped, handoff,
                            phase, grantEnd, grantCap, proposedEnd, proposedCap,
                            requestedOp, intent, fault>>

Stop ==
  /\ Off([link |-> link, access |-> access, clock |-> clock, stopped |-> stopped], "off")

LocalStop ==
  /\ Off([link |-> link, access |-> access, clock |-> clock, stopped |-> TRUE], "off")

ClearLatch ==
  /\ stopped /\ mode = "off" /\ phase = "idle" /\ stopped' = FALSE
  /\ UNCHANGED <<link, mode, operator, hostOp, access, handoff, phase, clock,
                 grantEnd, grantCap, proposedEnd, proposedCap, requestedOp, intent, fault>>

SetAccess(next) ==
  /\ link = "up" /\ mode = "off" /\ phase = "idle" /\ ~stopped
  /\ access' = next
  /\ UNCHANGED <<link, mode, operator, hostOp, stopped, handoff, phase, clock,
                 grantEnd, grantCap, proposedEnd, proposedCap, requestedOp, intent, fault>>

GoLive(span) ==
  /\ link = "up" /\ ~stopped /\ phase = "idle" /\ mode \in {"off", "armed", "paused"}
  /\ (mode # "armed" \/ span = 4)
  /\ LET end == Min(MAX, clock + span) IN
       /\ end > clock
       /\ phase' = "arming" /\ intent' = "live" /\ requestedOp' = "bot"
       /\ proposedEnd' = end /\ proposedCap' = end
  /\ UNCHANGED <<link, mode, operator, hostOp, access, stopped, handoff, clock,
                 grantEnd, grantCap, fault>>

Switch(op) ==
  /\ link = "up" /\ ~stopped /\ phase = "idle" /\ mode = "armed"
  /\ op = "bot" \/ access = "owner"
  /\ LET end == IF Extend THEN Min(MAX, clock + 4) ELSE grantEnd IN
       /\ end > clock
       /\ proposedEnd' = end /\ proposedCap' = grantCap
       /\ phase' = "arming" /\ intent' = "switch" /\ requestedOp' = op
  /\ UNCHANGED <<link, mode, operator, hostOp, access, stopped, handoff, clock,
                 grantEnd, grantCap, fault>>

TakeControl ==
  /\ link = "up" /\ ~stopped /\ phase = "idle" /\ mode \in {"off", "paused"}
  /\ access = "owner"
  /\ LET end == Min(MAX, clock + 4) IN
       /\ end > clock
       /\ phase' = "arming" /\ intent' = "switch" /\ requestedOp' = "owner"
       /\ proposedEnd' = end /\ proposedCap' = end
  /\ UNCHANGED <<link, mode, operator, hostOp, access, stopped, handoff, clock,
                 grantEnd, grantCap, fault>>

RequestHandoff ==
  /\ mode = "armed" /\ phase = "idle" /\ access = "owner" /\ operator = "bot"
  /\ handoff = "none" /\ link = "up" /\ ~stopped
  /\ phase' = "arming" /\ intent' = "handoff" /\ requestedOp' = "owner"
  /\ proposedEnd' = grantEnd /\ proposedCap' = grantCap
  /\ UNCHANGED <<link, mode, operator, hostOp, access, stopped, handoff, clock,
                 grantEnd, grantCap, fault>>

CompleteHandoff ==
  /\ handoff = "waiting" /\ mode = "armed" /\ phase = "idle" /\ link = "up"
  /\ phase' = "arming" /\ intent' = "handoff" /\ requestedOp' = "bot"
  /\ proposedEnd' = grantEnd /\ proposedCap' = grantCap
  /\ UNCHANGED <<link, mode, operator, hostOp, access, stopped, handoff, clock,
                 grantEnd, grantCap, fault>>

Ack(claimed) ==
  /\ phase = "arming" /\ link = "up"
  /\ \/ /\ claimed = requestedOp
        /\ mode' = "armed" /\ operator' = requestedOp /\ hostOp' = claimed
        /\ grantEnd' = proposedEnd /\ grantCap' = proposedCap /\ phase' = "idle"
        /\ handoff' = IF intent = "handoff" THEN IF requestedOp = "owner" THEN "waiting" ELSE "done" ELSE "none"
        /\ intent' = "none" /\ fault' = fault
        /\ UNCHANGED <<link, access, stopped, clock, proposedEnd, proposedCap, requestedOp>>
     \/ /\ claimed # requestedOp
        /\ IF BadAck
           THEN /\ mode' = "armed" /\ operator' = requestedOp /\ hostOp' = claimed
                /\ grantEnd' = proposedEnd /\ grantCap' = proposedCap
                /\ phase' = "idle" /\ intent' = "none" /\ fault' = TRUE
                /\ handoff' = "none"
                /\ UNCHANGED <<link, access, stopped, clock, proposedEnd, proposedCap, requestedOp>>
           ELSE Off([link |-> link, access |-> access, clock |-> clock, stopped |-> stopped], "off")

BotClick ==
  /\ mode = "armed" /\ phase = "idle" /\ link = "up" /\ ~stopped
  /\ IF (operator = "owner" \/ access = "owner") /\ BadInput
     THEN /\ fault' = TRUE
          /\ UNCHANGED <<link, mode, operator, hostOp, access, stopped, handoff,
                         phase, clock, grantEnd, grantCap, proposedEnd, proposedCap,
                         requestedOp, intent>>
     ELSE /\ ~ (operator = "owner" \/ access = "owner")
          /\ UNCHANGED vars

Pause ==
  /\ mode = "armed" /\ phase = "idle" /\ link = "up"
  /\ Off([link |-> link, access |-> access, clock |-> clock, stopped |-> stopped], "paused")

Next ==
  \/ Connect \/ Disconnect \/ Tick \/ Stop \/ LocalStop \/ ClearLatch \/ Pause
  \/ SetAccess("owner") \/ SetAccess("window")
  \/ GoLive(2) \/ GoLive(4) \/ TakeControl
  \/ Switch("bot") \/ Switch("owner")
  \/ RequestHandoff \/ CompleteHandoff
  \/ Ack("bot") \/ Ack("owner")
  \/ BotClick

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ link \in {"down", "up"} /\ mode \in {"off", "armed", "paused"}
  /\ operator \in {"bot", "owner"} /\ hostOp \in {"bot", "owner"}
  /\ access \in {"window", "owner"} /\ handoff \in {"none", "waiting", "done"}
  /\ phase \in {"idle", "arming"} /\ intent \in {"none", "live", "switch", "handoff"}
  /\ requestedOp \in {"bot", "owner"} /\ stopped \in BOOLEAN /\ fault \in BOOLEAN
  /\ clock \in 0..MAX /\ grantEnd \in 0..MAX /\ grantCap \in 0..MAX
  /\ proposedEnd \in 0..MAX /\ proposedCap \in 0..MAX

Safety ==
  /\ fault = FALSE
  /\ mode = "armed" => grantEnd > clock /\ grantEnd <= grantCap /\ (phase = "idle" => operator = hostOp)
  /\ stopped => mode = "off"
  /\ link = "down" => mode = "off" /\ handoff = "none" /\ phase = "idle"
  /\ handoff = "waiting" => operator = "owner" /\ mode = "armed" /\ link = "up"
====================================================================================
