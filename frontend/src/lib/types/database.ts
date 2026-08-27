export type UserRole = 'admin' | 'client';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
  is_approved: boolean;
  created_at: string;
  updated_at: string;
}

export interface Plan {
  id: string;
  name: string;
  slug: string;
  description: string;
  duration_hours: number;
  duration_label: string;
  price: number;
  features: string[];
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Room {
  id: string;
  name: string;
  slug: string;
  description: string;
  capacity: number;
  price_per_hour: number;
  layout: string;
  floor_plan_url: string | null;
  images: string[];
  amenities: string[];
  equipment: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type BookingStatus = 'pending' | 'approved' | 'paid' | 'completed' | 'cancelled';

export interface Booking {
  id: string;
  room_id: string;
  user_id: string;
  plan_id: string | null;
  date: string;
  start_time: string;
  end_time: string;
  guest_name: string;
  guest_email: string;
  guest_phone: string | null;
  purpose: string | null;
  status: BookingStatus;
  payment_method: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  room?: Room;
  profile?: Profile;
  plan?: Plan;
}

export interface TimeSlot {
  start: string;
  end: string;
  available: boolean;
  booking_id?: string;
}

export interface Review {
  id: string;
  user_id: string;
  room_id: string;
  booking_id: string | null;
  rating: number;
  comment: string | null;
  created_at: string;
  profile?: Profile;
  room?: Room;
}

export type ReportStatus = 'open' | 'in_progress' | 'resolved';

export interface Report {
  id: string;
  user_id: string;
  booking_id: string | null;
  subject: string;
  description: string;
  status: ReportStatus;
  admin_response: string | null;
  created_at: string;
  updated_at: string;
  profile?: Profile;
  booking?: Booking;
}

export type GalleryCategory = 'room' | 'facility' | 'event' | 'general';

export interface GalleryImage {
  id: string;
  title: string;
  description: string | null;
  image_url: string;
  category: GalleryCategory;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface Offer {
  id: string;
  title: string;
  description: string;
  discount_percent: number | null;
  discount_amount: number | null;
  code: string | null;
  starts_at: string | null;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
}
