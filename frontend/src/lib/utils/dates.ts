export function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

export function getDayOfWeek(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-AU', { weekday: 'long' });
}

export function isWeekend(dateString: string): boolean {
  const day = new Date(dateString).getDay();
  return day === 0 || day === 6;
}

export function addDays(dateString: string, days: number): string {
  const date = new Date(dateString);
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

export function generateTimeSlots(startHour: number = 8, endHour: number = 18, intervalMinutes: number = 30): string[] {
  const slots: string[] = [];
  for (let hour = startHour; hour < endHour; hour++) {
    for (let min = 0; min < 60; min += intervalMinutes) {
      slots.push(`${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`);
    }
  }
  return slots;
}
