# Triage Labels

Five canonical triage roles:

| Label | Meaning |
|-------|---------|
| `needs-triage` | Newly created, not yet assessed |
| `needs-info` | Blocked on missing information from human |
| `ready-for-agent` | Unblocked, agent can pick it up |
| `ready-for-human` | Requires human decision or action |
| `wontfix` | Intentionally not addressed |

Use `bd update <id> --label <label>` to apply.
