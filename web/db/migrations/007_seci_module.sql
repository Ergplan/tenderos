-- Saved bids from the SECI RTC tender tab (particulars, blanks, letters and their edits, the
-- sizing) use module 'seci'.
ALTER TABLE scenarios DROP CONSTRAINT IF EXISTS scenarios_module_check;
ALTER TABLE scenarios ADD CONSTRAINT scenarios_module_check CHECK (module IN ('rtc', 'fdre', 'bess', 'seci'));
