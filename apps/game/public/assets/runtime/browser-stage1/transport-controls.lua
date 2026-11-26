-- Native pause state only. Never let a host-level resume bypass the original choice.
function choiceSessionPause()
  assert(started and not capturedResult and not active,"manual pause unavailable")
  return localAuditPause()
end
function choiceSessionResume()
  assert(started and not capturedResult and not active,"manual resume unavailable while original upgrade is active")
  return localAuditResume()
end
