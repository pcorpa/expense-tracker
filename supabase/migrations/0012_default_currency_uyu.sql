-- Change default currency from 'USD' to 'UY$' to match Uruguayan Peso
alter table transactions alter column currency set default 'UY$';
