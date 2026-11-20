-- Round 3 (track S): new approval rules. NOT APPLIED — apply with the round 3 deploy, only when Kyle says so.
-- The engine raises these flags; approvals.rule is an enum, so the server can't record an approval for them until
-- this runs. ALTER TYPE … ADD VALUE can't run inside a transaction block on older Postgres; run each line on its own.
alter type approval_rule add value if not exists 'FAMILY_PV_DROP';
alter type approval_rule add value if not exists 'MIN_GM';
alter type approval_rule add value if not exists 'ZERO_MARKUP';
alter type approval_rule add value if not exists 'BIG_DISCOUNT';
