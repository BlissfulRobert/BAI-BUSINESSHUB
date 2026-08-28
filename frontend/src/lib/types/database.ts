// Types mirror the Supabase schema in Schema.md.

export interface Room {
	id: string;
	slug: string;
	name: string;
	description: string;
	capacity: number;
	price_per_hour: number;
	layout: string;
	floor_plan_url: string | null;
	images: string[];
	amenities: string[]; // e.g. ['CR', 'Tables', 'Chairs']
	equipment: string[];
	is_active: boolean;
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
}

export type BookingStatus = 'pending' | 'approved' | 'paid' | 'completed' | 'cancelled';
export type PaymentMethod = 'onsite';

export interface Booking {
	id: string;
	room_id: string;
	user_id: string;
	plan_id: string | null;
	date: string; // ISO date, e.g. '2026-08-27'
	start_time: string; // 'HH:MM:SS'
	end_time: string; // 'HH:MM:SS'
	guest_name: string;
	guest_email: string;
	guest_phone: string | null;
	purpose: string | null;
	status: BookingStatus;
	payment_method: PaymentMethod;
	notes: string | null;
	created_at: string;
	updated_at: string;
	// Relations populated by Supabase joins (e.g. `*, room:rooms(*), profile:profiles(*)`).
	room?: Room;
	profile?: { full_name: string; email: string };
}

export interface Profile {
	id: string;
	email: string;
	full_name: string;
	phone: string | null;
	role: 'admin' | 'client';
	is_approved: boolean;
	created_at: string;
}

export interface GalleryImage {
	id: string;
	title: string;
	description: string | null;
	image_url: string;
	category: 'room' | 'facility' | 'event' | 'general';
	sort_order: number;
	is_active: boolean;
	created_at: string;
}

export interface Review {
	id: string;
	user_id: string;
	room_id: string;
	booking_id: string | null;
	rating: number;
	comment: string | null;
	created_at: string;
	// Relations populated by Supabase joins.
	room?: { name: string };
	profile?: { full_name: string };
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
	// Relation populated by Supabase join.
	profile?: { full_name: string; email: string };
}

// Shape used only on the client while building a booking request
export interface BookingDraft {
	room_id: string;
	plan_id: string;
	date: string;
	start_time: string;
	end_time: string;
	guest_name: string;
	guest_email: string;
	guest_phone: string;
	purpose: string;
}