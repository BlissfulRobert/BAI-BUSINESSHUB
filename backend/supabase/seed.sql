-- Seed data for BAI Business Hub

-- ============================================
-- PLANS
-- ============================================
INSERT INTO plans (name, slug, description, duration_hours, duration_label, price, features, is_active, sort_order)
VALUES
  (
    'Daily Pass',
    'daily',
    'Perfect for a single day of focused work. Access all amenities for one full business day.',
    8,
    '1 Day',
    45.00,
    ARRAY['Full day access (8am-5pm)', 'Conference or Meeting Room', 'WiFi & AV Equipment', 'Coffee & Tea', 'Kitchen Access'],
    true,
    1
  ),
  (
    'Weekly Pass',
    'weekly',
    'Best value for short-term projects. Five consecutive days of unlimited workspace access.',
    40,
    '5 Days',
    180.00,
    ARRAY['5 consecutive days access', 'Priority room booking', 'All Daily Pass perks', 'Dedicated desk area', 'Mail handling'],
    true,
    2
  ),
  (
    'Monthly Pass',
    'monthly',
    'The ultimate plan for professionals. Unlimited access for the entire month with premium perks.',
    176,
    '30 Days',
    550.00,
    ARRAY['Unlimited monthly access', 'Priority room booking', 'All Weekly Pass perks', '24/7 access', 'Guest passes (2/month)', 'Business address'],
    true,
    3
  );

-- ============================================
-- ROOMS
-- ============================================
INSERT INTO rooms (name, slug, description, capacity, price_per_hour, layout, amenities, equipment, is_active)
VALUES (
  'Conference Room',
  'conference-room',
  'Our spacious conference room is perfect for larger meetings, presentations, and board meetings. Features a large boardroom-style table with comfortable seating, state-of-the-art AV equipment, and natural lighting. Ideal for teams of up to 10 people.',
  10,
  75.00,
  'Boardroom',
  ARRAY['Air Conditioning', 'Natural Lighting', 'Whiteboard', 'Flipchart', 'Kitchen Access', 'WiFi', 'Parking'],
  ARRAY['75" 4K Display', 'Video Conferencing System', 'Wireless Screen Sharing', 'Microphone System', 'Speaker System'],
  true
);

INSERT INTO rooms (name, slug, description, capacity, price_per_hour, layout, amenities, equipment, is_active)
VALUES (
  'Meeting Room',
  'meeting-room',
  'A professional meeting room designed for focused discussions and small team collaborations. Perfect for client meetings, interviews, and brainstorming sessions. Features modern decor and essential meeting amenities.',
  4,
  45.00,
  'Rectangular',
  ARRAY['Air Conditioning', 'Whiteboard', 'WiFi', 'Coffee & Tea'],
  ARRAY['55" 4K Display', 'Wireless Screen Sharing', 'Video Conferencing'],
  true
);

-- ============================================
-- GALLERY (room photos use the bundled assets; facility shots are placeholders
-- for the admin to replace with real uploads)
-- ============================================
INSERT INTO gallery (title, description, image_url, category, sort_order, is_active)
VALUES
  ('Conference Room Overview', 'Our premium conference room with boardroom seating for 16', '/office.png', 'room', 1, true),
  ('Meeting Room Interior', 'Modern meeting room with comfortable seating for 8', '/meeting.png', 'room', 2, true),
  ('Hub Entrance', 'Welcome to BAI Business Hub', '/images/placeholder-entrance.jpg', 'facility', 3, true),
  ('Common Area', 'Collaborative common area for networking', '/images/placeholder-common.jpg', 'facility', 4, true),
  ('Kitchen & Break Room', 'Fully equipped kitchen for members', '/images/placeholder-kitchen.jpg', 'facility', 5, true),
  ('Outdoor Terrace', 'Relax and recharge on our outdoor terrace', '/images/placeholder-terrace.jpg', 'facility', 6, true);

-- ============================================
-- OFFERS
-- ============================================
INSERT INTO offers (title, description, discount_percent, code, starts_at, expires_at, is_active)
VALUES
  (
    'New Member Special',
    'Get 20% off your first Monthly Pass when you sign up today!',
    20,
    'WELCOME20',
    NOW(),
    NOW() + INTERVAL '30 days',
    true
  ),
  (
    'Refer a Friend',
    'Refer a colleague and both receive a free Daily Pass!',
    NULL,
    'REFER1FREE',
    NOW(),
    NOW() + INTERVAL '90 days',
    true
  );
