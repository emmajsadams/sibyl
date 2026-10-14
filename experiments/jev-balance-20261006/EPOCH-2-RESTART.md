# Authorized homogeneous policy epoch 2 restart

User explicitly approved 32 replacement extra games and a fresh finite 12-hour active operational window, completing cycles 2–10 of the authorized 10×50 experiment. Migration is one-time and recorded in `policy-epoch-2.json`; original `startedAt` remains intact.

- Cycle 1's 50 discovery / 32 evaluation games and rejected Medic maxHp 5→6 remain unchanged.
- Old cycle 2's frozen manifest and halt report moved byte-for-byte to `archive-cycle-02-policy-1/`. Its 32 clean games plus failed attempt 116 stay in the checkpoint with archive/epoch annotations, excluded from discovery slot satisfaction and designer evidence. Raw requests/journals/results remain private and unchanged.
- All 116 historical attempts / 18,615 decisions and the failure streak of 1 remain accounted. No global attempt or per-game decision/retry/consecutive-failure cap increases. Evaluation is held if insufficient budget remains to reserve discovery.
- New cycle 2 freezes fresh fixtures and the complete current source hash. Subsequent cycles freeze their own current sources; old-policy manifests are never admitted through the operational compatibility exception. Original operational migration is untouched.
- Active window is exactly 12 hours; match and designer budgets use its absolute deadline. Resume cannot refresh it. Deadline exhaustion halts; continuation needs a new explicitly scoped authorization, never fabricated evidence.
- Designer login was checked offline (ChatGPT authenticated). Existing PTY read-only/schema path, one invocation per cycle, ten-minute bound, and stop-on-auth/schema/error handling remain. No paid designer call was made for auth validation.
- RED observed for finite-window support and archived-evidence exclusion; GREEN: formatter, lint, typecheck, 248 source tests / zero failures in disposable verification copy.
- Credential file existence and mode 0600 checked only; values never displayed or sourced. Only match workers read it.

Runner publishes sanitized completed cycle reports and accepted numeric configurations directly to main with explicit file allowlists and fresh remote HEAD verification. Private raw logs and legacy 100-game logs/training versions are not staged.
