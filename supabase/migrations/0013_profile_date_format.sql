-- Add date format preference to profiles (DD/MM/YYYY default for Uruguay)
alter table profiles
  add column if not exists date_format text not null default 'DD/MM/YYYY'
    check (date_format in ('DD/MM/YYYY', 'MM/DD/YYYY'));
