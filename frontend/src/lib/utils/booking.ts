/**
 * Centralised status → label + badge-class mappings for bookings and reports.
 * Used by both the member dashboard and the admin dashboard so the two never
 * drift apart. Labels are human-friendly (Title case) rather than raw values.
 */

interface StatusMeta {
	label: string;
	badgeClass: string;
}

export function getStatusMeta(status: string): StatusMeta {
	switch (status) {
		case 'pending':
			return { label: 'Pending', badgeClass: 'badge-yellow' };
		case 'approved':
			return { label: 'Approved', badgeClass: 'badge-blue' };
		case 'paid':
			return { label: 'Paid', badgeClass: 'badge-green' };
		case 'completed':
			return { label: 'Completed', badgeClass: 'badge-blue' };
		case 'cancelled':
			return { label: 'Cancelled', badgeClass: 'badge-red' };
		default:
			return { label: status.charAt(0).toUpperCase() + status.slice(1), badgeClass: 'badge-blue' };
	}
}

export function getReportStatusMeta(status: string): StatusMeta {
	switch (status) {
		case 'open':
			return { label: 'Open', badgeClass: 'badge-yellow' };
		case 'in_progress':
			return { label: 'In Progress', badgeClass: 'badge-blue' };
		case 'resolved':
			return { label: 'Resolved', badgeClass: 'badge-green' };
		default:
			return { label: status.charAt(0).toUpperCase() + status.slice(1), badgeClass: 'badge-red' };
	}
}
