export function validateEmail(email: string): boolean {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

export function validatePhone(phone: string): boolean {
  const re = /^[\d\s\-\+\(\)]{8,15}$/;
  return re.test(phone);
}

export function validateTime(time: string): boolean {
  const re = /^([01]\d|2[0-3]):[0-5]\d$/;
  return re.test(time);
}

export function isTimeRangeValid(start: string, end: string): boolean {
  const [startH, startM] = start.split(':').map(Number);
  const [endH, endM] = end.split(':').map(Number);
  return startH * 60 + startM < endH * 60 + endM;
}
