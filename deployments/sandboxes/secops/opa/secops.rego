package sandbox.secops

default allow = false

allow {
  input.approval_required == true
  input.actor_role == "security_admin"
}
