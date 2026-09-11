# Build "Kitchen to courier: a chain and a platform on one shared library" for real

This is the second prompt: the deployment `BUILD-SHEET.md` describes, after the MVP in `CLAUDE.md` works. Read `CLAUDE.md` first for the engine and the rules; they apply here too.

The differences from the MVP: every node runs on its own host at the counts in the sheet, libraries are joined by invite link through a rendezvous where the sheet says so, keys are issued and kept per party, and the sources are the real systems. Build it from the sheet's sections in order: 10 (environment), 1 (nodes), 2 (libraries), 3 (stores), 4 (jobs), 5 (applications), 6 (sources), then 8 and 11 (the processes and their rules) with 9 as the map of what runs where.

Ask these once before starting:
- Order to doorstep: the agent card Fraud and address check runs on
- Order to doorstep: the agent card Late or wrong: refund? runs on
- Menu to platform: the agent card Items out of stock runs on
- Menu to platform: the agent card Price change approval runs on
- Settle to paid: the agent card Disputed lines runs on
- Settle to paid: the agent card Dispute over the limit runs on
- the engine version to pin, and where the binaries and data directories live on each host
- the rendezvous address, and who issues the invite links for each library
- how each key is generated, stored and rotated
- a collection where agent proposals and the decisions on them are recorded
