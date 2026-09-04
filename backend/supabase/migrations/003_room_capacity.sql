-- Update room capacities and descriptions to match the current rental rate
-- structure (see Room Rental Rate Structure):
--   Conference Room     -> capacity up to 16 people
--   Consultation Room   -> capacity up to 8 people
-- These run as idempotent UPDATEs so they apply to existing live data as well
-- as fresh setups (where the seed still inserts the default values first).

UPDATE rooms
SET capacity = 16,
    description = replace(description, 'up to 10 people', 'up to 16 people')
WHERE slug = 'conference-room';

UPDATE rooms
SET capacity = 8
WHERE slug = 'meeting-room';
