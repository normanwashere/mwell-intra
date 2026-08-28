-- August 27 allocation feedback: Marketing may reserve event stock.
-- Keep issue, return custody, quality release, and approval grants unchanged.
insert into core.role_capabilities (module, role, cap)
values ('warehouse', 'marketing', 'reserve_allocate')
on conflict (module, role, cap) do nothing;
