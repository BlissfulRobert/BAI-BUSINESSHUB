# Row Level Security (RLS) Policy Notes

## Overview

This document outlines the RLS policies for the BAI Business Hub database.

## Policies

### Profiles Table

| Operation | Policy | Description |
|-----------|--------|-------------|
| SELECT | Users can view own profile | Users can only read their own profile |
| SELECT | Admins can view all profiles | Admins have read access to all profiles |
| UPDATE | Users can update own profile | Users can update their own name, phone |
| INSERT | Users can insert own profile | Profile created on signup via trigger |

### Rooms Table

| Operation | Policy | Description |
|-----------|--------|-------------|
| SELECT | Anyone can view active rooms | Public access to active rooms |
| SELECT | Admins can view all rooms | Admins see active + inactive rooms |
| INSERT | Admins can insert rooms | Only admins can create rooms |
| UPDATE | Admins can update rooms | Only admins can edit rooms |
| DELETE | Admins can delete rooms | Only admins can delete rooms |

### Bookings Table

| Operation | Policy | Description |
|-----------|--------|-------------|
| SELECT | Users can view own bookings | Users see only their bookings |
| SELECT | Admins can view all bookings | Admins see all bookings |
| INSERT | Users can create own bookings | Users can book rooms |
| UPDATE | Users can update own bookings | Users can cancel their bookings |
| UPDATE | Admins can update all bookings | Admins can confirm/cancel any booking |

## Security Notes

1. **Service Role Key:** Never expose in client-side code
2. **RLS is mandatory:** All tables have RLS enabled
3. **Triggers:** Use SECURITY DEFINER for auto-creating profiles
4. **Email verification:** Currently disabled for development
